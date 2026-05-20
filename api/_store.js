const memoryStore = globalThis.__chessGames ?? new Map();
globalThis.__chessGames = memoryStore;

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
  if (!id) {
    return null;
  }

  if (hasKv()) {
    const value = await kv("get", `game:${id}`);
    return value ? JSON.parse(value) : null;
  }

  return memoryStore.get(id) ?? null;
}

export async function writeGame(game) {
  if (hasKv()) {
    await kv("set", `game:${game.id}`, JSON.stringify(game), "ex", 60 * 60 * 24);
    return game;
  }

  memoryStore.set(game.id, game);
  return game;
}

