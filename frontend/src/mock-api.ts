/**
 * In-memory mock backend that mirrors the ESP32 API.
 * Used for local UI development without hardware.
 */
import {
  DEFAULT_STATE,
  CYCLING_PATTERNS,
  type BoardAuthSession,
  type CardClaimResponse,
  type CardJoinResponse,
  type CardStateResponse,
  type GameState,
  type GameType,
  type CallingStyle,
  type Letter,
  type LetterFullMode,
  type CurrentNumberEffect,
  SCREENSAVER_TYPE_LABELS,
  type ScreensaverType,
  LETTER_FULL_MODE_LABELS,
  CURRENT_NUMBER_EFFECT_LABELS,
  type WebhookSettings,
} from "./types";

// Deep clone initial state, restoring persisted game type and calling style
const state: GameState = JSON.parse(JSON.stringify(DEFAULT_STATE));
let webhookSettings: WebhookSettings = {
  numberCalledUrl: localStorage.getItem("bingo-webhook-number-url") ?? "",
  bingoUrl: localStorage.getItem("bingo-webhook-bingo-url") ?? "",
};
state.webhookNumberConfigured = webhookSettings.numberCalledUrl.trim().length > 0;
state.webhookBingoConfigured = webhookSettings.bingoUrl.trim().length > 0;
const savedGameType = localStorage.getItem("bingo-gameType");
if (savedGameType && ["traditional", "four_corners", "postage_stamp", "cover_all", "x", "y", "frame_outside", "frame_inside", "plus_sign", "field_goal"].includes(savedGameType)) {
  state.gameType = savedGameType as GameType;
}
const savedCallingStyle = localStorage.getItem("bingo-callingStyle");
if (savedCallingStyle && ["automatic", "manual"].includes(savedCallingStyle)) {
  state.callingStyle = savedCallingStyle as CallingStyle;
}
const savedBrightnessRaw = localStorage.getItem("bingo-brightness");
if (savedBrightnessRaw !== null) {
  const savedBrightness = Number(savedBrightnessRaw);
  if (Number.isFinite(savedBrightness)) {
    state.brightness = Math.max(0, Math.min(255, Math.round(savedBrightness)));
  }
}
const savedLedVibranceRaw = localStorage.getItem("bingo-led-vibrance");
if (savedLedVibranceRaw !== null) {
  const savedLedVibrance = Number(savedLedVibranceRaw);
  if (Number.isFinite(savedLedVibrance)) {
    state.ledVibrance = Math.max(0, Math.min(100, Math.round(savedLedVibrance)));
  }
}
const savedScreensaverEnabledRaw = localStorage.getItem("bingo-screensaver-enabled");
if (savedScreensaverEnabledRaw !== null) {
  state.screensaverEnabled = savedScreensaverEnabledRaw === "true";
}
const savedScreensaverText = localStorage.getItem("bingo-screensaver-text");
if (savedScreensaverText && savedScreensaverText.trim().length > 0) {
  state.screensaverText = savedScreensaverText.slice(0, 80);
}
const savedScreensaverSpeedRaw = localStorage.getItem("bingo-screensaver-speed");
if (savedScreensaverSpeedRaw !== null) {
  const value = Number(savedScreensaverSpeedRaw);
  if (Number.isFinite(value)) {
    state.screensaverSpeedMs = Math.max(20, Math.min(500, Math.round(value)));
  }
}
const savedScreensaverType = localStorage.getItem("bingo-screensaver-type");
if (
  savedScreensaverType &&
  savedScreensaverType in SCREENSAVER_TYPE_LABELS
) {
  state.screensaverType = savedScreensaverType as ScreensaverType;
}
const savedScreensaverColor = localStorage.getItem("bingo-screensaver-color");
if (savedScreensaverColor && /^#?[0-9a-fA-F]{6}$/.test(savedScreensaverColor)) {
  state.screensaverColor = savedScreensaverColor.startsWith("#")
    ? savedScreensaverColor
    : `#${savedScreensaverColor}`;
}
const savedLetterFullMode = localStorage.getItem("bingo-letter-full-mode");
if (savedLetterFullMode && savedLetterFullMode in LETTER_FULL_MODE_LABELS) {
  state.letterFullMode = savedLetterFullMode as LetterFullMode;
}
const savedCurrentNumberEffect = localStorage.getItem("bingo-current-number-effect");
if (savedCurrentNumberEffect && savedCurrentNumberEffect in CURRENT_NUMBER_EFFECT_LABELS) {
  state.currentNumberEffect = savedCurrentNumberEffect as CurrentNumberEffect;
}
const savedCurrentNumberColor = localStorage.getItem("bingo-current-number-color");
if (savedCurrentNumberColor && /^#?[0-9a-fA-F]{6}$/.test(savedCurrentNumberColor)) {
  state.currentNumberColor = savedCurrentNumberColor.startsWith("#")
    ? savedCurrentNumberColor
    : `#${savedCurrentNumberColor}`;
}
const savedCalledNumberBanner = localStorage.getItem("bingo-called-number-banner");
if (savedCalledNumberBanner === "1" || savedCalledNumberBanner === "true") {
  state.calledNumberBanner = true;
} else if (savedCalledNumberBanner === "0" || savedCalledNumberBanner === "false") {
  state.calledNumberBanner = false;
}
const savedWinnerEffect = localStorage.getItem("bingo-winner-effect");
if (savedWinnerEffect && savedWinnerEffect in SCREENSAVER_TYPE_LABELS) {
  state.winnerEffect = savedWinnerEffect as ScreensaverType;
}
const savedWifiSsid = localStorage.getItem("bingo-wifi-ssid");
if (savedWifiSsid !== null) {
  state.wifiSsid = savedWifiSsid;
  state.wifiConfigured = savedWifiSsid.length > 0;
  state.wifiMode = savedWifiSsid.length > 0 ? "sta" : "ap";
  state.wifiConnected = savedWifiSsid.length > 0;
}
let pool: number[] = Array.from({ length: 75 }, (_, i) => i + 1);
let callOrder: number[] = [];
let boardSeed = Math.floor(1000 + Math.random() * 9000);
const BOARD_PIN_DEFAULT = "1975";
const BOARD_AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BOARD_UNLOCK_MAX_FAILURES = 5;
const BOARD_UNLOCK_LOCKOUT_MS = 30_000;
let boardPin = BOARD_PIN_DEFAULT;
let boardAuth: { token: string; expiryMs: number } | null = null;
let boardUnlockFailCount = 0;
let boardUnlockLockoutUntilMs = 0;
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
  claimedPlusSignMask: number;
  claimedFieldGoalMask: number;
}
const cardSessions = new Map<string, MockCardSession>();

function normalizePin(pin: string) {
  return pin.trim();
}

// Cycle patterns every 1.5s for game types that have cycling patterns (mirrors firmware)
let patternTimer: ReturnType<typeof setInterval> | null = null;
let mockDeviceId =
  localStorage.getItem("bingo-mock-device-id") ||
  Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
localStorage.setItem("bingo-mock-device-id", mockDeviceId);
let autoCallingTimer: ReturnType<typeof setInterval> | null = null;
let autoCallingNextAtMs = 0;
let autoCallingHold = false;
let autoCallingWaitForAudio = false;
let autoCallingHoldSinceMs = 0;
let pendingWinnerActivation = false;
let pendingWinnerEventBump = false;
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

function startAutoCallingLoop() {
  if (autoCallingTimer) return;
  autoCallingTimer = setInterval(() => {
    if (!state.autoCallingEnabled) {
      autoCallingNextAtMs = 0;
      autoCallingHold = false;
      state.autoCallingHold = false;
      state.autoCallingRemainingMs = 0;
      return;
    }
    if (state.callingStyle !== "automatic" || state.winnerDeclared || state.remaining <= 0) {
      if (!autoCallingHold) {
        autoCallingNextAtMs = 0;
        state.autoCallingRemainingMs = 0;
      } else if (autoCallingNextAtMs > 0) {
        state.autoCallingRemainingMs = Math.max(0, autoCallingNextAtMs - Date.now());
      }
      return;
    }
    const now = Date.now();
    const intervalMs = Math.max(1000, (state.autoCallingSeconds ?? 10) * 1000);
    if (autoCallingHold) {
      if (autoCallingHoldSinceMs > 0 && now - autoCallingHoldSinceMs > 8000) {
        autoCallingHold = false;
        state.autoCallingHold = false;
        autoCallingHoldSinceMs = 0;
      } else {
        // Countdown keeps running while audio plays.
        if (autoCallingNextAtMs <= 0) autoCallingNextAtMs = now + intervalMs;
        state.autoCallingRemainingMs = Math.max(0, autoCallingNextAtMs - now);
        return;
      }
    }
    if (autoCallingNextAtMs <= 0) {
      autoCallingNextAtMs = now + intervalMs;
    }
    if (now >= autoCallingNextAtMs) {
      const n = drawOne();
      if (n === null) {
        state.autoCallingEnabled = false;
        autoCallingNextAtMs = 0;
        autoCallingHold = false;
        state.autoCallingHold = false;
        state.autoCallingRemainingMs = 0;
        return;
      }
      recomputeWinners();
      autoCallingNextAtMs = now + intervalMs;
      if (autoCallingWaitForAudio) {
        autoCallingHold = true;
        state.autoCallingHold = true;
        autoCallingHoldSinceMs = now;
      }
    }
    state.autoCallingRemainingMs = Math.max(0, autoCallingNextAtMs - now);
  }, 200);
}
startAutoCallingLoop();

function syncScreensaverActive() {
  state.screensaverActive = Boolean(state.screensaverEnabled && !state.ledTestMode);
}

function snapshot(): GameState {
  syncScreensaverActive();
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

/** Content-addressed id — matches firmware cardIdFromCardNumbers (QR == identity). */
function contentCardId(numbers: Array<number | null>): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < 25; i++) {
    if (i === 12) continue;
    h ^= (typeof numbers[i] === "number" ? numbers[i]! : 0) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `c${h.toString(16).padStart(8, "0")}`;
}

function hasBoardAuth() {
  if (!boardAuth) return false;
  return boardAuth.expiryMs > nowMs();
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

function plusSignSatisfiedMask(session: MockCardSession): number {
  const pattern = [2, 7, 10, 11, 12, 13, 14, 17, 22];
  return pattern.every((idx) => effectiveMarked(session, idx)) ? 1 : 0;
}

function fieldGoalSatisfiedMask(session: MockCardSession): number {
  const pattern = [0, 4, 5, 9, 10, 11, 12, 13, 14, 17, 22];
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
  if (state.gameType === "plus_sign") return plusSignSatisfiedMask(session);
  if (state.gameType === "field_goal") return fieldGoalSatisfiedMask(session);
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
  if (state.gameType === "plus_sign") return session.claimedPlusSignMask;
  if (state.gameType === "field_goal") return session.claimedFieldGoalMask;
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
  else if (state.gameType === "plus_sign") session.claimedPlusSignMask |= satisfied;
  else if (state.gameType === "field_goal") session.claimedFieldGoalMask |= satisfied;
}

function flushPendingWinnerActivation() {
  if (!pendingWinnerActivation) return;
  pendingWinnerActivation = false;
  const want = !winnerSuppressed && ((state.winnerCount ?? 0) > 0 || manualWinnerDeclared);
  if (!want) {
    pendingWinnerEventBump = false;
    state.winnerDeclared = false;
    return;
  }
  if (pendingWinnerEventBump) {
    winnerEventId++;
    pendingWinnerEventBump = false;
  }
  state.winnerDeclared = true;
  state.winnerEventId = winnerEventId;
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
  if (winnerSuppressed && hasNewWinnerEvent) {
    // New unclaimed winner appeared after keep-going.
    winnerSuppressed = false;
  }
  state.winnerCount = winners;
  state.manualWinnerDeclared = manualWinnerDeclared;
  state.cardCount = cardSessions.size;
  state.playerCount = cardSessions.size;

  const wantDeclare = !winnerSuppressed && (winners > 0 || manualWinnerDeclared);
  if (!wantDeclare) {
    state.winnerDeclared = false;
    pendingWinnerActivation = false;
    pendingWinnerEventBump = false;
    state.winnerEventId = winnerEventId;
    return;
  }

  if (hasNewWinnerEvent) {
    if (autoCallingWaitForAudio && autoCallingHold && !state.winnerDeclared) {
      pendingWinnerEventBump = true;
    } else {
      winnerEventId++;
    }
  }

  if (autoCallingWaitForAudio && autoCallingHold && !state.winnerDeclared) {
    pendingWinnerActivation = true;
    state.winnerDeclared = false;
    // Hide pending winners from board UI until call-out audio finishes.
    state.winnerCount = 0;
    state.winnerEventId = winnerEventId;
    return;
  }

  pendingWinnerActivation = false;
  if (pendingWinnerEventBump) {
    winnerEventId++;
    pendingWinnerEventBump = false;
  }
  state.winnerDeclared = true;
  state.winnerCount = winners;
  state.winnerEventId = winnerEventId;
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
  pendingWinnerActivation = false;
  pendingWinnerEventBump = false;
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
    s.claimedPlusSignMask = 0;
    s.claimedFieldGoalMask = 0;
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
    state.screensaverEnabled = false;
    localStorage.setItem("bingo-screensaver-enabled", "false");
    syncScreensaverActive();
    const n = drawOne();
    if (n === null) throw new Error("pool empty");
    recomputeWinners();
    return snapshot();
  },

  reset: async () => {
    await delay(30);
    assertBoardAuth();
    resetGame();
  state.autoCallingEnabled = false;
  state.autoCallingRemainingMs = 0;
  autoCallingNextAtMs = 0;
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
    if (callingStyle === "manual") {
      state.autoCallingEnabled = false;
      state.autoCallingRemainingMs = 0;
      autoCallingNextAtMs = 0;
    }
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
    if (state.gameEstablished && !state.winnerDeclared) {
      throw new Error("409");
    }
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

  setScreensaverEnabled: async (enabled: boolean) => {
    await delay(10);
    assertBoardAuth();
    state.screensaverEnabled = enabled;
    if (enabled && state.ledTestMode) state.ledTestMode = false;
    localStorage.setItem("bingo-screensaver-enabled", String(enabled));
    syncScreensaverActive();
    return { ...state };
  },

  setScreensaverText: async (text: string) => {
    await delay(10);
    assertBoardAuth();
    const normalized = text.trim().length ? text.trim() : "BINGO";
    state.screensaverText = normalized.slice(0, 80);
    localStorage.setItem("bingo-screensaver-text", state.screensaverText);
    return {};
  },

  setScreensaverSpeed: async (value: number) => {
    await delay(10);
    assertBoardAuth();
    state.screensaverSpeedMs = Math.max(20, Math.min(500, Math.round(value)));
    localStorage.setItem("bingo-screensaver-speed", String(state.screensaverSpeedMs));
    return {};
  },

  setScreensaverType: async (type: ScreensaverType) => {
    await delay(10);
    assertBoardAuth();
    state.screensaverType = type;
    localStorage.setItem("bingo-screensaver-type", type);
    return {};
  },

  setScreensaverColor: async (hex: string) => {
    await delay(10);
    assertBoardAuth();
    state.screensaverColor = hex.startsWith("#") ? hex : `#${hex}`;
    localStorage.setItem("bingo-screensaver-color", state.screensaverColor);
    return {};
  },

  setAutoCallingEnabled: async (enabled: boolean) => {
    await delay(10);
    assertBoardAuth();
    if (state.callingStyle !== "automatic") throw new Error("automatic mode required");
    state.autoCallingEnabled = enabled;
    autoCallingHold = false;
    state.autoCallingHold = false;
    autoCallingHoldSinceMs = 0;
    if (!enabled) {
      autoCallingNextAtMs = 0;
      state.autoCallingRemainingMs = 0;
      return snapshot();
    }
    const intervalMs = Math.max(1000, (state.autoCallingSeconds ?? 10) * 1000);
    // Play = immediate draw, then arm countdown for the next call.
    if (!state.winnerDeclared && state.remaining > 0) {
      const n = drawOne();
      if (n === null) {
        state.autoCallingEnabled = false;
        autoCallingNextAtMs = 0;
        state.autoCallingRemainingMs = 0;
        return snapshot();
      }
      recomputeWinners();
      autoCallingNextAtMs = Date.now() + intervalMs;
      if (autoCallingWaitForAudio) {
        autoCallingHold = true;
        state.autoCallingHold = true;
        autoCallingHoldSinceMs = Date.now();
      }
      state.autoCallingRemainingMs = intervalMs;
    } else {
      autoCallingNextAtMs = Date.now() + intervalMs;
      state.autoCallingRemainingMs = intervalMs;
    }
    return snapshot();
  },

  setAutoCallingSeconds: async (value: number) => {
    await delay(10);
    assertBoardAuth();
    state.autoCallingSeconds = Math.max(1, Math.min(600, Math.round(value)));
    if (state.autoCallingEnabled && !autoCallingHold) {
      autoCallingNextAtMs = Date.now() + state.autoCallingSeconds * 1000;
      state.autoCallingRemainingMs = state.autoCallingSeconds * 1000;
    }
    return {};
  },

  setAutoCallingHold: async (hold: boolean) => {
    await delay(5);
    assertBoardAuth();
    autoCallingHold = hold;
    state.autoCallingHold = hold;
    if (hold) {
      autoCallingHoldSinceMs = Date.now();
    } else {
      // Do not reschedule — overdue deadlines draw on the next loop tick.
      autoCallingHoldSinceMs = 0;
      if (pendingWinnerActivation) {
        // Restore real winner count before flush (hidden while pending).
        let winners = 0;
        for (const s of cardSessions.values()) {
          if (s.winner) winners++;
        }
        state.winnerCount = winners;
        flushPendingWinnerActivation();
      }
    }
    if (autoCallingNextAtMs > 0) {
      state.autoCallingRemainingMs = Math.max(0, autoCallingNextAtMs - Date.now());
    }
    return {};
  },

  setAutoCallingWaitForAudio: async (enabled: boolean) => {
    await delay(5);
    assertBoardAuth();
    autoCallingWaitForAudio = enabled;
    if (!enabled && autoCallingHold) {
      autoCallingHold = false;
      state.autoCallingHold = false;
      autoCallingHoldSinceMs = 0;
    }
    return {};
  },

  setBrightness: async (value: number) => {
    await delay(10);
    assertBoardAuth();
    state.brightness = Math.max(0, Math.min(255, value));
    localStorage.setItem("bingo-brightness", String(state.brightness));
    return {};
  },

  setLedVibrance: async (value: number) => {
    await delay(10);
    assertBoardAuth();
    state.ledVibrance = Math.max(0, Math.min(100, Math.round(value)));
    localStorage.setItem("bingo-led-vibrance", String(state.ledVibrance));
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

  setLedHeaderColor: async (hex: string) => {
    await delay(10);
    assertBoardAuth();
    state.ledHeaderColor = hex.startsWith("#") ? hex : `#${hex}`;
    return {};
  },

  setLedGameTypeColor: async (hex: string) => {
    await delay(10);
    assertBoardAuth();
    state.ledGameTypeColor = hex.startsWith("#") ? hex : `#${hex}`;
    return {};
  },

  setLedLetterColors: async (colors: Record<Letter, string>) => {
    await delay(10);
    assertBoardAuth();
    state.ledLetterColors = {
      B: colors.B.startsWith("#") ? colors.B : `#${colors.B}`,
      I: colors.I.startsWith("#") ? colors.I : `#${colors.I}`,
      N: colors.N.startsWith("#") ? colors.N : `#${colors.N}`,
      G: colors.G.startsWith("#") ? colors.G : `#${colors.G}`,
      O: colors.O.startsWith("#") ? colors.O : `#${colors.O}`,
    };
    state.colorMode = "custom";
    return {};
  },

  setLetterFullMode: async (mode: LetterFullMode) => {
    await delay(10);
    assertBoardAuth();
    if (!(mode in LETTER_FULL_MODE_LABELS)) throw new Error("invalid mode");
    state.letterFullMode = mode;
    localStorage.setItem("bingo-letter-full-mode", mode);
    return {};
  },

  setCurrentNumberEffect: async (effect: CurrentNumberEffect) => {
    await delay(10);
    assertBoardAuth();
    if (!(effect in CURRENT_NUMBER_EFFECT_LABELS)) throw new Error("invalid effect");
    state.currentNumberEffect = effect;
    localStorage.setItem("bingo-current-number-effect", effect);
    return {};
  },

  setCurrentNumberColor: async (hex: string) => {
    await delay(10);
    assertBoardAuth();
    const normalized = hex.startsWith("#") ? hex : `#${hex}`;
    state.currentNumberColor = normalized;
    localStorage.setItem("bingo-current-number-color", normalized);
    return {};
  },

  setCalledNumberBanner: async (enabled: boolean) => {
    await delay(10);
    assertBoardAuth();
    state.calledNumberBanner = Boolean(enabled);
    localStorage.setItem("bingo-called-number-banner", enabled ? "1" : "0");
    return {};
  },

  setWinnerEffect: async (type: ScreensaverType) => {
    await delay(10);
    assertBoardAuth();
    if (!(type in SCREENSAVER_TYPE_LABELS)) throw new Error("400");
    state.winnerEffect = type;
    localStorage.setItem("bingo-winner-effect", type);
    return {};
  },

  getWebhooks: async (): Promise<WebhookSettings> => {
    await delay(10);
    assertBoardAuth();
    return { ...webhookSettings };
  },

  setWebhooks: async (settings: WebhookSettings) => {
    await delay(10);
    assertBoardAuth();
    webhookSettings = {
      numberCalledUrl: (settings.numberCalledUrl ?? "").trim().slice(0, 256),
      bingoUrl: (settings.bingoUrl ?? "").trim().slice(0, 256),
    };
    localStorage.setItem("bingo-webhook-number-url", webhookSettings.numberCalledUrl);
    localStorage.setItem("bingo-webhook-bingo-url", webhookSettings.bingoUrl);
    state.webhookNumberConfigured = webhookSettings.numberCalledUrl.length > 0;
    state.webhookBingoConfigured = webhookSettings.bingoUrl.length > 0;
    return {};
  },

  setWifiCredentials: async (ssid: string, password?: string) => {
    await delay(10);
    assertBoardAuth();
    const trimmed = ssid.trim();
    state.wifiSsid = trimmed;
    state.wifiConfigured = trimmed.length > 0;
    state.wifiMode = trimmed.length > 0 ? "sta" : "ap";
    state.wifiConnected = trimmed.length > 0;
    localStorage.setItem("bingo-wifi-ssid", trimmed);
    if (password !== undefined) {
      localStorage.setItem("bingo-wifi-password", password);
    } else if (trimmed.length === 0) {
      localStorage.removeItem("bingo-wifi-password");
    }
    return { restartRequired: true };
  },

  unlockBoard: async (pin: string): Promise<BoardAuthSession> => {
    await delay(10);
    const now = nowMs();
    if (boardUnlockLockoutUntilMs > now) throw new Error("429");
    if (boardUnlockLockoutUntilMs > 0 && boardUnlockLockoutUntilMs <= now) {
      boardUnlockLockoutUntilMs = 0;
      boardUnlockFailCount = 0;
    }
    if (normalizePin(pin) !== normalizePin(boardPin)) {
      boardUnlockFailCount += 1;
      if (boardUnlockFailCount >= BOARD_UNLOCK_MAX_FAILURES) {
        boardUnlockLockoutUntilMs = now + BOARD_UNLOCK_LOCKOUT_MS;
        boardUnlockFailCount = 0;
        throw new Error("429");
      }
      throw new Error("401");
    }
    boardUnlockFailCount = 0;
    boardUnlockLockoutUntilMs = 0;
    boardAuth = { token: genToken(), expiryMs: now + BOARD_AUTH_TTL_MS };
    return { token: boardAuth.token, ttlMs: BOARD_AUTH_TTL_MS };
  },

  lockBoard: async () => {
    await delay(10);
    boardAuth = null;
    return {};
  },

  refreshBoardAuth: async (): Promise<BoardAuthSession> => {
    await delay(10);
    assertBoardAuth();
    boardAuth = { token: boardAuth!.token, expiryMs: nowMs() + BOARD_AUTH_TTL_MS };
    return { token: boardAuth.token, ttlMs: BOARD_AUTH_TTL_MS };
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

  joinCard: async (numbers: Array<number | null>, cardId?: string): Promise<CardJoinResponse> => {
    await delay(15);
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
      claimedPlusSignMask: 0,
      claimedFieldGoalMask: 0,
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
    session.claimedPlusSignMask = 0;
    session.claimedFieldGoalMask = 0;
    cardSessions.set(id, session);
    recomputeWinners();
    return { cardId: id, winner: session.winner, winnerCount: state.winnerCount ?? 0, winnerEventId };
  },

  claimPrintedCard: async (
    numbers: Array<number | null>,
    sig?: string | null,
    options?: { autoSync?: boolean }
  ): Promise<CardClaimResponse> => {
    await delay(15);
    if (numbers.length !== 25) throw new Error("numbers[25] required");
    const { signCardWithDeviceId } = await import("@/lib/bingo-card-codec");
    const expected = await signCardWithDeviceId(numbers, mockDeviceId);
    const authentic = Boolean(sig && sig === expected);
    const id = contentCardId(numbers);
    const syncMarks = options?.autoSync !== false;
    const calledSet = new Set(state.called);
    const marks = numbers.map((n, i) =>
      i === 12 || (syncMarks && typeof n === "number" && calledSet.has(n))
    );
    const existing = cardSessions.get(id);
    const session: MockCardSession = existing ?? {
      cardId: id,
      numbers: [...numbers],
      marks: [...marks],
      winner: false,
      claimedTraditionalMask: 0,
      claimedFourCornersMask: 0,
      claimedPostageMask: 0,
      claimedCoverAllMask: 0,
      claimedXMask: 0,
      claimedYMask: 0,
      claimedFrameOutsideMask: 0,
      claimedFrameInsideMask: 0,
      claimedPlusSignMask: 0,
      claimedFieldGoalMask: 0,
    };
    session.numbers = [...numbers];
    session.marks = [...marks];
    session.claimedTraditionalMask = 0;
    session.claimedFourCornersMask = 0;
    session.claimedPostageMask = 0;
    session.claimedCoverAllMask = 0;
    session.claimedXMask = 0;
    session.claimedYMask = 0;
    session.claimedFrameOutsideMask = 0;
    session.claimedFrameInsideMask = 0;
    session.claimedPlusSignMask = 0;
    session.claimedFieldGoalMask = 0;
    cardSessions.set(id, session);
    recomputeWinners();
    return {
      cardId: id,
      winner: session.winner,
      winnerCount: state.winnerCount ?? 0,
      winnerEventId,
      marks: [...session.marks],
      authentic,
    };
  },

  getDeviceId: async () => {
    await delay(5);
    assertBoardAuth();
    return { deviceId: mockDeviceId };
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

  syncCardMarks: async (cardId: string, marks: boolean[]): Promise<CardJoinResponse> => {
    await delay(10);
    const session = cardSessions.get(cardId);
    if (!session) throw new Error("card not found");
    if (!Array.isArray(marks) || marks.length !== 25) throw new Error("invalid marks");
    for (let i = 0; i < 25; i++) {
      session.marks[i] = i === 12 ? true : Boolean(marks[i]);
    }
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
