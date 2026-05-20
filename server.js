import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadEnv();
const port = Number(process.env.PORT ?? 3000);
const publicFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/main.js", "main.js"],
  ["/styles.css", "styles.css"],
]);

async function loadEnv() {
  try {
    const envFile = await readFile(path.join(__dirname, ".env"), "utf8");
    for (const line of envFile.split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) {
        continue;
      }
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function contentType(file) {
  if (file.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (file.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (file.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  return "application/octet-stream";
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function createResponseAdapter(response) {
  return {
    setHeader(name, value) {
      response.setHeader(name, value);
    },
    status(statusCode) {
      response.statusCode = statusCode;
      return this;
    },
    json(body) {
      if (!response.hasHeader("Content-Type")) {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      response.end(JSON.stringify(body));
    },
  };
}

async function handleApi(request, response, url) {
  const route = url.pathname.replace(/^\/api\//, "");
  const handlerUrl = pathToFileURL(path.join(__dirname, "api", `${route}.js`)).href;
  const mod = await import(`${handlerUrl}?t=${Date.now()}`);
  request.query = Object.fromEntries(url.searchParams.entries());
  request.body = request.method === "GET" ? {} : await readBody(request);
  await mod.default(request, createResponseAdapter(response));
}

async function handleStatic(response, pathname) {
  const file = publicFiles.get(pathname);
  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const absolutePath = path.join(__dirname, file);
  const body = await readFile(absolutePath);
  response.writeHead(200, { "Content-Type": contentType(file) });
  response.end(body);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await handleStatic(response, url.pathname);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message ?? "Server error." }));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`SignalDesk is running at http://localhost:${port}`);
});
