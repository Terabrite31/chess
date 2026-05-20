import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm";

const boardEl = document.querySelector("#board");
const rankLabelsEl = document.querySelector("#rankLabels");
const fileLabelsEl = document.querySelector("#fileLabels");
const statusTextEl = document.querySelector("#statusText");
const detailTextEl = document.querySelector("#detailText");
const whiteCapturesEl = document.querySelector("#whiteCaptures");
const blackCapturesEl = document.querySelector("#blackCaptures");
const moveListEl = document.querySelector("#moveList");
const resetButton = document.querySelector("#resetButton");
const flipButton = document.querySelector("#flipButton");
const promotionDialog = document.querySelector("#promotionDialog");
const onlineButton = document.querySelector("#onlineButton");
const copyLinkButton = document.querySelector("#copyLinkButton");
const roomCodeEl = document.querySelector("#roomCode");
const onlineDetailEl = document.querySelector("#onlineDetail");

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const pieceSymbols = {
  wp: "♙",
  wn: "♘",
  wb: "♗",
  wr: "♖",
  wq: "♕",
  wk: "♔",
  bp: "♟",
  bn: "♞",
  bb: "♝",
  br: "♜",
  bq: "♛",
  bk: "♚",
};

const pieceValues = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
};

let game = new Chess();
let selectedSquare = null;
let legalMoves = [];
let flipped = false;
let onlineGame = null;
let playerToken = null;
let pollTimer = null;
let pollInFlight = false;

function squareName(row, col) {
  const rank = 8 - row;
  return `${files[col]}${rank}`;
}

function displayRows() {
  const rows = Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => ({ row, col, square: squareName(row, col) })),
  );

  if (!flipped) {
    return rows.flat();
  }

  return rows
    .slice()
    .reverse()
    .flatMap((row) => row.slice().reverse());
}

function renderLabels() {
  const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const shownFiles = flipped ? files.slice().reverse() : files;

  rankLabelsEl.innerHTML = ranks.map((rank) => `<span>${rank}</span>`).join("");
  fileLabelsEl.innerHTML = shownFiles.map((file) => `<span>${file}</span>`).join("");
}

function renderBoard() {
  renderLabels();
  const checkedKing = getCheckedKingSquare();

  boardEl.innerHTML = displayRows()
    .map(({ row, col, square }) => {
      const piece = game.get(square);
      const isSelected = selectedSquare === square;
      const move = legalMoves.find((candidate) => candidate.to === square);
      const classes = [
        "square",
        (row + col) % 2 === 0 ? "light" : "dark",
        isSelected ? "selected" : "",
        move ? "legal" : "",
        move?.captured ? "capture" : "",
        checkedKing === square ? "check" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const pieceHtml = piece
        ? `<span class="piece ${piece.color}" aria-hidden="true">${pieceSymbols[piece.color + piece.type]}</span>`
        : "";

      return `<button class="${classes}" data-square="${square}" role="gridcell" aria-label="${square}">${pieceHtml}</button>`;
    })
    .join("");
}

function getCheckedKingSquare() {
  if (!game.isCheck()) {
    return null;
  }

  const activeColor = game.turn();
  for (const square of files.flatMap((file) => Array.from({ length: 8 }, (_, i) => `${file}${i + 1}`))) {
    const piece = game.get(square);
    if (piece?.type === "k" && piece.color === activeColor) {
      return square;
    }
  }

  return null;
}

function updateStatus() {
  const turn = game.turn() === "w" ? "White" : "Black";

  if (game.isCheckmate()) {
    statusTextEl.textContent = "Checkmate";
    detailTextEl.textContent = `${turn} is checkmated. ${turn === "White" ? "Black" : "White"} wins.`;
    return;
  }

  if (game.isDraw()) {
    statusTextEl.textContent = "Draw";
    detailTextEl.textContent = drawReason();
    return;
  }

  statusTextEl.textContent = onlineGame && onlineGame.color === game.turn() ? "Your move" : `${turn} to move`;
  detailTextEl.textContent = game.isCheck()
    ? `${turn} is in check.`
    : selectedSquare
      ? `${selectedSquare} selected. Choose a highlighted destination.`
      : onlineGame && onlineGame.color && onlineGame.color !== game.turn()
        ? "Waiting for your opponent."
      : onlineGame && !onlineGame.color
        ? "Spectating this game."
        : `Select a ${turn.toLowerCase()} piece.`;
}

function drawReason() {
  if (game.isStalemate()) {
    return "Stalemate: the side to move has no legal move.";
  }
  if (game.isThreefoldRepetition()) {
    return "Draw by threefold repetition.";
  }
  if (game.isInsufficientMaterial()) {
    return "Draw by insufficient material.";
  }
  return "Draw by the fifty-move rule.";
}

function renderCaptures() {
  const captures = capturedPieces();

  whiteCapturesEl.textContent = sortCaptured(captures.w)
    .map((piece) => pieceSymbols[`b${piece}`])
    .join(" ");
  blackCapturesEl.textContent = sortCaptured(captures.b)
    .map((piece) => pieceSymbols[`w${piece}`])
    .join(" ");
}

function capturedPieces() {
  return game.history({ verbose: true }).reduce(
    (taken, move) => {
      if (move.captured) {
        taken[move.color].push(move.captured);
      }
      return taken;
    },
    { w: [], b: [] },
  );
}

function sortCaptured(pieces) {
  return pieces.slice().sort((a, b) => (pieceValues[b] ?? 0) - (pieceValues[a] ?? 0));
}

function renderMoveHistory() {
  const history = game.history();
  moveListEl.innerHTML = history
    .map((move, index) => {
      const prefix = index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ` : "";
      return `<li value="${Math.floor(index / 2) + 1}">${prefix}${move}</li>`;
    })
    .join("");
  moveListEl.scrollTop = moveListEl.scrollHeight;
}

function render() {
  renderBoard();
  updateStatus();
  renderCaptures();
  renderMoveHistory();
  renderOnline();
}

function renderOnline() {
  if (!onlineGame) {
    roomCodeEl.textContent = "Local";
    onlineDetailEl.textContent = "Play locally or create a room to invite someone.";
    onlineButton.textContent = "Create room";
    copyLinkButton.disabled = true;
    return;
  }

  const side = onlineGame.color === "w" ? "White" : onlineGame.color === "b" ? "Black" : "Spectator";
  const opponentJoined = onlineGame.color === "w" ? onlineGame.players.black : onlineGame.players.white;
  const waiting = !opponentJoined ? " Waiting for the other player." : "";

  roomCodeEl.textContent = onlineGame.id;
  onlineDetailEl.textContent = `Room ${onlineGame.id}. You are ${side}.${waiting}`;
  onlineButton.textContent = "Leave room";
  copyLinkButton.disabled = false;
}

function canMoveCurrentTurn() {
  if (!onlineGame) {
    return true;
  }

  return onlineGame.color === game.turn();
}

function selectSquare(square) {
  if (!canMoveCurrentTurn()) {
    selectedSquare = null;
    legalMoves = [];
    render();
    return;
  }

  const piece = game.get(square);

  if (!piece || piece.color !== game.turn()) {
    selectedSquare = null;
    legalMoves = [];
    render();
    return;
  }

  selectedSquare = square;
  legalMoves = game.moves({ square, verbose: true });
  render();
}

async function handleSquareClick(event) {
  const squareEl = event.target.closest("[data-square]");
  if (!squareEl || game.isGameOver() || !canMoveCurrentTurn()) {
    return;
  }

  const targetSquare = squareEl.dataset.square;

  if (!selectedSquare) {
    selectSquare(targetSquare);
    return;
  }

  if (targetSquare === selectedSquare) {
    selectedSquare = null;
    legalMoves = [];
    render();
    return;
  }

  const legalMove = legalMoves.find((move) => move.to === targetSquare);
  if (!legalMove) {
    selectSquare(targetSquare);
    return;
  }

  const promotion = legalMove.flags.includes("p") ? await choosePromotion() : undefined;
  await makeMove(selectedSquare, targetSquare, promotion);
}

async function makeMove(from, to, promotion) {
  if (onlineGame) {
    await sendOnlineMove(from, to, promotion);
    return;
  }

  game.move({ from, to, promotion });
  selectedSquare = null;
  legalMoves = [];
  render();
}

function choosePromotion() {
  return new Promise((resolve) => {
    const fallback = () => resolve("q");

    if (!promotionDialog.showModal) {
      fallback();
      return;
    }

    promotionDialog.addEventListener(
      "close",
      () => {
        resolve(promotionDialog.returnValue || "q");
      },
      { once: true },
    );
    promotionDialog.showModal();
  });
}

function loadOnlineGame(nextGame) {
  onlineGame = nextGame;
  game = new Chess();
  if (nextGame.pgn) {
    game.loadPgn(nextGame.pgn);
  }
  selectedSquare = null;
  legalMoves = [];
  render();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
  }

  return data;
}

function storedToken(id) {
  return localStorage.getItem(`chess:${id}:token`);
}

function storeToken(id, token) {
  localStorage.setItem(`chess:${id}:token`, token);
}

function shareUrl(id) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", id);
  url.searchParams.delete("token");
  return url.toString();
}

function playerUrl(id, token) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", id);
  url.searchParams.set("token", token);
  return url.toString();
}

function setRoomUrl(id, token) {
  window.history.replaceState({}, "", playerUrl(id, token));
}

async function createOnlineGame() {
  const { game: createdGame, token } = await api("/api/games?action=create", { method: "POST" });
  playerToken = token;
  storeToken(createdGame.id, token);
  setRoomUrl(createdGame.id, token);
  loadOnlineGame(createdGame);
  startPolling();
}

async function joinOnlineGame(id, token = storedToken(id)) {
  if (token) {
    const { game: currentGame } = await api(`/api/games?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`);
    playerToken = token;
    storeToken(id, token);
    setRoomUrl(id, token);
    loadOnlineGame(currentGame);
    startPolling();
    return;
  }

  const { game: joinedGame, token: joinedToken } = await api("/api/games?action=join", {
    method: "POST",
    body: JSON.stringify({ id }),
  });

  playerToken = joinedToken;
  storeToken(id, joinedToken);
  setRoomUrl(id, joinedToken);
  loadOnlineGame(joinedGame);
  startPolling();
}

async function sendOnlineMove(from, to, promotion) {
  try {
    const { game: nextGame } = await api("/api/games?action=move", {
      method: "POST",
      body: JSON.stringify({ id: onlineGame.id, token: playerToken, from, to, promotion }),
    });
    loadOnlineGame(nextGame);
  } catch (error) {
    detailTextEl.textContent = error.message;
    await pollOnlineGame();
  }
}

async function pollOnlineGame() {
  if (!onlineGame || !playerToken || pollInFlight) {
    return;
  }

  pollInFlight = true;
  try {
    const { game: nextGame } = await api(
      `/api/games?id=${encodeURIComponent(onlineGame.id)}&token=${encodeURIComponent(playerToken)}`,
    );
    if (nextGame.updatedAt !== onlineGame.updatedAt || nextGame.players.black !== onlineGame.players.black) {
      loadOnlineGame(nextGame);
    }
  } catch (error) {
    onlineDetailEl.textContent = error.message;
  } finally {
    pollInFlight = false;
  }
}

function startPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(pollOnlineGame, 1800);
}

function stopPolling() {
  window.clearInterval(pollTimer);
  pollTimer = null;
}

function leaveOnlineGame() {
  stopPolling();
  onlineGame = null;
  playerToken = null;
  const url = new URL(window.location.href);
  url.searchParams.delete("game");
  url.searchParams.delete("token");
  window.history.replaceState({}, "", url.toString());
  resetGame();
}

function resetGame() {
  game = new Chess();
  selectedSquare = null;
  legalMoves = [];
  render();
}

function flipBoard() {
  flipped = !flipped;
  render();
}

async function handleOnlineButton() {
  try {
    if (onlineGame) {
      leaveOnlineGame();
      return;
    }

    await createOnlineGame();
  } catch (error) {
    onlineDetailEl.textContent = error.message;
  }
}

async function copyShareLink() {
  if (!onlineGame) {
    return;
  }

  const link = shareUrl(onlineGame.id);
  try {
    await navigator.clipboard.writeText(link);
    onlineDetailEl.textContent = `Invite link copied. You are ${onlineGame.color === "w" ? "White" : "Black"}.`;
  } catch {
    onlineDetailEl.textContent = link;
  }
}

async function bootFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("game");
  const token = params.get("token");

  if (!id) {
    return;
  }

  try {
    await joinOnlineGame(id, token);
  } catch (error) {
    onlineDetailEl.textContent = error.message;
    render();
  }
}

boardEl.addEventListener("click", handleSquareClick);
resetButton.addEventListener("click", () => {
  if (onlineGame) {
    leaveOnlineGame();
    return;
  }
  resetGame();
});
flipButton.addEventListener("click", flipBoard);
onlineButton.addEventListener("click", handleOnlineButton);
copyLinkButton.addEventListener("click", copyShareLink);

render();
bootFromUrl();
