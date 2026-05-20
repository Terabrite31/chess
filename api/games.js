import { Chess } from "chess.js";
import { readGame, writeGame } from "./_store.js";

function send(response, status, body) {
  response.status(status).json(body);
}

function token() {
  return crypto.randomUUID().replaceAll("-", "");
}

function publicGame(game, playerToken) {
  const color =
    playerToken === game.players.w
      ? "w"
      : playerToken === game.players.b
        ? "b"
        : null;

  return {
    id: game.id,
    fen: game.fen,
    pgn: game.pgn,
    players: {
      white: Boolean(game.players.w),
      black: Boolean(game.players.b),
    },
    color,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}

function createGame() {
  const chess = new Chess();
  const now = new Date().toISOString();

  return {
    id: token().slice(0, 8),
    fen: chess.fen(),
    pgn: chess.pgn(),
    players: {
      w: token(),
      b: null,
    },
    createdAt: now,
    updatedAt: now,
  };
}

async function handleCreate(request, response) {
  const game = createGame();
  await writeGame(game);

  send(response, 201, {
    game: publicGame(game, game.players.w),
    token: game.players.w,
  });
}

async function handleRead(request, response) {
  const game = await readGame(String(request.query.id ?? ""));
  if (!game) {
    send(response, 404, { error: "Game not found." });
    return;
  }

  send(response, 200, { game: publicGame(game, request.query.token) });
}

async function handleJoin(request, response) {
  const { id, token: playerToken } = request.body ?? {};
  const game = await readGame(String(id ?? ""));

  if (!game) {
    send(response, 404, { error: "Game not found." });
    return;
  }

  if (playerToken === game.players.w || playerToken === game.players.b) {
    send(response, 200, { game: publicGame(game, playerToken), token: playerToken });
    return;
  }

  if (game.players.b) {
    send(response, 409, { error: "This game already has two players." });
    return;
  }

  game.players.b = token();
  game.updatedAt = new Date().toISOString();
  await writeGame(game);

  send(response, 200, {
    game: publicGame(game, game.players.b),
    token: game.players.b,
  });
}

async function handleMove(request, response) {
  const { id, token: playerToken, from, to, promotion } = request.body ?? {};
  const game = await readGame(String(id ?? ""));

  if (!game) {
    send(response, 404, { error: "Game not found." });
    return;
  }

  const color = playerToken === game.players.w ? "w" : playerToken === game.players.b ? "b" : null;
  if (!color) {
    send(response, 403, { error: "You are not a player in this game." });
    return;
  }

  const chess = game.pgn ? new Chess() : new Chess(game.fen);
  if (game.pgn) {
    chess.loadPgn(game.pgn);
  }

  if (chess.turn() !== color) {
    send(response, 409, { error: "It is not your turn." });
    return;
  }

  const move = chess.move({ from, to, promotion });
  if (!move) {
    send(response, 400, { error: "Illegal move." });
    return;
  }

  game.fen = chess.fen();
  game.pgn = chess.pgn();
  game.updatedAt = new Date().toISOString();
  await writeGame(game);

  send(response, 200, { game: publicGame(game, playerToken), move });
}

export default async function handler(request, response) {
  try {
    if (request.method === "GET") {
      await handleRead(request, response);
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      send(response, 405, { error: "Method not allowed." });
      return;
    }

    const action = request.query.action ?? "create";

    if (action === "create") {
      await handleCreate(request, response);
      return;
    }

    if (action === "join") {
      await handleJoin(request, response);
      return;
    }

    if (action === "move") {
      await handleMove(request, response);
      return;
    }

    send(response, 404, { error: "Unknown action." });
  } catch (error) {
    send(response, 500, { error: error.message ?? "Server error." });
  }
}
