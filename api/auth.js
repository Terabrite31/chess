import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { deleteValue, readValue, writeValue } from "./_store.js";

const SESSION_TTL = 60 * 60 * 24 * 7;
const VERIFY_TTL = 60 * 60 * 24;
const PASSWORD_ITERATIONS = 210000;

function send(response, status, body) {
  response.status(status).json(body);
}

function token(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function userKey(email) {
  return `user:${email}`;
}

function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    verified: Boolean(user.verified),
  };
}

function hashPassword(password, salt = token(16)) {
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256").toString("base64url");
  return `pbkdf2:${PASSWORD_ITERATIONS}:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [, iterations, salt, expected] = String(storedHash ?? "").split(":");
  if (!iterations || !salt || !expected) {
    return false;
  }

  const actual = pbkdf2Sync(password, salt, Number(iterations), 32, "sha256");
  const expectedBuffer = Buffer.from(expected, "base64url");
  return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
}

function cookieValue(request, name) {
  const cookies = String(request.headers.cookie ?? "");
  return cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function secureCookie(request) {
  return request.headers["x-forwarded-proto"] === "https" || request.headers.host?.includes("vercel.app");
}

function sessionCookie(request, value, maxAge = SESSION_TTL) {
  const secure = secureCookie(request) ? "; Secure" : "";
  return `chess_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

async function currentUser(request) {
  const sessionToken = cookieValue(request, "chess_session");
  if (!sessionToken) {
    return null;
  }

  const session = await readValue(`session:${sessionToken}`);
  if (!session) {
    return null;
  }

  const user = await readValue(userKey(session.email));
  return user?.verified ? user : null;
}

function appUrl(request) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, "");
  }

  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  return `${protocol}://${request.headers.host}`;
}

function verifyUrl(request, verifyToken) {
  const url = new URL(appUrl(request));
  url.searchParams.set("verify", verifyToken);
  return url.toString();
}

async function sendVerificationEmail(request, user) {
  const verifyToken = token();
  const verificationUrl = verifyUrl(request, verifyToken);
  await writeValue(`verify:${verifyToken}`, { email: user.email }, VERIFY_TTL);

  if (!process.env.RESEND_API_KEY) {
    return { sent: false, verificationUrl };
  }

  const from = process.env.EMAIL_FROM ?? "Chess <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "chess-auth/1.0",
    },
    body: JSON.stringify({
      from,
      to: user.email,
      subject: "Verify your Chess account",
      html: `<p>Verify your Chess account by opening this link:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in 24 hours.</p>`,
      text: `Verify your Chess account: ${verificationUrl}\n\nThis link expires in 24 hours.`,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message ?? "Could not send verification email.");
  }

  return { sent: true };
}

function emailId(email) {
  const secret = process.env.AUTH_SECRET ?? "dev-auth-secret";
  return createHmac("sha256", secret).update(email).digest("base64url").slice(0, 24);
}

async function handleRegister(request, response) {
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password ?? "");

  if (!email.includes("@") || email.length > 254) {
    send(response, 400, { error: "Enter a valid email address." });
    return;
  }

  if (password.length < 8) {
    send(response, 400, { error: "Password must be at least 8 characters." });
    return;
  }

  const existingUser = await readValue(userKey(email));
  if (existingUser?.verified) {
    send(response, 409, { error: "That email is already registered." });
    return;
  }

  const now = new Date().toISOString();
  const user = {
    id: existingUser?.id ?? emailId(email),
    email,
    passwordHash: hashPassword(password),
    verified: false,
    createdAt: existingUser?.createdAt ?? now,
    updatedAt: now,
  };

  await writeValue(userKey(email), user);
  const emailResult = await sendVerificationEmail(request, user);

  send(response, 201, {
    user: publicUser(user),
    message: emailResult.sent
      ? "Check your email to verify your account."
      : "Dev mode: open the verification link to finish registration.",
    verificationUrl: emailResult.verificationUrl,
  });
}

async function handleVerify(request, response) {
  const verifyToken = String(request.body?.token ?? request.query.token ?? "");
  const verification = await readValue(`verify:${verifyToken}`);
  if (!verification) {
    send(response, 400, { error: "Verification link is invalid or expired." });
    return;
  }

  const user = await readValue(userKey(verification.email));
  if (!user) {
    send(response, 404, { error: "Account not found." });
    return;
  }

  user.verified = true;
  user.updatedAt = new Date().toISOString();
  await writeValue(userKey(user.email), user);
  await deleteValue(`verify:${verifyToken}`);

  send(response, 200, { user: publicUser(user), message: "Email verified. You can now sign in." });
}

async function handleLogin(request, response) {
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password ?? "");
  const user = await readValue(userKey(email));

  if (!user || !verifyPassword(password, user.passwordHash)) {
    send(response, 401, { error: "Invalid email or password." });
    return;
  }

  if (!user.verified) {
    send(response, 403, { error: "Verify your email before signing in." });
    return;
  }

  const sessionToken = token();
  await writeValue(`session:${sessionToken}`, { email: user.email }, SESSION_TTL);
  response.setHeader("Set-Cookie", sessionCookie(request, sessionToken));
  send(response, 200, { user: publicUser(user) });
}

async function handleLogout(request, response) {
  const sessionToken = cookieValue(request, "chess_session");
  if (sessionToken) {
    await deleteValue(`session:${sessionToken}`);
  }

  response.setHeader("Set-Cookie", sessionCookie(request, "", 0));
  send(response, 200, { user: null });
}

async function handleResend(request, response) {
  const email = normalizeEmail(request.body?.email);
  const user = await readValue(userKey(email));
  if (!user) {
    send(response, 404, { error: "Account not found." });
    return;
  }

  if (user.verified) {
    send(response, 409, { error: "Account is already verified." });
    return;
  }

  const emailResult = await sendVerificationEmail(request, user);
  send(response, 200, {
    message: emailResult.sent ? "Verification email sent." : "Dev mode: open the verification link.",
    verificationUrl: emailResult.verificationUrl,
  });
}

export { currentUser };

export default async function handler(request, response) {
  try {
    if (request.method === "GET") {
      const action = request.query.action ?? "me";

      if (action === "me") {
        send(response, 200, { user: publicUser(await currentUser(request)) });
        return;
      }

      if (action === "verify") {
        await handleVerify(request, response);
        return;
      }

      send(response, 404, { error: "Unknown action." });
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      send(response, 405, { error: "Method not allowed." });
      return;
    }

    const action = request.query.action ?? "login";
    if (action === "register") {
      await handleRegister(request, response);
      return;
    }

    if (action === "verify") {
      await handleVerify(request, response);
      return;
    }

    if (action === "login") {
      await handleLogin(request, response);
      return;
    }

    if (action === "logout") {
      await handleLogout(request, response);
      return;
    }

    if (action === "resend") {
      await handleResend(request, response);
      return;
    }

    send(response, 404, { error: "Unknown action." });
  } catch (error) {
    send(response, 500, { error: error.message ?? "Server error." });
  }
}
