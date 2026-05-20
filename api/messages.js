import { randomUUID } from "node:crypto";
import { currentUser, publicUser } from "./auth.js";
import { readDb, updateDb } from "./_store.js";

function send(response, status, body) {
  response.status(status).json(body);
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function requireText(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

async function requireUser(request, response) {
  const user = await currentUser(request);
  if (!user) {
    send(response, 401, { error: "Sign in first." });
    return null;
  }
  return user;
}

function publicMessage(message, userMap) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    sender: publicUser(userMap.get(message.senderId)),
    body: message.body,
    createdAt: message.createdAt,
  };
}

function summarizeConversation(conversation, db, viewerId) {
  const userMap = new Map(db.users.map((user) => [user.id, user]));
  const messages = db.messages
    .filter((message) => message.conversationId === conversation.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lastMessage = messages.at(-1) ?? null;
  const viewerState = conversation.memberState?.[viewerId] ?? {};
  const unread = messages.filter(
    (message) => message.senderId !== viewerId && (!viewerState.readAt || message.createdAt > viewerState.readAt),
  ).length;

  return {
    id: conversation.id,
    title: conversation.title,
    type: conversation.type,
    members: conversation.memberIds.map((memberId) => publicUser(userMap.get(memberId))).filter(Boolean),
    lastMessage: lastMessage ? publicMessage(lastMessage, userMap) : null,
    unread,
    priority: conversation.priority,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

async function handleDirectory(request, response, user) {
  const query = requireText(request.query.q, 120).toLowerCase();
  const db = await readDb();
  const users = db.users
    .filter((item) => item.verified && item.id !== user.id)
    .filter((item) => !query || item.name.toLowerCase().includes(query) || item.email.toLowerCase().includes(query))
    .slice(0, 30)
    .map(publicUser);

  send(response, 200, { users });
}

async function handleList(request, response, user) {
  const db = await readDb();
  const conversations = db.conversations
    .filter((conversation) => conversation.memberIds.includes(user.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((conversation) => summarizeConversation(conversation, db, user.id));

  send(response, 200, { conversations });
}

async function handleThread(request, response, user) {
  const conversationId = String(request.query.id ?? "");
  const result = await updateDb((db) => {
    const conversation = db.conversations.find((item) => item.id === conversationId);
    if (!conversation || !conversation.memberIds.includes(user.id)) {
      return { error: "Conversation not found.", status: 404 };
    }

    conversation.memberState = conversation.memberState ?? {};
    conversation.memberState[user.id] = {
      ...(conversation.memberState[user.id] ?? {}),
      readAt: now(),
    };

    const userMap = new Map(db.users.map((item) => [item.id, item]));
    const messages = db.messages
      .filter((message) => message.conversationId === conversation.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((message) => publicMessage(message, userMap));

    return {
      conversation: summarizeConversation(conversation, db, user.id),
      messages,
    };
  });

  if (result.error) {
    send(response, result.status, { error: result.error });
    return;
  }

  send(response, 200, result);
}

async function handleCreate(request, response, user) {
  const memberIds = Array.from(new Set([user.id, ...(request.body?.memberIds ?? [])].map(String)));
  const title = requireText(request.body?.title, 120);
  const firstMessage = requireText(request.body?.message);
  const priority = ["normal", "urgent", "executive"].includes(request.body?.priority)
    ? request.body.priority
    : "normal";

  if (memberIds.length < 2) {
    send(response, 400, { error: "Choose at least one recipient." });
    return;
  }

  if (!firstMessage) {
    send(response, 400, { error: "Write a message to start the conversation." });
    return;
  }

  const result = await updateDb((db) => {
    const verifiedIds = new Set(db.users.filter((item) => item.verified).map((item) => item.id));
    const cleanMemberIds = memberIds.filter((memberId) => verifiedIds.has(memberId));
    if (cleanMemberIds.length < 2 || !cleanMemberIds.includes(user.id)) {
      return { error: "One or more recipients are unavailable.", status: 400 };
    }

    const conversation = {
      id: id("convo"),
      title: title || "Direct message",
      type: cleanMemberIds.length > 2 ? "group" : "direct",
      memberIds: cleanMemberIds,
      memberState: {
        [user.id]: { readAt: now() },
      },
      priority,
      createdAt: now(),
      updatedAt: now(),
    };

    const message = {
      id: id("msg"),
      conversationId: conversation.id,
      senderId: user.id,
      body: firstMessage,
      createdAt: conversation.createdAt,
    };

    db.conversations.push(conversation);
    db.messages.push(message);
    return { conversation: summarizeConversation(conversation, db, user.id) };
  });

  if (result.error) {
    send(response, result.status, { error: result.error });
    return;
  }

  send(response, 201, result);
}

async function handleSend(request, response, user) {
  const conversationId = String(request.body?.conversationId ?? "");
  const body = requireText(request.body?.body);

  if (!body) {
    send(response, 400, { error: "Message cannot be empty." });
    return;
  }

  const result = await updateDb((db) => {
    const conversation = db.conversations.find((item) => item.id === conversationId);
    if (!conversation || !conversation.memberIds.includes(user.id)) {
      return { error: "Conversation not found.", status: 404 };
    }

    const message = {
      id: id("msg"),
      conversationId,
      senderId: user.id,
      body,
      createdAt: now(),
    };

    conversation.updatedAt = message.createdAt;
    conversation.memberState = conversation.memberState ?? {};
    conversation.memberState[user.id] = {
      ...(conversation.memberState[user.id] ?? {}),
      readAt: message.createdAt,
    };
    db.messages.push(message);

    const userMap = new Map(db.users.map((item) => [item.id, item]));
    return {
      message: publicMessage(message, userMap),
      conversation: summarizeConversation(conversation, db, user.id),
    };
  });

  if (result.error) {
    send(response, result.status, { error: result.error });
    return;
  }

  send(response, 201, result);
}

export default async function handler(request, response) {
  try {
    const user = await requireUser(request, response);
    if (!user) {
      return;
    }

    if (request.method === "GET") {
      const action = request.query.action ?? "list";
      if (action === "directory") {
        await handleDirectory(request, response, user);
        return;
      }
      if (action === "thread") {
        await handleThread(request, response, user);
        return;
      }
      await handleList(request, response, user);
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      send(response, 405, { error: "Method not allowed." });
      return;
    }

    const action = request.query.action ?? "send";
    if (action === "create") {
      await handleCreate(request, response, user);
      return;
    }
    if (action === "send") {
      await handleSend(request, response, user);
      return;
    }

    send(response, 404, { error: "Unknown action." });
  } catch (error) {
    send(response, 500, { error: error.message ?? "Server error." });
  }
}
