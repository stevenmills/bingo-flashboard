import http from "node:http";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_TYPE_CATALOG = JSON.parse(
  readFileSync(join(__dirname, "../src/lib/game-types.generated.json"), "utf8")
);
const ALL_GAME_TYPES = GAME_TYPE_CATALOG.types.map((t) => t.id);
const GAME_TYPE_BY_ID = Object.fromEntries(GAME_TYPE_CATALOG.types.map((t) => [t.id, t]));
const CYCLING_PATTERN_COUNTS = Object.fromEntries(
  GAME_TYPE_CATALOG.types
    .filter((t) => (t.displayPatterns?.length ?? 0) > 1)
    .map((t) => [t.id, t.displayPatterns.length])
);

const COL_MIN = [1, 16, 31, 46, 61];
const COL_MAX = [15, 30, 45, 60, 75];

function isGameType(id) {
  return ALL_GAME_TYPES.includes(id);
}

/** Normalize flat card cells: null/0 = blank or FREE; keep 1–75 integers. */
function normalizeCardNumbers(numbers) {
  return numbers.slice(0, 25).map((n) => {
    if (n == null || n === 0) return null;
    const v = Number(n);
    return Number.isInteger(v) && v >= 1 && v <= 75 ? v : null;
  });
}

/** Bingo card: FREE at center (null/0), optional blanks, column rules. */
function validateBingoCardNumbers(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 25) return false;
  if (numbers[12] != null && numbers[12] !== 0) return false;
  const seenGlobal = new Set();
  let populated = 0;
  for (let col = 0; col < 5; col++) {
    const seenCol = new Set();
    for (let row = 0; row < 5; row++) {
      const idx = row * 5 + col;
      const n = numbers[idx];
      if (n == null || n === 0) continue;
      if (!Number.isInteger(n) || n < COL_MIN[col] || n > COL_MAX[col]) return false;
      if (seenCol.has(n) || seenGlobal.has(n)) return false;
      seenCol.add(n);
      seenGlobal.add(n);
      populated++;
    }
  }
  return populated >= 1 && populated <= 25;
}

function contentCardId(numbers) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < 25; i++) {
    const n = numbers[i];
    h ^= (typeof n === "number" ? n : 0) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `c${h.toString(16).padStart(8, "0")}`;
}

const PORT = Number.parseInt(process.env.SHARED_MOCK_PORT ?? "8787", 10);
const BOARD_AUTH_TTL_MS = 30 * 60 * 1000;
const BOARD_UNLOCK_MAX_FAILURES = 5;
const BOARD_UNLOCK_LOCKOUT_MS = 30_000;
const DEFAULT_BOARD_PIN = "1975";
const PATTERN_CYCLE_MS = 1500;

const state = {
  current: 0,
  called: [],
  remaining: 75,
  boardSeed: randomSeed(),
  gameType: "traditional",
  callingStyle: "automatic",
  gameEstablished: false,
  winnerDeclared: false,
  manualWinnerDeclared: false,
  winnerCount: 0,
  survivorCount: 0,
  eliminatedCount: 0,
  playerCount: 0,
  cardCount: 0,
  ledTestMode: false,
  boardAccessRequired: true,
  boardAuthValid: false,
  theme: 0,
  brightness: 255,
  colorMode: "theme",
  staticColor: "#00ff00",
  patternIndex: 0,
};

let pool = Array.from({ length: 75 }, (_, i) => i + 1);
let callOrder = [];
let boardPin = DEFAULT_BOARD_PIN;
let boardAuth = null;
let boardUnlockFailCount = 0;
let boardUnlockLockoutUntilMs = 0;
let manualWinnerDeclared = false;
let winnerSuppressed = false;
let winnerEventId = 0;
const cardSessions = new Map();
let stateSeq = 0;

function randomSeed() {
  return Math.floor(1000 + Math.random() * 9000);
}

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  json(res, 404, { error: "not found" });
}

function badRequest(res, msg) {
  json(res, 400, { error: msg });
}

function hasBoardAuth() {
  return !!boardAuth && boardAuth.expiresAt > Date.now();
}

function requireBoardAuth(req, res) {
  if (!hasBoardAuth()) {
    json(res, 401, { error: "board auth required" });
    return false;
  }
  const token = req.headers["x-board-token"];
  if (!token || token !== boardAuth.token) {
    json(res, 401, { error: "board token invalid" });
    return false;
  }
  return true;
}

function normalizePin(pin) {
  return String(pin ?? "").trim();
}

function syncCardCounts() {
  state.cardCount = cardSessions.size;
  state.playerCount = cardSessions.size;
}

function isBlankCell(session, idx) {
  if (idx === 12) return false;
  const n = session.numbers[idx];
  return n == null || n === 0;
}

function effectiveMarked(session, idx) {
  if (idx === 12) return true;
  if (!session.marks[idx]) return false;
  const n = session.numbers[idx];
  return Number.isInteger(n) && n >= 1 && n <= 75 && state.called.includes(n);
}

/** Pattern cell satisfied: FREE always; blanks do not block; else marked + called. */
function isPatternCellSatisfied(session, idx) {
  if (idx === 12) return true;
  if (isBlankCell(session, idx)) return true;
  return effectiveMarked(session, idx);
}

function emptyClaimedMasks() {
  return Array.from({ length: ALL_GAME_TYPES.length }, () => 0);
}

function gameTypeIndex(gameType = state.gameType) {
  const idx = ALL_GAME_TYPES.indexOf(gameType);
  return idx >= 0 ? idx : 0;
}

function sessionCardAllPopulatedCalled(session) {
  let populated = 0;
  for (let i = 0; i < 25; i++) {
    const n = session.numbers[i];
    if (!Number.isInteger(n) || n < 1 || n > 75) continue;
    populated++;
    if (!state.called.includes(n)) return false;
  }
  return populated > 0;
}

function sessionHasWinningPattern(session) {
  if (state.gameType === "battleship") return Boolean(session.winner);
  const satisfied = satisfiedMaskForCurrentGameType(session);
  const claimed = claimedMaskForCurrentGameType(session);
  const available = satisfied & ~claimed;
  const required = GAME_TYPE_BY_ID[state.gameType]?.requiredPatterns ?? 1;
  if (required > 1) {
    let count = 0;
    for (let bits = available; bits !== 0; bits &= bits - 1) count++;
    return count >= required;
  }
  return available !== 0;
}

function satisfiedMaskForCurrentGameType(session) {
  const def = GAME_TYPE_BY_ID[state.gameType];
  if (!def) return 0;
  if (def.coveredThreshold > 0) {
    let covered = 0;
    for (let i = 0; i < 25; i++) {
      if (isBlankCell(session, i)) continue;
      if (effectiveMarked(session, i) || i === 12) covered++;
    }
    return covered >= def.coveredThreshold ? 1 : 0;
  }
  let mask = 0;
  def.winPatterns.forEach((pattern, alt) => {
    if (alt >= 32) return;
    if (pattern.every((cell1) => isPatternCellSatisfied(session, cell1 - 1))) mask |= 1 << alt;
  });
  return mask;
}

function claimedMaskForCurrentGameType(session) {
  if (!session.claimedPatternMasks) session.claimedPatternMasks = emptyClaimedMasks();
  return session.claimedPatternMasks[gameTypeIndex()] ?? 0;
}

function claimCurrentWinningPatterns(session) {
  if (state.gameType === "battleship") {
    session.claimedElimination = true;
    session.winner = false;
    return;
  }
  if (!session.claimedPatternMasks) session.claimedPatternMasks = emptyClaimedMasks();
  const idx = gameTypeIndex();
  session.claimedPatternMasks[idx] =
    (session.claimedPatternMasks[idx] ?? 0) | satisfiedMaskForCurrentGameType(session);
}

function recomputeWinners() {
  let winners = 0;
  let hasNewWinnerEvent = false;
  state.survivorCount = 0;
  state.eliminatedCount = 0;

  if (state.gameType === "battleship") {
    const justSunk = [];
    for (const session of cardSessions.values()) {
      const sunk = sessionCardAllPopulatedCalled(session);
      if (sunk && !session.eliminated) {
        session.eliminated = true;
        justSunk.push(session);
      }
      if (session.eliminated) state.eliminatedCount++;
      else state.survivorCount++;
    }

    for (const session of cardSessions.values()) {
      const wasWinner = Boolean(session.winner);
      let win = false;
      if (!session.claimedElimination) {
        if (state.survivorCount === 1 && state.eliminatedCount >= 1 && !session.eliminated) {
          win = true;
        } else if (state.survivorCount === 0 && justSunk.length > 0) {
          win = justSunk.includes(session);
        }
      }
      session.winner = win;
      if (!wasWinner && win) hasNewWinnerEvent = true;
      if (win) winners++;
    }
  } else {
    for (const session of cardSessions.values()) {
      const wasWinner = Boolean(session.winner);
      session.winner = sessionHasWinningPattern(session);
      if (!wasWinner && session.winner) hasNewWinnerEvent = true;
      if (session.winner) winners++;
    }
  }

  if (winnerSuppressed && hasNewWinnerEvent) {
    // New unclaimed winner appeared after keep-going.
    winnerSuppressed = false;
  }
  if (hasNewWinnerEvent) winnerEventId++;
  state.winnerCount = winners;
  state.winnerDeclared = !winnerSuppressed && (winners > 0 || manualWinnerDeclared);
  state.manualWinnerDeclared = manualWinnerDeclared;
  state.winnerEventId = winnerEventId;
  syncCardCounts();
}

function resetGame() {
  state.called = [];
  state.current = 0;
  state.remaining = 75;
  state.gameEstablished = false;
  manualWinnerDeclared = false;
  winnerSuppressed = false;
  winnerEventId = 0;
  state.manualWinnerDeclared = false;
  state.winnerDeclared = false;
  state.winnerEventId = winnerEventId;
  state.winnerCount = 0;
  state.survivorCount = 0;
  state.eliminatedCount = 0;
  state.boardSeed = randomSeed();
  pool = Array.from({ length: 75 }, (_, i) => i + 1);
  callOrder = [];
  for (const s of cardSessions.values()) {
    s.marks = Array.from({ length: 25 }, (_, i) => i === 12);
    s.winner = false;
    s.claimedPatternMasks = emptyClaimedMasks();
    s.claimedElimination = false;
    s.eliminated = false;
  }
  syncCardCounts();
}

function drawOne() {
  if (pool.length === 0) return null;
  const idx = Math.floor(Math.random() * pool.length);
  const n = pool.splice(idx, 1)[0];
  state.called.push(n);
  callOrder.push(n);
  state.current = n;
  state.remaining = pool.length;
  winnerSuppressed = false;
  state.gameEstablished = true;
  return n;
}

function snapshot() {
  return {
    ...state,
    called: [...state.called],
    boardAuthValid: hasBoardAuth(),
    manualWinnerDeclared,
    winnerEventId,
  };
}

function stateEnvelope(type = "snapshot") {
  stateSeq += 1;
  return {
    type,
    seq: stateSeq,
    seed: String(state.boardSeed),
    ts: Date.now(),
    data: snapshot(),
  };
}

function cardStateEnvelope(cardId, type = "card_state") {
  const session = cardSessions.get(cardId);
  if (!session) return null;
  stateSeq += 1;
  return {
    type,
    seq: stateSeq,
    seed: String(state.boardSeed),
    ts: Date.now(),
    data: {
      cardId,
      winner: Boolean(session.winner),
      winnerCount: state.winnerCount ?? 0,
      winnerEventId,
      marks: [...session.marks],
    },
  };
}

function startPatternCycling() {
  setInterval(() => {
    const count = CYCLING_PATTERN_COUNTS[state.gameType];
    if (!count) return;
    state.patternIndex = (state.patternIndex + 1) % count;
    broadcastState("pattern_index_changed");
  }, PATTERN_CYCLE_MS);
}

function genToken() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function upsertCardSession(id, numbers, marks) {
  const session = cardSessions.get(id) ?? {
    cardId: id,
    numbers: [],
    marks: [],
    winner: false,
    claimedElimination: false,
    eliminated: false,
  };
  session.numbers = numbers;
  session.marks = marks ?? Array.from({ length: 25 }, (_, i) => i === 12);
  session.winner = false;
  session.claimedPatternMasks = emptyClaimedMasks();
  session.claimedElimination = false;
  session.eliminated = false;
  cardSessions.set(id, session);
  return session;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("payload too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (method === "GET" && path === "/api/state") return json(res, 200, snapshot());

  if (method === "POST" && path === "/auth/board/unlock") {
    const now = Date.now();
    if (boardUnlockLockoutUntilMs > now) return json(res, 429, { error: "too many attempts" });
    if (boardUnlockLockoutUntilMs > 0 && boardUnlockLockoutUntilMs <= now) {
      boardUnlockLockoutUntilMs = 0;
      boardUnlockFailCount = 0;
    }
    const body = await parseBody(req);
    if (normalizePin(body.pin) !== normalizePin(boardPin)) {
      boardUnlockFailCount += 1;
      if (boardUnlockFailCount >= BOARD_UNLOCK_MAX_FAILURES) {
        boardUnlockLockoutUntilMs = now + BOARD_UNLOCK_LOCKOUT_MS;
        boardUnlockFailCount = 0;
        return json(res, 429, { error: "too many attempts" });
      }
      return json(res, 401, { error: "invalid pin" });
    }
    boardUnlockFailCount = 0;
    boardUnlockLockoutUntilMs = 0;
    // Keep a shared token so unlocking on a second device does not kick the first.
    if (boardAuth && boardAuth.expiresAt > Date.now()) {
      boardAuth = { token: boardAuth.token, expiresAt: Date.now() + BOARD_AUTH_TTL_MS };
    } else {
      boardAuth = { token: genToken(), expiresAt: Date.now() + BOARD_AUTH_TTL_MS };
    }
    broadcastState("board_auth_changed");
    return json(res, 200, { token: boardAuth.token, ttlMs: BOARD_AUTH_TTL_MS });
  }
  if (method === "POST" && path === "/auth/board/lock") {
    if (!requireBoardAuth(req, res)) return;
    boardAuth = null;
    broadcastState("board_auth_changed");
    return json(res, 200, {});
  }
  if (method === "POST" && path === "/auth/board/refresh") {
    if (!requireBoardAuth(req, res)) return;
    boardAuth = { token: boardAuth.token, expiresAt: Date.now() + BOARD_AUTH_TTL_MS };
    broadcastState("board_auth_changed");
    return json(res, 200, { token: boardAuth.token, ttlMs: BOARD_AUTH_TTL_MS });
  }
  if (method === "POST" && path === "/board/pin") {
    if (!requireBoardAuth(req, res)) return;
    const body = await parseBody(req);
    const currentPin = normalizePin(body.currentPin);
    const nextPin = normalizePin(body.nextPin);
    if (currentPin !== normalizePin(boardPin)) return badRequest(res, "current pin invalid");
    if (!nextPin || nextPin.length < 4 || nextPin.length >= 12) return badRequest(res, "next pin invalid");
    boardPin = nextPin;
    broadcastState("board_pin_changed");
    return json(res, 200, {});
  }

  if (method === "POST" && path === "/draw") {
    if (!requireBoardAuth(req, res)) return;
    if (state.callingStyle === "manual") return badRequest(res, "manual mode");
    const n = drawOne();
    if (n == null) return badRequest(res, "pool empty");
    recomputeWinners();
    broadcastState("number_called");
    broadcastAllCardStates("card_state");
    return json(res, 200, snapshot());
  }
  if (method === "POST" && path === "/reset") {
    if (!requireBoardAuth(req, res)) return;
    resetGame();
    broadcastState("game_reset");
    broadcastAllCardStates("card_state");
    return json(res, 200, {});
  }
  if (method === "POST" && path === "/undo") {
    if (!requireBoardAuth(req, res)) return;
    if (!callOrder.length) return badRequest(res, "nothing to undo");
    const last = callOrder.pop();
    state.called = state.called.filter((n) => n !== last);
    if (!pool.includes(last)) pool.push(last);
    state.current = callOrder.length ? callOrder[callOrder.length - 1] : 0;
    state.remaining = pool.length;
    state.gameEstablished = true;
    manualWinnerDeclared = false;
    state.manualWinnerDeclared = false;
    state.winnerDeclared = false;
    recomputeWinners();
    broadcastState("number_undone");
    broadcastAllCardStates("card_state");
    return json(res, 200, snapshot());
  }

  if (method === "POST" && path === "/calling-style") {
    if (!requireBoardAuth(req, res)) return;
    const body = await parseBody(req);
    if (state.gameEstablished) return json(res, 409, { error: "game established" });
    if (!["automatic", "manual"].includes(body.callingStyle)) return badRequest(res, "invalid");
    state.callingStyle = body.callingStyle;
    broadcastState("calling_style_changed");
    return json(res, 200, {});
  }
  if (method === "POST" && path === "/call") {
    if (!requireBoardAuth(req, res)) return;
    const body = await parseBody(req);
    const n = Number(body.number);
    if (state.callingStyle !== "manual") return badRequest(res, "not manual");
    if (!Number.isInteger(n) || n < 1 || n > 75) return badRequest(res, "invalid number");
    if (state.called.includes(n)) return badRequest(res, "already called");
    state.called.push(n);
    callOrder.push(n);
    state.current = n;
    winnerSuppressed = false;
    pool = pool.filter((x) => x !== n);
    state.remaining = pool.length;
    state.gameEstablished = true;
    recomputeWinners();
    broadcastState("number_called");
    broadcastAllCardStates("card_state");
    return json(res, 200, snapshot());
  }
  if (method === "POST" && path === "/game-type") {
    if (!requireBoardAuth(req, res)) return;
    const body = await parseBody(req);
    if (state.gameEstablished && !state.winnerDeclared) return json(res, 409, { error: "game in progress" });
    if (!isGameType(body.gameType)) return badRequest(res, "invalid");
    state.gameType = body.gameType;
    state.patternIndex = 0;
    recomputeWinners();
    broadcastState("game_type_changed");
    broadcastAllCardStates("card_state");
    return json(res, 200, {});
  }
  if (method === "POST" && path === "/game-selection") {
    if (!requireBoardAuth(req, res)) return;
    const body = await parseBody(req);
    if (state.gameEstablished && !state.winnerDeclared) return json(res, 409, { error: "game in progress" });
    if (!isGameType(body.gameType)) return badRequest(res, "invalid");
    state.gameType = body.gameType;
    state.patternIndex = 0;
    recomputeWinners();
    broadcastState("game_type_changed");
    broadcastAllCardStates("card_state");
    return json(res, 200, {});
  }
  if (method === "POST" && path === "/declare-winner") {
    if (!requireBoardAuth(req, res)) return;
    winnerSuppressed = false;
    manualWinnerDeclared = true;
    winnerEventId += 1;
    recomputeWinners();
    broadcastState("winner_changed");
    broadcastAllCardStates("card_state");
    return json(res, 200, {});
  }
  if (method === "POST" && path === "/clear-winner") {
    if (!requireBoardAuth(req, res)) return;
    manualWinnerDeclared = false;
    winnerSuppressed = true;
    for (const session of cardSessions.values()) {
      claimCurrentWinningPatterns(session);
    }
    recomputeWinners();
    broadcastState("winner_changed");
    broadcastAllCardStates("card_state");
    return json(res, 200, {});
  }
  if (method === "POST" && path === "/led-test") {
    if (!requireBoardAuth(req, res)) return;
    const body = await parseBody(req);
    state.ledTestMode = Boolean(body.enabled);
    broadcastState("led_test_changed");
    return json(res, 200, snapshot());
  }

  if (method === "POST" && path === "/brightness") {
    if (!requireBoardAuth(req, res)) return;
    const qVal = Number(url.searchParams.get("value"));
    state.brightness = Number.isFinite(qVal) ? Math.max(0, Math.min(255, Math.round(qVal))) : state.brightness;
    broadcastState("brightness_changed");
    return json(res, 200, {});
  }
  if (method === "POST" && path === "/theme") {
    if (!requireBoardAuth(req, res)) return;
    const body = await parseBody(req);
    state.theme = Number(body.theme) || 0;
    state.colorMode = "theme";
    broadcastState("theme_changed");
    return json(res, 200, {});
  }
  if (method === "POST" && path === "/color") {
    if (!requireBoardAuth(req, res)) return;
    const body = await parseBody(req);
    const hex = String(body.hex ?? body.color ?? "").replace("#", "");
    if (hex.length >= 6) {
      state.staticColor = `#${hex.slice(0, 6).toUpperCase()}`;
      state.colorMode = "solid";
    }
    broadcastState("color_changed");
    return json(res, 200, {});
  }

  if (method === "POST" && path === "/card/join") {
    const body = await parseBody(req);
    const raw = Array.isArray(body.numbers) ? body.numbers : [];
    if (raw.length !== 25) return badRequest(res, "numbers[25] required");
    const normalized = normalizeCardNumbers(raw);
    if (!validateBingoCardNumbers(normalized)) return badRequest(res, "invalid card");
    const id = String(body.cardId || genToken().slice(0, 16));
    const session = upsertCardSession(id, normalized);
    recomputeWinners();
    broadcastState("card_joined");
    broadcastCardState(id, "card_state");
    return json(res, 200, { cardId: id, winner: session.winner, winnerCount: state.winnerCount, winnerEventId });
  }
  if (method === "POST" && path === "/card/claim") {
    const body = await parseBody(req);
    const raw = Array.isArray(body.numbers) ? body.numbers : [];
    if (raw.length !== 25) return badRequest(res, "numbers[25] required");
    const normalized = normalizeCardNumbers(raw);
    if (!validateBingoCardNumbers(normalized)) return badRequest(res, "invalid card");
    const id = contentCardId(normalized);
    const syncMarks = body.autoSync !== false;
    const marks = normalized.map((n, i) =>
      i === 12 || (syncMarks && typeof n === "number" && state.called.includes(n))
    );
    const session = upsertCardSession(id, normalized, marks);
    recomputeWinners();
    broadcastState("card_claimed");
    broadcastCardState(id, "card_state");
    return json(res, 200, {
      cardId: id,
      winner: session.winner,
      winnerCount: state.winnerCount,
      winnerEventId,
      marks: [...session.marks],
      authentic: Boolean(body.sig),
    });
  }
  if (method === "POST" && path === "/card/mark") {
    const body = await parseBody(req);
    const cardId = String(body.cardId ?? "");
    const cellIndex = Number(body.cellIndex);
    const marked = Boolean(body.marked);
    const session = cardSessions.get(cardId);
    if (!session) return json(res, 404, { error: "card not found" });
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 24) return badRequest(res, "invalid cell");
    if (cellIndex === 12) return badRequest(res, "invalid cell");
    if (isBlankCell(session, cellIndex)) return badRequest(res, "invalid cell");
    session.marks[cellIndex] = marked;
    recomputeWinners();
    broadcastState("card_mark_changed");
    broadcastCardState(cardId, "card_state");
    return json(res, 200, { cardId, winner: session.winner, winnerCount: state.winnerCount, winnerEventId });
  }
  if (method === "POST" && path === "/card/sync-marks") {
    const body = await parseBody(req);
    const cardId = String(body.cardId ?? "");
    const marks = body.marks;
    const session = cardSessions.get(cardId);
    if (!session) return json(res, 404, { error: "card not found" });
    if (!Array.isArray(marks) || marks.length !== 25) return badRequest(res, "marks[25] required");
    for (let i = 0; i < 25; i++) {
      if (i === 12) session.marks[i] = true;
      else if (isBlankCell(session, i)) session.marks[i] = false;
      else session.marks[i] = Boolean(marks[i]);
    }
    recomputeWinners();
    broadcastState("card_mark_changed");
    broadcastCardState(cardId, "card_state");
    return json(res, 200, { cardId, winner: session.winner, winnerCount: state.winnerCount, winnerEventId });
  }
  if (method === "POST" && path === "/card/leave") {
    const body = await parseBody(req);
    const cardId = String(body.cardId ?? "");
    if (!cardSessions.has(cardId)) return json(res, 404, { error: "card not found" });
    cardSessions.delete(cardId);
    recomputeWinners();
    broadcastState("card_left");
    broadcastAllCardStates("card_state");
    return json(res, 200, {});
  }
  if (method === "GET" && path === "/api/card-state") {
    const cardId = String(url.searchParams.get("cardId") ?? "");
    const session = cardSessions.get(cardId);
    if (!session) return json(res, 404, { error: "card not found" });
    recomputeWinners();
    return json(res, 200, { cardId, winner: session.winner, winnerCount: state.winnerCount, winnerEventId, marks: session.marks });
  }

  return notFound(res);
});

const wss = new WebSocketServer({ noServer: true });
const wsSubscriptions = new WeakMap();

function getWsSubscription(ws) {
  return wsSubscriptions.get(ws) ?? { mode: "none", cardId: "" };
}

function setWsSubscription(ws, mode, cardId) {
  const normalizedMode = mode === "board" || mode === "card" ? mode : "none";
  const normalizedCardId = normalizedMode === "card" ? String(cardId ?? "") : "";
  wsSubscriptions.set(ws, { mode: normalizedMode, cardId: normalizedCardId });
}

function wsCanReceiveBoardState(ws) {
  const sub = getWsSubscription(ws);
  if (sub.mode === "board") return true;
  if (sub.mode === "card" && sub.cardId && cardSessions.has(sub.cardId)) return true;
  return false;
}

function wsCanReceiveCardState(ws, cardId) {
  const sub = getWsSubscription(ws);
  if (sub.mode === "board") return true;
  return sub.mode === "card" && sub.cardId === cardId && cardSessions.has(cardId);
}

function wsResult(ws, requestId, ok, status, data, error) {
  const payload = {
    type: "command_result",
    requestId: requestId ?? "",
    ok: Boolean(ok),
    status: Number(status) || (ok ? 200 : 500),
  };
  if (ok) payload.data = data ?? {};
  else payload.error = String(error || "error");
  ws.send(JSON.stringify(payload));
}

function requireBoardAuthWs(token) {
  if (!hasBoardAuth()) return { ok: false, status: 401, error: "board auth required" };
  if (!token || token !== boardAuth.token) return { ok: false, status: 401, error: "board token invalid" };
  return { ok: true };
}

function handleWsCommand(ws, msg) {
  const requestId = msg?.requestId ?? "";
  const action = String(msg?.action ?? "");
  const payload = (msg && typeof msg.payload === "object" && msg.payload) ? msg.payload : {};

  const guarded = () => requireBoardAuthWs(msg?.token);

  if (action === "get_state") {
    wsResult(ws, requestId, true, 200, snapshot());
    return;
  }
  if (action === "draw") {
    const auth = guarded();
    if (!auth.ok) return wsResult(ws, requestId, false, auth.status, null, auth.error);
    if (state.callingStyle === "manual") return wsResult(ws, requestId, false, 400, null, "manual mode");
    const n = drawOne();
    if (n == null) return wsResult(ws, requestId, false, 400, null, "pool empty");
    recomputeWinners();
    broadcastState("number_called");
    broadcastAllCardStates("card_state");
    wsResult(ws, requestId, true, 200, snapshot());
    return;
  }
  if (action === "reset") {
    const auth = guarded();
    if (!auth.ok) return wsResult(ws, requestId, false, auth.status, null, auth.error);
    resetGame();
    broadcastState("game_reset");
    broadcastAllCardStates("card_state");
    wsResult(ws, requestId, true, 200, {});
    return;
  }
  if (action === "undo") {
    const auth = guarded();
    if (!auth.ok) return wsResult(ws, requestId, false, auth.status, null, auth.error);
    if (!callOrder.length) return wsResult(ws, requestId, false, 400, null, "nothing to undo");
    const last = callOrder.pop();
    state.called = state.called.filter((n) => n !== last);
    if (!pool.includes(last)) pool.push(last);
    state.current = callOrder.length ? callOrder[callOrder.length - 1] : 0;
    state.remaining = pool.length;
    state.gameEstablished = true;
    manualWinnerDeclared = false;
    state.manualWinnerDeclared = false;
    state.winnerDeclared = false;
    recomputeWinners();
    broadcastState("number_undone");
    broadcastAllCardStates("card_state");
    wsResult(ws, requestId, true, 200, snapshot());
    return;
  }
  if (action === "set_calling_style") {
    const auth = guarded();
    if (!auth.ok) return wsResult(ws, requestId, false, auth.status, null, auth.error);
    if (state.gameEstablished) return wsResult(ws, requestId, false, 409, null, "game established");
    const callingStyle = payload.callingStyle;
    if (!["automatic", "manual"].includes(callingStyle)) return wsResult(ws, requestId, false, 400, null, "invalid");
    state.callingStyle = callingStyle;
    broadcastState("calling_style_changed");
    wsResult(ws, requestId, true, 200, {});
    return;
  }
  if (action === "call_number") {
    const auth = guarded();
    if (!auth.ok) return wsResult(ws, requestId, false, auth.status, null, auth.error);
    const n = Number(payload.number);
    if (state.callingStyle !== "manual") return wsResult(ws, requestId, false, 400, null, "not manual");
    if (!Number.isInteger(n) || n < 1 || n > 75) return wsResult(ws, requestId, false, 400, null, "invalid number");
    if (state.called.includes(n)) return wsResult(ws, requestId, false, 400, null, "already called");
    state.called.push(n);
    callOrder.push(n);
    state.current = n;
    winnerSuppressed = false;
    pool = pool.filter((x) => x !== n);
    state.remaining = pool.length;
    state.gameEstablished = true;
    recomputeWinners();
    broadcastState("number_called");
    broadcastAllCardStates("card_state");
    wsResult(ws, requestId, true, 200, snapshot());
    return;
  }
  if (action === "set_game_type" || action === "set_game_selection") {
    const auth = guarded();
    if (!auth.ok) return wsResult(ws, requestId, false, auth.status, null, auth.error);
    if (state.gameEstablished && !state.winnerDeclared) {
      return wsResult(ws, requestId, false, 409, null, "game in progress");
    }
    const gameType = payload.gameType;
    if (!isGameType(gameType)) {
      return wsResult(ws, requestId, false, 400, null, "invalid");
    }
    state.gameType = gameType;
    state.patternIndex = 0;
    recomputeWinners();
    broadcastState("game_type_changed");
    broadcastAllCardStates("card_state");
    wsResult(ws, requestId, true, 200, {});
    return;
  }
  if (action === "declare_winner") {
    const auth = guarded();
    if (!auth.ok) return wsResult(ws, requestId, false, auth.status, null, auth.error);
    winnerSuppressed = false;
    manualWinnerDeclared = true;
    winnerEventId += 1;
    recomputeWinners();
    broadcastState("winner_changed");
    broadcastAllCardStates("card_state");
    wsResult(ws, requestId, true, 200, {});
    return;
  }
  if (action === "clear_winner") {
    const auth = guarded();
    if (!auth.ok) return wsResult(ws, requestId, false, auth.status, null, auth.error);
    manualWinnerDeclared = false;
    winnerSuppressed = true;
    for (const session of cardSessions.values()) claimCurrentWinningPatterns(session);
    recomputeWinners();
    broadcastState("winner_changed");
    broadcastAllCardStates("card_state");
    wsResult(ws, requestId, true, 200, {});
    return;
  }
  if (action === "join_card") {
    const raw = Array.isArray(payload.numbers) ? payload.numbers : [];
    if (raw.length !== 25) return wsResult(ws, requestId, false, 400, null, "numbers[25] required");
    const normalized = normalizeCardNumbers(raw);
    if (!validateBingoCardNumbers(normalized)) {
      return wsResult(ws, requestId, false, 400, null, "invalid card");
    }
    const id = String(payload.cardId || genToken().slice(0, 16));
    const session = upsertCardSession(id, normalized);
    recomputeWinners();
    broadcastState("card_joined");
    broadcastCardState(id, "card_state");
    wsResult(ws, requestId, true, 200, { cardId: id, winner: session.winner, winnerCount: state.winnerCount, winnerEventId });
    return;
  }
  if (action === "mark_card_cell") {
    const cardId = String(payload.cardId ?? "");
    const cellIndex = Number(payload.cellIndex);
    const marked = Boolean(payload.marked);
    const session = cardSessions.get(cardId);
    if (!session) return wsResult(ws, requestId, false, 404, null, "card not found");
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 24) {
      return wsResult(ws, requestId, false, 400, null, "invalid cell");
    }
    if (cellIndex === 12 || isBlankCell(session, cellIndex)) {
      return wsResult(ws, requestId, false, 400, null, "invalid cell");
    }
    session.marks[cellIndex] = marked;
    recomputeWinners();
    broadcastState("card_mark_changed");
    broadcastCardState(cardId, "card_state");
    wsResult(ws, requestId, true, 200, { cardId, winner: session.winner, winnerCount: state.winnerCount, winnerEventId });
    return;
  }
  if (action === "leave_card") {
    const cardId = String(payload.cardId ?? "");
    if (!cardSessions.has(cardId)) return wsResult(ws, requestId, false, 404, null, "card not found");
    cardSessions.delete(cardId);
    recomputeWinners();
    broadcastState("card_left");
    broadcastAllCardStates("card_state");
    wsResult(ws, requestId, true, 200, {});
    return;
  }
  if (action === "get_card_state") {
    const cardId = String(payload.cardId ?? "");
    const session = cardSessions.get(cardId);
    if (!session) return wsResult(ws, requestId, false, 404, null, "card not found");
    recomputeWinners();
    wsResult(ws, requestId, true, 200, {
      cardId,
      winner: session.winner,
      winnerCount: state.winnerCount,
      winnerEventId,
      marks: session.marks,
    });
    return;
  }

  wsResult(ws, requestId, false, 400, null, "unknown action");
}

function broadcastState(type = "snapshot") {
  if (wss.clients.size === 0) return;
  const payload = JSON.stringify(stateEnvelope(type));
  for (const client of wss.clients) {
    if (client.readyState === 1 && wsCanReceiveBoardState(client)) {
      client.send(payload);
    }
  }
}

function broadcastCardState(cardId, type = "card_state") {
  if (wss.clients.size === 0) return;
  const envelope = cardStateEnvelope(cardId, type);
  if (!envelope) return;
  const payload = JSON.stringify(envelope);
  for (const client of wss.clients) {
    if (client.readyState === 1 && wsCanReceiveCardState(client, cardId)) {
      client.send(payload);
    }
  }
}

function broadcastAllCardStates(type = "card_state") {
  for (const [cardId] of cardSessions) {
    broadcastCardState(cardId, type);
  }
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  setWsSubscription(ws, "none", "");
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg?.type === "subscribe") {
        const mode = String(msg.mode ?? "none");
        const requestedCardId = String(msg.cardId ?? "");
        const cardId = mode === "card" && cardSessions.has(requestedCardId) ? requestedCardId : "";
        setWsSubscription(ws, mode, cardId);
        if (wsCanReceiveBoardState(ws)) {
          ws.send(JSON.stringify(stateEnvelope("snapshot")));
        }
        if (mode === "board") {
          for (const [activeCardId] of cardSessions) {
            const envelope = cardStateEnvelope(activeCardId, "card_state");
            if (envelope) ws.send(JSON.stringify(envelope));
          }
        } else if (cardId) {
          const envelope = cardStateEnvelope(cardId, "card_state");
          if (envelope) ws.send(JSON.stringify(envelope));
        }
        return;
      }
      if (msg?.type === "command") {
        handleWsCommand(ws, msg);
      }
    } catch {
      // Ignore malformed ws commands.
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[shared-mock] listening on http://127.0.0.1:${PORT}`);
  console.log(`[shared-mock] board unlock PIN: ${DEFAULT_BOARD_PIN}`);
  console.log(`[shared-mock] current board seed: ${state.boardSeed}`);
});

startPatternCycling();
