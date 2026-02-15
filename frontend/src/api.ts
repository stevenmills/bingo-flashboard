import type {
  BoardAuthSession,
  CardJoinResponse,
  CardStateResponse,
  GameState,
  GameType,
  CallingStyle,
} from "./types";
import { mockApi } from "./mock-api";

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
  if (useMock) return "In-tab mock backend";
  return "ESP32 via Vite proxy (192.168.4.1)";
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

function buildHeaders(includeAuth = true): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (includeAuth && boardToken) headers["X-Board-Token"] = boardToken;
  return headers;
}

async function postJson<T = unknown>(path: string, body?: unknown, includeAuth = true): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: buildHeaders(includeAuth),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json().catch(() => ({}) as T);
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/** Real API that talks to the ESP32 over HTTP */
const realApi = {
  getState: async (): Promise<GameState> => {
    try {
      return await wsCommand<GameState>("get_state", {}, false);
    } catch (e) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const res = await fetch(`${BASE}/api/state`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    }
  },

  draw: async () => {
    try {
      return await wsCommand("draw");
    } catch {
      return postJson("/draw");
    }
  },
  reset: async () => {
    try {
      return await wsCommand("reset");
    } catch {
      return postJson("/reset");
    }
  },
  undo: async () => {
    try {
      return await wsCommand("undo");
    } catch {
      return postJson("/undo");
    }
  },

  setCallingStyle: (callingStyle: CallingStyle) =>
    wsCommand("set_calling_style", { callingStyle }).catch(() => postJson("/calling-style", { callingStyle })),

  callNumber: (number: number) =>
    wsCommand("call_number", { number }).catch(() => postJson("/call", { number })),

  setGameType: (gameType: GameType) =>
    wsCommand("set_game_type", { gameType }).catch(() => postJson("/game-type", { gameType })),

  declareWinner: () => wsCommand("declare_winner").catch(() => postJson("/declare-winner")),
  clearWinner: () => wsCommand("clear_winner").catch(() => postJson("/clear-winner")),
  setLedTestMode: (enabled: boolean) => postJson("/led-test", { enabled }),
  unlockBoard: (pin: string) => postJson<BoardAuthSession>("/auth/board/unlock", { pin }, false),
  lockBoard: () => postJson("/auth/board/lock", undefined, false),
  refreshBoardAuth: () => postJson<BoardAuthSession>("/auth/board/refresh"),
  changeBoardPin: (currentPin: string, nextPin: string) =>
    postJson("/board/pin", { currentPin, nextPin }),

  setBrightness: (value: number) =>
    fetch(`${BASE}/brightness?value=${value}`, { method: "POST", headers: buildHeaders(true) }),

  setTheme: (theme: number) =>
    postJson("/theme", { theme }),

  setColor: (hex: string) =>
    postJson("/color", { hex: hex.replace("#", "") }),

  joinCard: (pin: string, numbers: Array<number | null>, cardId?: string) =>
    wsCommand<CardJoinResponse>("join_card", { pin, numbers, cardId }, false)
      .catch(() => postJson<CardJoinResponse>("/card/join", { pin, numbers, cardId }, false)),
  markCardCell: (cardId: string, cellIndex: number, marked: boolean) =>
    wsCommand<CardJoinResponse>("mark_card_cell", { cardId, cellIndex, marked }, false)
      .catch(() => postJson<CardJoinResponse>("/card/mark", { cardId, cellIndex, marked }, false)),
  leaveCard: (cardId: string) =>
    wsCommand("leave_card", { cardId }, false).catch(() => postJson("/card/leave", { cardId }, false)),
  getCardState: async (cardId: string): Promise<CardStateResponse> => {
    try {
      return await wsCommand<CardStateResponse>("get_card_state", { cardId }, false);
    } catch (e) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const res = await fetch(`${BASE}/api/card-state?cardId=${encodeURIComponent(cardId)}`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    }
  },
};

/**
 * Exported API — auto-detects mock mode on first getState failure.
 * Once mock mode is active, all calls go through mockApi.
 */
export const api = {
  getState: async (): Promise<GameState> => {
    if (sharedMockMode) return realApi.getState();
    if (useMock) return mockApi.getState();
    try {
      return await realApi.getState();
    } catch {
      if (!mockDetected) {
        mockDetected = true;
        useMock = true;
        console.info(
          "%c[mock] No ESP32 detected — using in-memory mock backend",
          "color: #f59e0b; font-weight: bold"
        );
      }
      return mockApi.getState();
    }
  },

  draw: async () => (useMock ? mockApi.draw() : realApi.draw()),
  reset: async () => (useMock ? mockApi.reset() : realApi.reset()),
  undo: async () => (useMock ? mockApi.undo() : realApi.undo()),

  setCallingStyle: async (cs: CallingStyle) =>
    useMock ? mockApi.setCallingStyle(cs) : realApi.setCallingStyle(cs),

  callNumber: async (n: number) =>
    useMock ? mockApi.callNumber(n) : realApi.callNumber(n),

  setGameType: async (gt: GameType) =>
    useMock ? mockApi.setGameType(gt) : realApi.setGameType(gt),

  declareWinner: async () =>
    useMock ? mockApi.declareWinner() : realApi.declareWinner(),

  clearWinner: async () =>
    useMock ? mockApi.clearWinner() : realApi.clearWinner(),

  setLedTestMode: async (enabled: boolean) =>
    useMock ? mockApi.setLedTestMode(enabled) : realApi.setLedTestMode(enabled),

  setBrightness: async (v: number) =>
    useMock ? mockApi.setBrightness(v) : realApi.setBrightness(v),

  setTheme: async (t: number) =>
    useMock ? mockApi.setTheme(t) : realApi.setTheme(t),

  setColor: async (hex: string) =>
    useMock ? mockApi.setColor(hex) : realApi.setColor(hex),

  unlockBoard: async (pin: string) => {
    const session = useMock ? await mockApi.unlockBoard(pin) : await realApi.unlockBoard(pin);
    boardToken = session.token;
    return session;
  },
  lockBoard: async () => {
    boardToken = null;
    return useMock ? mockApi.lockBoard() : realApi.lockBoard();
  },
  refreshBoardAuth: async () => {
    const session = useMock ? await mockApi.refreshBoardAuth() : await realApi.refreshBoardAuth();
    boardToken = session.token;
    return session;
  },
  changeBoardPin: async (currentPin: string, nextPin: string) =>
    useMock ? mockApi.changeBoardPin(currentPin, nextPin) : realApi.changeBoardPin(currentPin, nextPin),
  setBoardToken: (token: string | null) => {
    boardToken = token;
  },
  getBoardToken: () => boardToken,

  joinCard: async (pin: string, numbers: Array<number | null>, cardId?: string) =>
    useMock ? mockApi.joinCard(pin, numbers, cardId) : realApi.joinCard(pin, numbers, cardId),
  markCardCell: async (cardId: string, cellIndex: number, marked: boolean) =>
    useMock ? mockApi.markCardCell(cardId, cellIndex, marked) : realApi.markCardCell(cardId, cellIndex, marked),
  leaveCard: async (cardId: string) =>
    useMock ? mockApi.leaveCard(cardId) : realApi.leaveCard(cardId),
  getCardState: async (cardId: string) =>
    useMock ? mockApi.getCardState(cardId) : realApi.getCardState(cardId),
  getBackendLabel: () => backendLabel(),
  getWebSocketUrl: () => websocketUrl(),
};
