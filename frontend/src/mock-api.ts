/**
 * In-memory mock backend that mirrors the ESP32 API.
 * Used for local UI development without hardware.
 */
import {
  DEFAULT_STATE,
  CYCLING_PATTERNS,
  type BoardAuthSession,
  type CardJoinResponse,
  type CardStateResponse,
  type GameState,
  type GameType,
  type CallingStyle,
} from "./types";

// Deep clone initial state, restoring persisted game type and calling style
const state: GameState = JSON.parse(JSON.stringify(DEFAULT_STATE));
const savedGameType = localStorage.getItem("bingo-gameType");
if (savedGameType && ["traditional", "four_corners", "postage_stamp", "cover_all", "x", "y", "frame_outside", "frame_inside"].includes(savedGameType)) {
  state.gameType = savedGameType as GameType;
}
const savedCallingStyle = localStorage.getItem("bingo-callingStyle");
if (savedCallingStyle && ["automatic", "manual"].includes(savedCallingStyle)) {
  state.callingStyle = savedCallingStyle as CallingStyle;
}
let pool: number[] = Array.from({ length: 75 }, (_, i) => i + 1);
let callOrder: number[] = [];
let boardSeed = Math.floor(1000 + Math.random() * 9000);
const BOARD_PIN_DEFAULT = "1975";
const BOARD_AUTH_TTL_MS = 30 * 60 * 1000;
let boardPin = BOARD_PIN_DEFAULT;
let boardAuth: BoardAuthSession | null = null;
let manualWinnerDeclared = false;
let winnerSuppressed = false;
let winnerEventId = 0;

interface MockCardSession {
  cardId: string;
  numbers: Array<number | null>;
  marks: boolean[];
  winner: boolean;
  claimedTraditionalMask: number;
  claimedFourCornersMask: number;
  claimedPostageMask: number;
  claimedCoverAllMask: number;
  claimedXMask: number;
  claimedYMask: number;
  claimedFrameOutsideMask: number;
  claimedFrameInsideMask: number;
}
const cardSessions = new Map<string, MockCardSession>();

function normalizePin(pin: string) {
  return pin.trim();
}

// Cycle patterns every 1.5s for game types that have cycling patterns (mirrors firmware)
let patternTimer: ReturnType<typeof setInterval> | null = null;
function startPatternCycling() {
  if (patternTimer) return;
  patternTimer = setInterval(() => {
    const patterns = CYCLING_PATTERNS[state.gameType];
    if (patterns) {
      state.patternIndex = (state.patternIndex + 1) % patterns.length;
    }
  }, 1500);
}
startPatternCycling();

function snapshot(): GameState {
  return JSON.parse(JSON.stringify(state));
}

function drawOne(): number | null {
  if (pool.length === 0) return null;
  const idx = Math.floor(Math.random() * pool.length);
  const n = pool.splice(idx, 1)[0];
  state.called.push(n);
  callOrder.push(n);
  state.current = n;
  state.remaining = pool.length;
  winnerSuppressed = false;
  if (!state.gameEstablished) state.gameEstablished = true;
  return n;
}

function nowMs() {
  return Date.now();
}

function genToken() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function hasBoardAuth() {
  if (!boardAuth) return false;
  return boardAuth.ttlMs > nowMs();
}

function assertBoardAuth() {
  if (!hasBoardAuth()) throw new Error("401");
}

function effectiveMarked(session: MockCardSession, idx: number): boolean {
  if (idx === 12) return true;
  if (!session.marks[idx]) return false;
  const n = session.numbers[idx];
  if (n == null) return false;
  return state.called.includes(n);
}

function sessionWin(session: MockCardSession): boolean {
  const satisfied = satisfiedMaskForCurrentGameType(session);
  const claimed = claimedMaskForCurrentGameType(session);
  return (satisfied & ~claimed) !== 0;
}

function traditionalSatisfiedMask(session: MockCardSession): number {
  let mask = 0;
  for (let r = 0; r < 5; r++) {
    let ok = true;
    for (let c = 0; c < 5; c++) if (!effectiveMarked(session, r * 5 + c)) ok = false;
    if (ok) mask |= (1 << r);
  }
  for (let c = 0; c < 5; c++) {
    let ok = true;
    for (let r = 0; r < 5; r++) if (!effectiveMarked(session, r * 5 + c)) ok = false;
    if (ok) mask |= (1 << (5 + c));
  }
  if ([0, 6, 12, 18, 24].every((idx) => effectiveMarked(session, idx))) mask |= (1 << 10);
  if ([4, 8, 12, 16, 20].every((idx) => effectiveMarked(session, idx))) mask |= (1 << 11);
  return mask;
}

function postageSatisfiedMask(session: MockCardSession): number {
  const patterns = [
    [0, 1, 5, 6],
    [3, 4, 8, 9],
    [15, 16, 20, 21],
    [18, 19, 23, 24],
  ];
  let mask = 0;
  patterns.forEach((pattern, idx) => {
    if (pattern.every((cellIdx) => effectiveMarked(session, cellIdx))) {
      mask |= (1 << idx);
    }
  });
  return mask;
}

function xSatisfiedMask(session: MockCardSession): number {
  const xPattern = [0, 4, 6, 8, 12, 16, 18, 20, 24];
  return xPattern.every((idx) => effectiveMarked(session, idx)) ? 1 : 0;
}

function ySatisfiedMask(session: MockCardSession): number {
  const yPattern = [0, 4, 6, 8, 12, 17, 22];
  return yPattern.every((idx) => effectiveMarked(session, idx)) ? 1 : 0;
}

function frameOutsideSatisfiedMask(session: MockCardSession): number {
  const pattern = [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24];
  return pattern.every((idx) => effectiveMarked(session, idx)) ? 1 : 0;
}

function frameInsideSatisfiedMask(session: MockCardSession): number {
  const pattern = [6, 7, 8, 11, 13, 16, 17, 18];
  return pattern.every((idx) => effectiveMarked(session, idx)) ? 1 : 0;
}

function satisfiedMaskForCurrentGameType(session: MockCardSession): number {
  if (state.gameType === "traditional") return traditionalSatisfiedMask(session);
  if (state.gameType === "four_corners") {
    const ok = effectiveMarked(session, 0) &&
      effectiveMarked(session, 4) &&
      effectiveMarked(session, 20) &&
      effectiveMarked(session, 24);
    return ok ? 1 : 0;
  }
  if (state.gameType === "postage_stamp") return postageSatisfiedMask(session);
  if (state.gameType === "cover_all") {
    for (let i = 0; i < 25; i++) if (!effectiveMarked(session, i)) return 0;
    return 1;
  }
  if (state.gameType === "x") return xSatisfiedMask(session);
  if (state.gameType === "y") return ySatisfiedMask(session);
  if (state.gameType === "frame_outside") return frameOutsideSatisfiedMask(session);
  if (state.gameType === "frame_inside") return frameInsideSatisfiedMask(session);
  return 0;
}

function claimedMaskForCurrentGameType(session: MockCardSession): number {
  if (state.gameType === "traditional") return session.claimedTraditionalMask;
  if (state.gameType === "four_corners") return session.claimedFourCornersMask;
  if (state.gameType === "postage_stamp") return session.claimedPostageMask;
  if (state.gameType === "cover_all") return session.claimedCoverAllMask;
  if (state.gameType === "x") return session.claimedXMask;
  if (state.gameType === "y") return session.claimedYMask;
  if (state.gameType === "frame_outside") return session.claimedFrameOutsideMask;
  if (state.gameType === "frame_inside") return session.claimedFrameInsideMask;
  return session.claimedTraditionalMask;
}

function claimCurrentWinningPatterns(session: MockCardSession) {
  const satisfied = satisfiedMaskForCurrentGameType(session);
  if (state.gameType === "traditional") session.claimedTraditionalMask |= satisfied;
  else if (state.gameType === "four_corners") session.claimedFourCornersMask |= satisfied;
  else if (state.gameType === "postage_stamp") session.claimedPostageMask |= satisfied;
  else if (state.gameType === "cover_all") session.claimedCoverAllMask |= satisfied;
  else if (state.gameType === "x") session.claimedXMask |= satisfied;
  else if (state.gameType === "y") session.claimedYMask |= satisfied;
  else if (state.gameType === "frame_outside") session.claimedFrameOutsideMask |= satisfied;
  else if (state.gameType === "frame_inside") session.claimedFrameInsideMask |= satisfied;
}

function recomputeWinners() {
  let winners = 0;
  let hasNewWinnerEvent = false;
  for (const s of cardSessions.values()) {
    const wasWinner = s.winner;
    s.winner = sessionWin(s);
    if (!wasWinner && s.winner) hasNewWinnerEvent = true;
    if (s.winner) winners++;
  }
  if (winnerSuppressed && winners > 0) {
    // New unclaimed winner appeared after keep-going.
    winnerSuppressed = false;
  }
  if (hasNewWinnerEvent) winnerEventId++;
  state.winnerCount = winners;
  state.winnerDeclared = !winnerSuppressed && (winners > 0 || manualWinnerDeclared);
  state.manualWinnerDeclared = manualWinnerDeclared;
  state.winnerEventId = winnerEventId;
  state.cardCount = cardSessions.size;
  state.playerCount = cardSessions.size;
}

function resetGame() {
  state.called = [];
  state.current = 0;
  pool = Array.from({ length: 75 }, (_, i) => i + 1);
  callOrder = [];
  state.remaining = 75;
  boardSeed = Math.floor(1000 + Math.random() * 9000);
  state.boardSeed = boardSeed;
  state.gameEstablished = false;
  manualWinnerDeclared = false;
  winnerSuppressed = false;
  winnerEventId = 0;
  state.manualWinnerDeclared = false;
  state.winnerDeclared = false;
  state.winnerEventId = winnerEventId;
  state.winnerCount = 0;
  for (const s of cardSessions.values()) {
    s.marks = s.marks.map((_, i) => i === 12);
    s.winner = false;
    s.claimedTraditionalMask = 0;
    s.claimedFourCornersMask = 0;
    s.claimedPostageMask = 0;
    s.claimedCoverAllMask = 0;
    s.claimedXMask = 0;
    s.claimedYMask = 0;
    s.claimedFrameOutsideMask = 0;
    s.claimedFrameInsideMask = 0;
  }
}

export const mockApi = {
  getState: async (): Promise<GameState> => {
    // Simulate ~20ms network latency
    await delay(20);
    state.boardAccessRequired = true;
    state.boardAuthValid = hasBoardAuth();
    state.manualWinnerDeclared = manualWinnerDeclared;
    state.winnerEventId = winnerEventId;
    state.boardSeed = boardSeed;
    state.cardCount = cardSessions.size;
    state.playerCount = cardSessions.size;
    return snapshot();
  },

  draw: async () => {
    await delay(30);
    assertBoardAuth();
    if (state.callingStyle === "manual") throw new Error("manual mode");
    const n = drawOne();
    if (n === null) throw new Error("pool empty");
    recomputeWinners();
    return snapshot();
  },

  reset: async () => {
    await delay(30);
    assertBoardAuth();
    resetGame();
    return {};
  },

  undo: async () => {
    await delay(30);
    assertBoardAuth();
    if (!callOrder.length) throw new Error("nothing to undo");
    const last = callOrder.pop()!;
    state.called = state.called.filter((n) => n !== last);
    if (!pool.includes(last)) pool.push(last);
    state.current = callOrder.length ? callOrder[callOrder.length - 1] : 0;
    state.remaining = pool.length;
    manualWinnerDeclared = false;
    state.manualWinnerDeclared = false;
    state.winnerDeclared = false;
    // Keep the game active after undoing back to zero calls.
    state.gameEstablished = true;
    recomputeWinners();
    return snapshot();
  },

  setCallingStyle: async (callingStyle: CallingStyle) => {
    await delay(20);
    assertBoardAuth();
    if (state.gameEstablished) throw new Error("game established");
    state.callingStyle = callingStyle;
    localStorage.setItem("bingo-callingStyle", callingStyle);
    return {};
  },

  callNumber: async (number: number) => {
    await delay(30);
    assertBoardAuth();
    if (state.callingStyle !== "manual") throw new Error("not manual");
    if (number < 1 || number > 75) throw new Error("invalid number");
    if (state.called.includes(number)) throw new Error("already called");
    state.called.push(number);
    callOrder.push(number);
    state.current = number;
    winnerSuppressed = false;
    pool = pool.filter((n) => n !== number);
    state.remaining = pool.length;
    if (!state.gameEstablished) state.gameEstablished = true;
    recomputeWinners();
    return snapshot();
  },

  setGameType: async (gameType: GameType) => {
    await delay(20);
    assertBoardAuth();
    state.gameType = gameType;
    state.patternIndex = 0;
    localStorage.setItem("bingo-gameType", gameType);
    recomputeWinners();
    return {};
  },

  declareWinner: async () => {
    await delay(20);
    assertBoardAuth();
    winnerSuppressed = false;
    manualWinnerDeclared = true;
    winnerEventId++;
    recomputeWinners();
    return {};
  },

  clearWinner: async () => {
    await delay(20);
    assertBoardAuth();
    manualWinnerDeclared = false;
    winnerSuppressed = true;
    for (const s of cardSessions.values()) {
      claimCurrentWinningPatterns(s);
    }
    recomputeWinners();
    return {};
  },

  setLedTestMode: async (enabled: boolean) => {
    await delay(10);
    assertBoardAuth();
    state.ledTestMode = enabled;
    return {};
  },

  setBrightness: async (value: number) => {
    await delay(10);
    assertBoardAuth();
    state.brightness = Math.max(0, Math.min(255, value));
    return {};
  },

  setTheme: async (theme: number) => {
    await delay(10);
    assertBoardAuth();
    state.theme = theme;
    state.colorMode = "theme";
    return {};
  },

  setColor: async (hex: string) => {
    await delay(10);
    assertBoardAuth();
    state.staticColor = hex.startsWith("#") ? hex : `#${hex}`;
    state.colorMode = "solid";
    return {};
  },

  unlockBoard: async (pin: string): Promise<BoardAuthSession> => {
    await delay(10);
    if (normalizePin(pin) !== normalizePin(boardPin)) throw new Error("401");
    boardAuth = { token: genToken(), ttlMs: nowMs() + BOARD_AUTH_TTL_MS };
    return boardAuth;
  },

  lockBoard: async () => {
    await delay(10);
    boardAuth = null;
    return {};
  },

  refreshBoardAuth: async (): Promise<BoardAuthSession> => {
    await delay(10);
    assertBoardAuth();
    boardAuth = { token: genToken(), ttlMs: nowMs() + BOARD_AUTH_TTL_MS };
    return boardAuth;
  },

  changeBoardPin: async (currentPin: string, nextPin: string) => {
    await delay(10);
    assertBoardAuth();
    const current = normalizePin(currentPin);
    const next = normalizePin(nextPin);
    if (current !== normalizePin(boardPin)) throw new Error("current pin invalid");
    if (!next || next.length < 4) throw new Error("next pin invalid");
    boardPin = next;
    return {};
  },

  joinCard: async (pin: string, numbers: Array<number | null>, cardId?: string): Promise<CardJoinResponse> => {
    await delay(15);
    if (normalizePin(pin) !== String(boardSeed)) throw new Error("invalid board seed");
    if (numbers.length !== 25) throw new Error("numbers[25] required");
    const id = cardId ?? genToken().slice(0, 16);
    const existing = cardSessions.get(id);
    const session: MockCardSession = existing ?? {
      cardId: id,
      numbers: [...numbers],
      marks: Array.from({ length: 25 }, (_, i) => i === 12),
      winner: false,
      claimedTraditionalMask: 0,
      claimedFourCornersMask: 0,
      claimedPostageMask: 0,
      claimedCoverAllMask: 0,
    claimedXMask: 0,
    claimedYMask: 0,
    claimedFrameOutsideMask: 0,
    claimedFrameInsideMask: 0,
    };
    session.numbers = [...numbers];
    session.marks = Array.from({ length: 25 }, (_, i) => i === 12);
    session.claimedTraditionalMask = 0;
    session.claimedFourCornersMask = 0;
    session.claimedPostageMask = 0;
    session.claimedCoverAllMask = 0;
    session.claimedXMask = 0;
    session.claimedYMask = 0;
    session.claimedFrameOutsideMask = 0;
    session.claimedFrameInsideMask = 0;
    cardSessions.set(id, session);
    recomputeWinners();
    return { cardId: id, winner: session.winner, winnerCount: state.winnerCount ?? 0, winnerEventId };
  },

  markCardCell: async (cardId: string, cellIndex: number, marked: boolean): Promise<CardJoinResponse> => {
    await delay(10);
    const session = cardSessions.get(cardId);
    if (!session) throw new Error("card not found");
    if (cellIndex < 0 || cellIndex > 24 || cellIndex === 12) throw new Error("invalid cell");
    session.marks[cellIndex] = marked;
    recomputeWinners();
    return { cardId, winner: session.winner, winnerCount: state.winnerCount ?? 0, winnerEventId };
  },

  leaveCard: async (cardId: string) => {
    await delay(10);
    if (!cardSessions.has(cardId)) throw new Error("card not found");
    cardSessions.delete(cardId);
    recomputeWinners();
    return {};
  },

  getCardState: async (cardId: string): Promise<CardStateResponse> => {
    await delay(10);
    const session = cardSessions.get(cardId);
    if (!session) throw new Error("card not found");
    recomputeWinners();
    return {
      cardId,
      winner: session.winner,
      winnerCount: state.winnerCount ?? 0,
      winnerEventId,
      marks: [...session.marks],
    };
  },
};

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
