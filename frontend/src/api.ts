import type {
  BoardAuthSession,
  CardClaimResponse,
  CardJoinResponse,
  CardStateResponse,
  GameState,
  GameType,
  CallingStyle,
  Letter,
  LetterFullMode,
  CurrentNumberEffect,
  ScreensaverType,
} from "./types";
import {
  BOARD_SESSION_MS,
  BOARD_TOKEN_EXPIRY_STORAGE_KEY,
  BOARD_TOKEN_STORAGE_KEY,
} from "@/lib/board-auth";
import { mockApi } from "./mock-api";
import { isValidSnapshot } from "@/lib/game-state-merge";

const BASE = "";

/**
 * If VITE_MOCK is set, or the first real fetch fails, we switch to the
 * in-memory mock backend for the rest of the session.
 */
let useMock = import.meta.env.VITE_MOCK === "true";
const sharedMockMode = import.meta.env.VITE_SHARED_MOCK === "true";
let mockDetected = false;
let boardToken: string | null = null;
let wsRequestSeq = 0;

/** True when UI is served from the ESP32 (AP, STA, or mDNS) — not localhost dev. */
export function isOnBoardHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1";
}

/** Never use in-memory mock when talking to real hardware. */
function shouldUseMock(): boolean {
  if (import.meta.env.VITE_MOCK === "true") return true;
  if (sharedMockMode) return false;
  if (isOnBoardHost()) return false;
  return useMock;
}

function syncBoardTokenFromStorage(): void {
  if (typeof localStorage === "undefined") return;
  const token = localStorage.getItem(BOARD_TOKEN_STORAGE_KEY);
  boardToken = token || null;
}

function persistBoardTokenSession(session: BoardAuthSession): void {
  boardToken = session.token;
  if (typeof localStorage === "undefined") return;
  const expiryMs = Date.now() + Math.min(session.ttlMs, BOARD_SESSION_MS);
  localStorage.setItem(BOARD_TOKEN_STORAGE_KEY, session.token);
  localStorage.setItem(BOARD_TOKEN_EXPIRY_STORAGE_KEY, String(expiryMs));
}

if (typeof window !== "undefined") {
  syncBoardTokenFromStorage();
}

/** ESP32 serves HTTP one request at a time — serialize to avoid draw/timeouts. */
let boardHttpTail: Promise<void> = Promise.resolve();

function withBoardHttp<T>(work: () => Promise<T>): Promise<T> {
  if (!isOnBoardHost() || shouldUseMock()) {
    return work();
  }
  const run = boardHttpTail.then(work, work);
  boardHttpTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Hold/wait-audio must not sit behind draw/SPIFFS work or auto-call stays stuck
 * with remainingMs=0 while audio finishes (especially at short intervals).
 */
async function postFormUrgent(
  path: string,
  body: Record<string, string>,
  includeAuth = true
): Promise<void> {
  syncBoardTokenFromStorage();
  const { signal, cancel } = abortAfterMs(Math.min(fetchTimeoutMs(), 5000));
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (includeAuth && boardToken) headers["X-Board-Token"] = boardToken;
    const form = new URLSearchParams(body).toString();
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers,
      body: form,
      signal,
    });
    cancel();
    if (!res.ok) throw new Error(`${res.status}`);
  } catch (e) {
    cancel();
    throw e;
  }
}

type WsCommandAction =
  | "get_state"
  | "draw"
  | "reset"
  | "undo"
  | "set_calling_style"
  | "call_number"
  | "set_game_type"
  | "declare_winner"
  | "clear_winner"
  | "join_card"
  | "mark_card_cell"
  | "leave_card"
  | "get_card_state";

type WsPending = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
};

let wsCommandSocket: WebSocket | null = null;
let wsCommandOpenPromise: Promise<void> | null = null;
const wsPending = new Map<string, WsPending>();
// Keep websocket as state/event transport only.
// Command transport caused regressions under multi-card load.
let wsCommandsEnabled = false;
let wsCommandFailures = 0;

function backendLabel(): string {
  if (sharedMockMode) return "Shared mock server (127.0.0.1:8787)";
  if (shouldUseMock()) return "In-tab mock backend";
  return "ESP32 via board WiFi";
}

function websocketUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

function rejectAllPending(err: Error) {
  for (const [requestId, pending] of wsPending.entries()) {
    window.clearTimeout(pending.timeoutId);
    pending.reject(err);
    wsPending.delete(requestId);
  }
}

function markWsCommandFailure() {
  wsCommandFailures += 1;
  if (wsCommandFailures >= 2) {
    wsCommandsEnabled = false;
    if (wsCommandSocket && (wsCommandSocket.readyState === WebSocket.OPEN || wsCommandSocket.readyState === WebSocket.CONNECTING)) {
      wsCommandSocket.close();
    }
    wsCommandSocket = null;
    wsCommandOpenPromise = null;
  }
}

function ensureWsCommandSocket(): Promise<void> {
  if (wsCommandSocket && wsCommandSocket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  if (wsCommandOpenPromise) return wsCommandOpenPromise;

  wsCommandOpenPromise = new Promise<void>((resolve, reject) => {
    try {
      const socket = new WebSocket(websocketUrl());
      wsCommandSocket = socket;
      socket.onopen = () => {
        wsCommandOpenPromise = null;
        resolve();
      };
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            requestId?: string;
            ok?: boolean;
            data?: unknown;
            error?: string;
            status?: number;
          };
          if (msg.type !== "command_result" || !msg.requestId) return;
          const pending = wsPending.get(msg.requestId);
          if (!pending) return;
          wsPending.delete(msg.requestId);
          window.clearTimeout(pending.timeoutId);
          if (msg.ok) pending.resolve(msg.data ?? {});
          else pending.reject(new Error(msg.error || String(msg.status || "ws command failed")));
        } catch {
          // Ignore malformed command results.
        }
      };
      socket.onerror = () => {
        // close handler will reject pending work
      };
      socket.onclose = () => {
        wsCommandSocket = null;
        wsCommandOpenPromise = null;
        rejectAllPending(new Error("socket closed"));
      };
    } catch (err) {
      wsCommandSocket = null;
      wsCommandOpenPromise = null;
      reject(err);
    }
  });

  return wsCommandOpenPromise;
}

async function wsCommand<T = unknown>(
  action: WsCommandAction,
  payload?: Record<string, unknown>,
  includeAuth = true
): Promise<T> {
  if (!wsCommandsEnabled) throw new Error("ws commands disabled");
  await ensureWsCommandSocket();
  if (!wsCommandSocket || wsCommandSocket.readyState !== WebSocket.OPEN) {
    markWsCommandFailure();
    throw new Error("socket unavailable");
  }
  const requestId = `req-${Date.now()}-${++wsRequestSeq}`;
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      wsPending.delete(requestId);
      markWsCommandFailure();
      reject(new Error("ws command timeout"));
    }, 450);
    wsPending.set(requestId, {
      resolve: (v) => {
        wsCommandFailures = 0;
        resolve(v as T);
      },
      reject: (reason) => {
        markWsCommandFailure();
        reject(reason);
      },
      timeoutId,
    });
    wsCommandSocket?.send(
      JSON.stringify({
        type: "command",
        requestId,
        action,
        token: includeAuth ? boardToken : undefined,
        payload: payload ?? {},
      })
    );
  });
}

const DEV_FETCH_TIMEOUT_MS = 2000;
/** ESP32 over WiFi: state ~6s, draw ~5s; sequential draw+refresh needs headroom. */
const BOARD_FETCH_TIMEOUT_MS = 20000;
const BOARD_MUTATION_TIMEOUT_MS = 30000;

function fetchTimeoutMs(): number {
  return isOnBoardHost() ? BOARD_FETCH_TIMEOUT_MS : DEV_FETCH_TIMEOUT_MS;
}

function mutationTimeoutMs(): number {
  return isOnBoardHost() ? BOARD_MUTATION_TIMEOUT_MS : DEV_FETCH_TIMEOUT_MS;
}

function isHttp401(error: unknown): boolean {
  return error instanceof Error && error.message === "401";
}

function abortAfterMs(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutId),
  };
}
function buildHeaders(includeAuth = true): HeadersInit {
  syncBoardTokenFromStorage();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (includeAuth && boardToken) headers["X-Board-Token"] = boardToken;
  return headers;
}

async function fetchStateWithRetry(): Promise<GameState> {
  return withBoardHttp(async () => {
    const attempts = isOnBoardHost() ? 3 : 1;
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fetchState();
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
      }
    }
    throw lastError;
  });
}

async function fetchState(): Promise<GameState> {
  const { signal, cancel } = abortAfterMs(fetchTimeoutMs());
  try {
    const res = await fetch(`${BASE}/api/state`, { signal });
    cancel();
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  } catch (err) {
    cancel();
    throw err;
  }
}

async function fetchCardState(cardId: string): Promise<CardStateResponse> {
  const { signal, cancel } = abortAfterMs(fetchTimeoutMs());
  try {
    const res = await fetch(`${BASE}/api/card-state?cardId=${encodeURIComponent(cardId)}`, {
      signal,
    });
    cancel();
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  } catch (err) {
    cancel();
    throw err;
  }
}

async function mutation<T>(wsAction: WsCommandAction, payload: Record<string, unknown> | undefined, http: () => Promise<T>): Promise<T> {
  if (wsCommandsEnabled) {
    try {
      return await wsCommand<T>(wsAction, payload);
    } catch {
      return http();
    }
  }
  return http();
}

async function mutationNoAuth<T>(wsAction: WsCommandAction, payload: Record<string, unknown> | undefined, http: () => Promise<T>): Promise<T> {
  if (wsCommandsEnabled) {
    try {
      return await wsCommand<T>(wsAction, payload, false);
    } catch {
      return http();
    }
  }
  return http();
}
async function postForm(path: string, body: Record<string, string>, includeAuth = true): Promise<void> {
  await postFormRequest(path, body, includeAuth);
}

async function postFormState(path: string, body: Record<string, string>, includeAuth = true): Promise<GameState> {
  const data = await postFormRequest(path, body, includeAuth);
  if (data && typeof data === "object" && "called" in (data as object)) {
    return data as GameState;
  }
  return fetchStateWithRetry();
}

async function postFormRequest(
  path: string,
  body: Record<string, string>,
  includeAuth = true
): Promise<unknown> {
  return withBoardHttp(async () => {
    syncBoardTokenFromStorage();
    const { signal, cancel } = abortAfterMs(fetchTimeoutMs());
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      if (includeAuth && boardToken) headers["X-Board-Token"] = boardToken;
      const form = new URLSearchParams(body).toString();
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers,
        body: form,
        signal,
      });
      cancel();
      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    } catch (e) {
      cancel();
      throw e;
    }
  });
}

async function postJson<T = unknown>(
  path: string,
  body?: unknown,
  includeAuth = true,
  timeoutMs?: number,
): Promise<T> {
  return withBoardHttp(async () => {
    const { signal, cancel } = abortAfterMs(timeoutMs ?? fetchTimeoutMs());
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: buildHeaders(includeAuth),
        body: JSON.stringify(body ?? {}),
        signal,
      });
      cancel();
      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error("invalid json");
      }
    } catch (e) {
      cancel();
      throw e;
    }
  });
}

/** Board mutations require X-Board-Token; retry once after refresh on 401. */
async function postBoardJson<T = unknown>(path: string, body?: unknown): Promise<T> {
  syncBoardTokenFromStorage();
  if (isOnBoardHost() && !boardToken) {
    throw new Error("401");
  }
  try {
    return await postJson<T>(path, body, true, mutationTimeoutMs());
  } catch (error) {
    if (!isHttp401(error)) throw error;
    try {
      syncBoardTokenFromStorage();
      const session = await postJson<BoardAuthSession>(
        "/auth/board/refresh",
        {},
        true,
        mutationTimeoutMs()
      );
      if (session?.token) persistBoardTokenSession(session);
      return await postJson<T>(path, body, true, mutationTimeoutMs());
    } catch {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
      }
      throw error;
    }
  }
}

async function drawGameState(): Promise<GameState> {
  const raw = await postBoardJson<GameState>("/draw");
  if (isValidSnapshot(raw)) return raw;
  return fetchStateWithRetry();
}

/** Real API that talks to the ESP32 over HTTP */
const realApi = {
  getState: () => (wsCommandsEnabled ? mutationNoAuth("get_state", {}, fetchStateWithRetry) : fetchStateWithRetry()),

  draw: () => mutation<GameState>("draw", undefined, () => drawGameState()),
  reset: () => mutation("reset", undefined, () => postBoardJson("/reset")),
  undo: () => mutation<GameState>("undo", undefined, async () => {
    const raw = await postBoardJson<GameState>("/undo");
    return isValidSnapshot(raw) ? raw : fetchStateWithRetry();
  }),

  setCallingStyle: (callingStyle: CallingStyle) =>
    mutation("set_calling_style", { callingStyle }, () => postBoardJson("/calling-style", { callingStyle })),

  callNumber: (number: number) =>
    mutation("call_number", { number }, async () => {
      const raw = await postBoardJson<GameState>("/call", { number });
      return isValidSnapshot(raw) ? raw : fetchStateWithRetry();
    }),

  setGameType: (gameType: GameType) =>
    mutation("set_game_type", { gameType }, () => postBoardJson("/game-type", { gameType })),

  declareWinner: () => mutation("declare_winner", undefined, () => postBoardJson("/declare-winner")),
  clearWinner: () => mutation("clear_winner", undefined, () => postBoardJson("/clear-winner")),
  setLedTestMode: (enabled: boolean) => postBoardJson("/led-test", { enabled }),
  setScreensaverEnabled: (enabled: boolean) =>
    postFormState("/screensaver", { enabled: enabled ? "1" : "0" }),
  setScreensaverText: (text: string) => postForm("/screensaver-text", { text }),
  setScreensaverSpeed: (value: number) =>
    postForm("/screensaver-speed", { value: String(Math.round(value)) }),
  setScreensaverType: (type: ScreensaverType) =>
    postForm("/screensaver-type", { type }),
  setScreensaverColor: (hex: string) =>
    postForm("/screensaver-color", { hex: hex.replace("#", "") }),
  setAutoCallingEnabled: (enabled: boolean) =>
    postFormState("/auto-calling", { enabled: enabled ? "1" : "0" }),
  setAutoCallingSeconds: (value: number) =>
    postForm("/auto-calling-seconds", { value: String(Math.round(value)) }),
  setAutoCallingHold: (hold: boolean) =>
    postFormUrgent("/auto-calling-hold", { hold: hold ? "1" : "0" }),
  setAutoCallingWaitForAudio: (enabled: boolean) =>
    postFormUrgent("/auto-calling-wait-audio", { enabled: enabled ? "1" : "0" }),
  unlockBoard: (pin: string) => postJson<BoardAuthSession>("/auth/board/unlock", { pin }, false),
  lockBoard: () => postBoardJson("/auth/board/lock"),
  refreshBoardAuth: () => postBoardJson<BoardAuthSession>("/auth/board/refresh"),
  changeBoardPin: (currentPin: string, nextPin: string) =>
    postBoardJson("/board/pin", { currentPin, nextPin }),

  setBrightness: (value: number) =>
    postForm("/brightness", { value: String(value) }),

  setLedVibrance: (value: number) =>
    postForm("/vibrance", { value: String(value) }),

  setTheme: (theme: number) =>
    postForm("/theme", { id: String(theme) }),

  setColor: (hex: string) =>
    postForm("/color", { hex: hex.replace("#", "") }),

  setLedHeaderColor: (hex: string) =>
    postForm("/letter-header-color", { hex: hex.replace("#", "") }),

  setLedGameTypeColor: (hex: string) =>
    postForm("/game-type-color", { hex: hex.replace("#", "") }),

  setLedLetterColors: (colors: Record<Letter, string>) =>
    postBoardJson("/letter-colors", {
      B: colors.B.replace("#", ""),
      I: colors.I.replace("#", ""),
      N: colors.N.replace("#", ""),
      G: colors.G.replace("#", ""),
      O: colors.O.replace("#", ""),
    }),

  setLetterFullMode: (mode: LetterFullMode) =>
    postForm("/letter-full-mode", { mode }),

  setCurrentNumberEffect: (effect: CurrentNumberEffect) =>
    postForm("/current-number-effect", { effect }),

  setCurrentNumberColor: (hex: string) =>
    postForm("/current-number-color", { hex: hex.replace("#", "") }),

  setCalledNumberBanner: (enabled: boolean) =>
    postForm("/called-number-banner", { enabled: enabled ? "1" : "0" }),

  setWifiCredentials: (ssid: string, password?: string) =>
    postBoardJson("/wifi", { ssid, password }),

  joinCard: (numbers: Array<number | null>, cardId?: string) =>
    mutationNoAuth("join_card", { numbers, cardId }, () =>
      postJson<CardJoinResponse>("/card/join", { numbers, cardId }, false)
    ),
  /** Verify a printed card from QR-encoded numbers only (no print registry). */
  claimPrintedCard: (numbers: Array<number | null>, sig?: string | null) =>
    postJson<CardClaimResponse>("/card/claim", { numbers, sig: sig || undefined }, false),
  getDeviceId: async (): Promise<{ deviceId: string }> => {
    syncBoardTokenFromStorage();
    const { signal, cancel } = abortAfterMs(fetchTimeoutMs());
    try {
      const headers: Record<string, string> = {};
      if (boardToken) headers["X-Board-Token"] = boardToken;
      const res = await fetch(`${BASE}/api/device-id`, { signal, headers });
      cancel();
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    } catch (err) {
      cancel();
      throw err;
    }
  },
  markCardCell: (cardId: string, cellIndex: number, marked: boolean) =>
    mutationNoAuth("mark_card_cell", { cardId, cellIndex, marked }, () =>
      postJson<CardJoinResponse>("/card/mark", { cardId, cellIndex, marked }, false)
    ),
  syncCardMarks: (cardId: string, marks: boolean[]) =>
    postJson<CardJoinResponse>("/card/sync-marks", { cardId, marks }, false),
  leaveCard: (cardId: string) =>
    mutationNoAuth("leave_card", { cardId }, () => postJson("/card/leave", { cardId }, false)),
  getCardState: (cardId: string) =>
    wsCommandsEnabled
      ? mutationNoAuth("get_card_state", { cardId }, () => fetchCardState(cardId))
      : fetchCardState(cardId),
};

/**
 * Exported API — auto-detects mock mode on first getState failure.
 * Once mock mode is active, all calls go through mockApi.
 */
export const api = {
  isOnBoardHost,
  isUsingMock: () => shouldUseMock(),
  getState: async (): Promise<GameState> => {
    if (sharedMockMode) return realApi.getState();
    if (shouldUseMock()) return mockApi.getState();
    try {
      const state = await realApi.getState();
      // Recovered from a prior mistaken mock lock-in during dev.
      useMock = false;
      mockDetected = false;
      return state;
    } catch {
      if (!mockDetected && !isOnBoardHost()) {
        mockDetected = true;
        useMock = true;
        console.info(
          "%c[mock] No ESP32 detected — using in-memory mock backend",
          "color: #f59e0b; font-weight: bold"
        );
      }
      if (shouldUseMock()) return mockApi.getState();
      throw new Error("board unreachable");
    }
  },

  draw: async (): Promise<GameState> => (shouldUseMock() ? mockApi.draw() : realApi.draw()),
  reset: async () => (shouldUseMock() ? mockApi.reset() : realApi.reset()),
  undo: async () => (shouldUseMock() ? mockApi.undo() : realApi.undo()),

  setCallingStyle: async (cs: CallingStyle) =>
    shouldUseMock() ? mockApi.setCallingStyle(cs) : realApi.setCallingStyle(cs),

  callNumber: async (n: number): Promise<GameState> =>
    shouldUseMock() ? mockApi.callNumber(n) : realApi.callNumber(n),

  setGameType: async (gt: GameType) =>
    shouldUseMock() ? mockApi.setGameType(gt) : realApi.setGameType(gt),

  declareWinner: async () =>
    shouldUseMock() ? mockApi.declareWinner() : realApi.declareWinner(),

  clearWinner: async () =>
    shouldUseMock() ? mockApi.clearWinner() : realApi.clearWinner(),

  setLedTestMode: async (enabled: boolean) =>
    shouldUseMock() ? mockApi.setLedTestMode(enabled) : realApi.setLedTestMode(enabled),

  setScreensaverEnabled: async (enabled: boolean) =>
    shouldUseMock() ? mockApi.setScreensaverEnabled(enabled) : realApi.setScreensaverEnabled(enabled),

  setScreensaverText: async (text: string) =>
    shouldUseMock() ? mockApi.setScreensaverText(text) : realApi.setScreensaverText(text),

  setScreensaverSpeed: async (value: number) =>
    shouldUseMock() ? mockApi.setScreensaverSpeed(value) : realApi.setScreensaverSpeed(value),

  setScreensaverType: async (type: ScreensaverType) =>
    shouldUseMock() ? mockApi.setScreensaverType(type) : realApi.setScreensaverType(type),

  setScreensaverColor: async (hex: string) =>
    shouldUseMock() ? mockApi.setScreensaverColor(hex) : realApi.setScreensaverColor(hex),

  setAutoCallingEnabled: async (enabled: boolean) =>
    shouldUseMock() ? mockApi.setAutoCallingEnabled(enabled) : realApi.setAutoCallingEnabled(enabled),

  setAutoCallingSeconds: async (value: number) =>
    shouldUseMock() ? mockApi.setAutoCallingSeconds(value) : realApi.setAutoCallingSeconds(value),

  setAutoCallingHold: async (hold: boolean) =>
    shouldUseMock() ? mockApi.setAutoCallingHold(hold) : realApi.setAutoCallingHold(hold),

  setAutoCallingWaitForAudio: async (enabled: boolean) =>
    shouldUseMock() ? mockApi.setAutoCallingWaitForAudio(enabled) : realApi.setAutoCallingWaitForAudio(enabled),

  setBrightness: async (v: number) =>
    shouldUseMock() ? mockApi.setBrightness(v) : realApi.setBrightness(v),

  setLedVibrance: async (v: number) =>
    shouldUseMock() ? mockApi.setLedVibrance(v) : realApi.setLedVibrance(v),

  setTheme: async (t: number) =>
    shouldUseMock() ? mockApi.setTheme(t) : realApi.setTheme(t),

  setColor: async (hex: string) =>
    shouldUseMock() ? mockApi.setColor(hex) : realApi.setColor(hex),

  setLedHeaderColor: async (hex: string) =>
    shouldUseMock() ? mockApi.setLedHeaderColor(hex) : realApi.setLedHeaderColor(hex),

  setLedGameTypeColor: async (hex: string) =>
    shouldUseMock() ? mockApi.setLedGameTypeColor(hex) : realApi.setLedGameTypeColor(hex),

  setLedLetterColors: async (colors: Record<Letter, string>) =>
    shouldUseMock() ? mockApi.setLedLetterColors(colors) : realApi.setLedLetterColors(colors),

  setLetterFullMode: async (mode: LetterFullMode) =>
    shouldUseMock() ? mockApi.setLetterFullMode(mode) : realApi.setLetterFullMode(mode),

  setCurrentNumberEffect: async (effect: CurrentNumberEffect) =>
    shouldUseMock() ? mockApi.setCurrentNumberEffect(effect) : realApi.setCurrentNumberEffect(effect),

  setCurrentNumberColor: async (hex: string) =>
    shouldUseMock() ? mockApi.setCurrentNumberColor(hex) : realApi.setCurrentNumberColor(hex),

  setCalledNumberBanner: async (enabled: boolean) =>
    shouldUseMock() ? mockApi.setCalledNumberBanner(enabled) : realApi.setCalledNumberBanner(enabled),

  setWifiCredentials: async (ssid: string, password?: string) =>
    shouldUseMock() ? mockApi.setWifiCredentials(ssid, password) : realApi.setWifiCredentials(ssid, password),

  unlockBoard: async (pin: string) => {
    if (shouldUseMock()) {
      const session = await mockApi.unlockBoard(pin);
      boardToken = session.token;
      return session;
    }
    const session = await realApi.unlockBoard(pin);
    boardToken = session.token;
    return session;
  },
  lockBoard: async () => {
    try {
      if (shouldUseMock()) {
        await mockApi.lockBoard();
      } else {
        await realApi.lockBoard();
      }
    } finally {
      boardToken = null;
    }
  },
  refreshBoardAuth: async () => {
    if (shouldUseMock()) {
      const session = await mockApi.refreshBoardAuth();
      boardToken = session.token;
      return session;
    }
    syncBoardTokenFromStorage();
    const session = await realApi.refreshBoardAuth();
    persistBoardTokenSession(session);
    return session;
  },
  changeBoardPin: async (currentPin: string, nextPin: string) =>
    shouldUseMock() ? mockApi.changeBoardPin(currentPin, nextPin) : realApi.changeBoardPin(currentPin, nextPin),
  setBoardToken: (token: string | null) => {
    boardToken = token;
  },
  getBoardToken: () => boardToken,

  joinCard: async (numbers: Array<number | null>, cardId?: string) =>
    shouldUseMock() ? mockApi.joinCard(numbers, cardId) : realApi.joinCard(numbers, cardId),
  claimPrintedCard: async (numbers: Array<number | null>, sig?: string | null) =>
    shouldUseMock() ? mockApi.claimPrintedCard(numbers, sig) : realApi.claimPrintedCard(numbers, sig),
  getDeviceId: async () => (shouldUseMock() ? mockApi.getDeviceId() : realApi.getDeviceId()),
  markCardCell: async (cardId: string, cellIndex: number, marked: boolean) =>
    shouldUseMock() ? mockApi.markCardCell(cardId, cellIndex, marked) : realApi.markCardCell(cardId, cellIndex, marked),
  syncCardMarks: async (cardId: string, marks: boolean[]) =>
    shouldUseMock() ? mockApi.syncCardMarks(cardId, marks) : realApi.syncCardMarks(cardId, marks),
  leaveCard: async (cardId: string) =>
    shouldUseMock() ? mockApi.leaveCard(cardId) : realApi.leaveCard(cardId),
  getCardState: async (cardId: string) =>
    shouldUseMock() ? mockApi.getCardState(cardId) : realApi.getCardState(cardId),
  getBackendLabel: () => backendLabel(),
  getWebSocketUrl: () => websocketUrl(),
};
