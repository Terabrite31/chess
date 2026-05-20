import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(process.cwd(), "data", "signaldesk-db.json");

const seed = {
  users: [],
  sessions: [],
  verifications: [],
  conversations: [],
  messages: [],
};

let writeQueue = Promise.resolve();

async function ensureDatabase() {
  await mkdir(path.dirname(DB_PATH), { recursive: true });

  try {
    await readFile(DB_PATH, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await writeFile(DB_PATH, `${JSON.stringify(seed, null, 2)}\n`);
  }
}

function normalizeDatabase(data) {
  return {
    users: Array.isArray(data.users) ? data.users : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    verifications: Array.isArray(data.verifications) ? data.verifications : [],
    conversations: Array.isArray(data.conversations) ? data.conversations : [],
    messages: Array.isArray(data.messages) ? data.messages : [],
  };
}

async function readDatabase() {
  await ensureDatabase();
  const file = await readFile(DB_PATH, "utf8");
  return normalizeDatabase(JSON.parse(file || "{}"));
}

async function writeDatabase(data) {
  await ensureDatabase();
  await writeFile(DB_PATH, `${JSON.stringify(normalizeDatabase(data), null, 2)}\n`);
  return data;
}

export async function readDb() {
  return readDatabase();
}

export async function updateDb(mutator) {
  writeQueue = writeQueue.then(async () => {
    const db = await readDatabase();
    const result = await mutator(db);
    await writeDatabase(db);
    return result;
  });

  return writeQueue;
}

export function withoutExpired(records) {
  const now = Date.now();
  return records.filter((record) => !record.expiresAt || Date.parse(record.expiresAt) > now);
}
