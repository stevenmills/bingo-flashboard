/**
 * In-memory mock backend that mirrors the ESP32 API.
 * Used for local UI development without hardware.
 */
import {
  DEFAULT_STATE,
  CYCLING_PATTERNS,
  ALL_GAME_TYPES,
  GAME_TYPE_BY_ID,
  isGameType,
  type AnyGameType,
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
  type BingoUiThemeId,
  SCREENSAVER_TYPE_LABELS,
  type ScreensaverType,
  LETTER_FULL_MODE_LABELS,
  CURRENT_NUMBER_EFFECT_LABELS,
  type WebhookSettings,
  type NumberGifSettings,
} from "./types";
import { isBingoUiThemeId, normalizeHexColor } from "./lib/bingo-ui-colors";

const GIF_URL_MAX_LEN = 256;
const GIF_MAP_BLOB_MAX = 6144;

// Deep clone initial state, restoring persisted game type and calling style
const state: GameState = JSON.parse(JSON.stringify(DEFAULT_STATE));
state.survivorCount = state.survivorCount ?? 0;
state.eliminatedCount = state.eliminatedCount ?? 0;
let webhookSettings: WebhookSettings = {
  numberCalledUrl: localStorage.getItem("bingo-webhook-number-url") ?? "",
  bingoUrl: localStorage.getItem("bingo-webhook-bingo-url") ?? "",
};
state.webhookNumberConfigured = webhookSettings.numberCalledUrl.trim().length > 0;
state.webhookBingoConfigured = webhookSettings.bingoUrl.trim().length > 0;

function readNumberGifUrls(): Record<string, string> {
  try {
    const raw = localStorage.getItem("bingo-number-gif-urls");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

let numberGifUrls: Record<string, string> = readNumberGifUrls();
state.gifModeEnabled = localStorage.getItem("bingo-gif-mode-enabled") === "1";

function syncCurrentGifUrl() {
  const n = state.current;
  if (typeof n === "number" && n >= 1 && n <= 75 && numberGifUrls[String(n)]) {
    state.currentGifUrl = numberGifUrls[String(n)];
  } else {
    state.currentGifUrl = "";
  }
}
syncCurrentGifUrl();
const savedGameType = localStorage.getItem("bingo-gameType");
if (savedGameType && isGameType(savedGameType)) {
  state.gameType = savedGameType;
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
  claimedPatternMasks: number[];
  claimedElimination: boolean;
  eliminated: boolean;
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
    const patterns = CYCLING_PATTERNS[state.gameType as GameType];
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
      } else {
        state.autoCallingRemainingMs = 0;
      }
      return;
    }
    const now = Date.now();
    const intervalMs = Math.max(1000, (state.autoCallingSeconds ?? 10) * 1000);
    if (autoCallingHold) {
      if (autoCallingHoldSinceMs > 0 && now - autoCallingHoldSinceMs > 45000) {
        autoCallingHold = false;
        state.autoCallingHold = false;
        autoCallingHoldSinceMs = 0;
        autoCallingNextAtMs = now + intervalMs;
      } else {
        // Countdown starts only after number (+ jokes) finish.
        autoCallingNextAtMs = 0;
        state.autoCallingRemainingMs = 0;
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
      if (autoCallingWaitForAudio) {
        autoCallingHold = true;
        state.autoCallingHold = true;
        autoCallingHoldSinceMs = now;
        autoCallingNextAtMs = 0;
        state.autoCallingRemainingMs = 0;
        return;
      }
      autoCallingNextAtMs = now + intervalMs;
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
  syncCurrentGifUrl();
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

function gameTypeIndex(gameType: string = String(state.gameType)): number {
  const idx = ALL_GAME_TYPES.indexOf(gameType as GameType);
  return idx >= 0 ? idx : 0;
}

function emptyClaimedMasks(): number[] {
  return Array.from({ length: ALL_GAME_TYPES.length }, () => 0);
}

function satisfiedMaskForCurrentGameType(session: MockCardSession): number {
  if (!isGameType(String(state.gameType))) return 0;
  const def = GAME_TYPE_BY_ID[state.gameType as GameType];
  if (!def) return 0;
  if (def.coveredThreshold > 0) {
    let covered = 0;
    for (let i = 0; i < 25; i++) if (effectiveMarked(session, i)) covered++;
    return covered >= def.coveredThreshold ? 1 : 0;
  }
  let mask = 0;
  def.winPatterns.forEach((pattern: number[], alt: number) => {
    if (alt >= 32) return;
    const ok = pattern.every((cell1: number) => effectiveMarked(session, cell1 - 1));
    if (ok) mask |= 1 << alt;
  });
  return mask;
}

function claimedMaskForCurrentGameType(session: MockCardSession): number {
  return session.claimedPatternMasks[gameTypeIndex()] ?? 0;
}

function sessionCardAllPopulatedCalled(session: MockCardSession): boolean {
  let populated = 0;
  for (let i = 0; i < 25; i++) {
    const n = session.numbers[i];
    if (typeof n !== "number" || n < 1 || n > 75) continue;
    populated++;
    if (!state.called.includes(n)) return false;
  }
  return populated > 0;
}

function sessionHasWinningPattern(session: MockCardSession): boolean {
  if (state.gameType === "battleship") return session.winner;
  const satisfied = satisfiedMaskForCurrentGameType(session);
  const claimed = claimedMaskForCurrentGameType(session);
  const available = satisfied & ~claimed;
  const required = isGameType(String(state.gameType))
    ? (GAME_TYPE_BY_ID[state.gameType as GameType]?.requiredPatterns ?? 1)
    : 1;
  if (required > 1) {
    let count = 0;
    for (let bits = available; bits !== 0; bits &= bits - 1) count++;
    return count >= required;
  }
  return available !== 0;
}

function claimCurrentWinningPatterns(session: MockCardSession) {
  if (state.gameType === "battleship") {
    session.claimedElimination = true;
    session.winner = false;
    return;
  }
  const idx = gameTypeIndex();
  session.claimedPatternMasks[idx] =
    (session.claimedPatternMasks[idx] ?? 0) | satisfiedMaskForCurrentGameType(session);
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
  state.survivorCount = 0;
  state.eliminatedCount = 0;

  if (state.gameType === "battleship") {
    const justSunk: MockCardSession[] = [];
    for (const s of cardSessions.values()) {
      const sunk = sessionCardAllPopulatedCalled(s);
      if (sunk && !s.eliminated) {
        s.eliminated = true;
        justSunk.push(s);
      }
      if (s.eliminated) state.eliminatedCount = (state.eliminatedCount ?? 0) + 1;
      else state.survivorCount = (state.survivorCount ?? 0) + 1;
    }

    for (const s of cardSessions.values()) {
      const wasWinner = s.winner;
      let win = false;
      if (!s.claimedElimination) {
        if ((state.survivorCount ?? 0) === 1 && (state.eliminatedCount ?? 0) >= 1 && !s.eliminated) {
          win = true;
        } else if ((state.survivorCount ?? 0) === 0 && justSunk.length > 0) {
          win = justSunk.includes(s);
        }
      }
      s.winner = win;
      if (!wasWinner && win) hasNewWinnerEvent = true;
      if (win) winners++;
    }
  } else {
    for (const s of cardSessions.values()) {
      const wasWinner = s.winner;
      s.winner = sessionHasWinningPattern(s);
      if (!wasWinner && s.winner) hasNewWinnerEvent = true;
      if (s.winner) winners++;
    }
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
  state.survivorCount = 0;
  state.eliminatedCount = 0;
  for (const s of cardSessions.values()) {
    s.marks = s.marks.map((_, i) => i === 12);
    s.winner = false;
    s.claimedPatternMasks = emptyClaimedMasks();
    s.claimedElimination = false;
    s.eliminated = false;
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
    if (!isGameType(gameType)) throw new Error("invalid");
    state.gameType = gameType;
    state.patternIndex = 0;
    localStorage.setItem("bingo-gameType", gameType);
    recomputeWinners();
    return {};
  },

  setGameSelection: async (gameType: AnyGameType) => {
    await delay(20);
    assertBoardAuth();
    if (state.gameEstablished && !state.winnerDeclared) {
      throw new Error("409");
    }
    if (!isGameType(gameType)) throw new Error("invalid");
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
      if (autoCallingWaitForAudio) {
        autoCallingHold = true;
        state.autoCallingHold = true;
        autoCallingHoldSinceMs = Date.now();
        autoCallingNextAtMs = 0;
        state.autoCallingRemainingMs = 0;
      } else {
        autoCallingNextAtMs = Date.now() + intervalMs;
        state.autoCallingRemainingMs = intervalMs;
      }
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
    const wasHeld = autoCallingHold;
    autoCallingHold = hold;
    state.autoCallingHold = hold;
    if (hold) {
      autoCallingHoldSinceMs = Date.now();
      autoCallingNextAtMs = 0;
      state.autoCallingRemainingMs = 0;
    } else {
      autoCallingHoldSinceMs = 0;
      // Start the next countdown only after call-out (+ jokes) finished.
      if (
        wasHeld &&
        state.autoCallingEnabled &&
        state.callingStyle === "automatic" &&
        !state.winnerDeclared &&
        state.remaining > 0
      ) {
        const intervalMs = Math.max(1000, (state.autoCallingSeconds ?? 10) * 1000);
        autoCallingNextAtMs = Date.now() + intervalMs;
        state.autoCallingRemainingMs = intervalMs;
      } else if (!state.autoCallingEnabled) {
        autoCallingNextAtMs = 0;
        state.autoCallingRemainingMs = 0;
      }
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
      if (
        state.autoCallingEnabled &&
        state.callingStyle === "automatic" &&
        !state.winnerDeclared &&
        state.remaining > 0
      ) {
        const intervalMs = Math.max(1000, (state.autoCallingSeconds ?? 10) * 1000);
        autoCallingNextAtMs = Date.now() + intervalMs;
        state.autoCallingRemainingMs = intervalMs;
      }
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

  setLedMatchUiColors: async () => {
    await delay(10);
    assertBoardAuth();
    state.colorMode = "ui";
    return {};
  },

  setUiColors: async (theme: string, colors: Record<Letter, string>) => {
    await delay(10);
    assertBoardAuth();
    if (!isBingoUiThemeId(theme)) throw new Error("invalid theme");
    state.uiColorTheme = theme as BingoUiThemeId;
    state.uiCustomColors = {
      B: normalizeHexColor(colors.B),
      I: normalizeHexColor(colors.I),
      N: normalizeHexColor(colors.N),
      G: normalizeHexColor(colors.G),
      O: normalizeHexColor(colors.O),
    };
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

  getNumberGifs: async (): Promise<NumberGifSettings> => {
    await delay(10);
    assertBoardAuth();
    return { enabled: Boolean(state.gifModeEnabled), urls: { ...numberGifUrls } };
  },

  setNumberGifs: async (settings: Pick<NumberGifSettings, "urls"> & { enabled?: boolean }) => {
    await delay(10);
    assertBoardAuth();
    const next: Record<string, string> = {};
    const urls = settings.urls ?? {};
    for (const [k, v] of Object.entries(urls)) {
      const n = Number.parseInt(k, 10);
      if (!Number.isFinite(n) || n < 1 || n > 75) throw new Error("invalid number key");
      const url = typeof v === "string" ? v.trim() : "";
      if (!url) continue;
      if (url.length > GIF_URL_MAX_LEN) throw new Error("url too long");
      if (!/^https?:\/\//i.test(url)) throw new Error("url must be http(s)");
      next[String(n)] = url;
    }
    if (JSON.stringify(next).length > GIF_MAP_BLOB_MAX) throw new Error("map too large for NVS");
    numberGifUrls = next;
    localStorage.setItem("bingo-number-gif-urls", JSON.stringify(numberGifUrls));
    if (typeof settings.enabled === "boolean") {
      state.gifModeEnabled = settings.enabled;
      localStorage.setItem("bingo-gif-mode-enabled", settings.enabled ? "1" : "0");
    }
    syncCurrentGifUrl();
    return {};
  },

  setGifMode: async (enabled: boolean) => {
    await delay(10);
    // Public — matches firmware /gif-mode (HUD can toggle without PIN).
    state.gifModeEnabled = Boolean(enabled);
    localStorage.setItem("bingo-gif-mode-enabled", state.gifModeEnabled ? "1" : "0");
    syncCurrentGifUrl();
    return {};
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

  scanWifiNetworks: async () => {
    await delay(80);
    assertBoardAuth();
    return {
      status: "done" as const,
      networks: [
        { ssid: "ExampleHome", rssi: -48, secure: true },
        { ssid: "ExampleCafe", rssi: -67, secure: true },
        { ssid: "OpenGuest", rssi: -72, secure: false },
        ...(state.wifiSsid
          ? [{ ssid: state.wifiSsid, rssi: -55, secure: true }]
          : []),
      ].filter(
        (n, i, arr) => arr.findIndex((x) => x.ssid === n.ssid) === i
      ),
    };
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
    // Keep a shared token so unlocking on a second device does not kick the first.
    if (boardAuth && boardAuth.expiryMs > now) {
      boardAuth = { token: boardAuth.token, expiryMs: now + BOARD_AUTH_TTL_MS };
    } else {
      boardAuth = { token: genToken(), expiryMs: now + BOARD_AUTH_TTL_MS };
    }
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

  restartBoard: async () => {
    await delay(10);
    assertBoardAuth();
    console.info("[mock] board restart requested");
    return { ok: true };
  },

  joinCard: async (
    numbers: Array<number | null>,
    cardId?: string
  ): Promise<CardJoinResponse> => {
    await delay(15);
    if (numbers.length !== 25) throw new Error("numbers[25] required");
    const id = cardId ?? genToken().slice(0, 16);
    const existing = cardSessions.get(id);
    const session: MockCardSession = existing ?? {
      cardId: id,
      numbers: [...numbers],
      marks: Array.from({ length: 25 }, (_, i) => i === 12),
      winner: false,
      claimedPatternMasks: emptyClaimedMasks(),
      claimedElimination: false,
      eliminated: false,
    };
    session.numbers = [...numbers];
    session.marks = Array.from({ length: 25 }, (_, i) => i === 12);
    session.claimedPatternMasks = emptyClaimedMasks();
    session.claimedElimination = false;
    session.eliminated = false;
    session.winner = false;
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
      claimedPatternMasks: emptyClaimedMasks(),
      claimedElimination: false,
      eliminated: false,
    };
    session.numbers = [...numbers];
    session.marks = [...marks];
    session.claimedPatternMasks = emptyClaimedMasks();
    session.claimedElimination = false;
    session.eliminated = false;
    session.winner = false;
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
    if (cellIndex < 0 || cellIndex > 24) throw new Error("invalid cell");
    if (cellIndex === 12) throw new Error("invalid cell");
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
