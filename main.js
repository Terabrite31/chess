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
let captures = { w: [], b: [] };

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

  statusTextEl.textContent = `${turn} to move`;
  detailTextEl.textContent = game.isCheck()
    ? `${turn} is in check.`
    : selectedSquare
      ? `${selectedSquare} selected. Choose a highlighted destination.`
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
  whiteCapturesEl.textContent = sortCaptured(captures.w)
    .map((piece) => pieceSymbols[`b${piece}`])
    .join(" ");
  blackCapturesEl.textContent = sortCaptured(captures.b)
    .map((piece) => pieceSymbols[`w${piece}`])
    .join(" ");
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
}

function selectSquare(square) {
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
  if (!squareEl || game.isGameOver()) {
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
  makeMove(selectedSquare, targetSquare, promotion);
}

function makeMove(from, to, promotion) {
  const movedBy = game.turn();
  const move = game.move({ from, to, promotion });

  if (move?.captured) {
    captures[movedBy].push(move.captured);
  }

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

function resetGame() {
  game = new Chess();
  selectedSquare = null;
  legalMoves = [];
  captures = { w: [], b: [] };
  render();
}

function flipBoard() {
  flipped = !flipped;
  render();
}

boardEl.addEventListener("click", handleSquareClick);
resetButton.addEventListener("click", resetGame);
flipButton.addEventListener("click", flipBoard);

render();
