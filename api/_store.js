const memoryStore = globalThis.__chessStore ?? new Map();
globalThis.__chessStore = memoryStore;

const kvUrl = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;

function hasKv() {
  return Boolean(kvUrl && kvToken);
}

async function kv(command, ...args) {
  const response = await fetch(`${kvUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([[command, ...args]]),
  });

  if (!response.ok) {
    throw new Error(`KV ${command} failed with ${response.status}`);
  }

  const [result] = await response.json();
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result;
}

export async function readGame(id) {
  return readValue(`game:${id}`);
}

export async function writeGame(game) {
  await writeValue(`game:${game.id}`, game, 60 * 60 * 24);
  return game;
}

export async function readValue(key) {
  if (!key) {
    return null;
  }

  if (hasKv()) {
    const value = await kv("get", key);
    return value ? JSON.parse(value) : null;
  }

  const item = memoryStore.get(key);
  if (!item) {
    return null;
  }

  if (item.expiresAt && item.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }

  return item.value;
}

export async function writeValue(key, value, ttlSeconds) {
  if (hasKv()) {
    const args = ["set", key, JSON.stringify(value)];
    if (ttlSeconds) {
      args.push("ex", ttlSeconds);
    }
    await kv(...args);
    return value;
  }

  memoryStore.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
  return value;
}

export async function deleteValue(key) {
  if (hasKv()) {
    await kv("del", key);
    return;
  }

  memoryStore.delete(key);
}
