import { api } from "@/api";
import { notifyBoardAuthChanged } from "@/lib/card-session-events";

export const BOARD_TOKEN_STORAGE_KEY = "bingo-board-token";
export const BOARD_TOKEN_EXPIRY_STORAGE_KEY = "bingo-board-token-expiry";

/** Client-side board session length (matches firmware TTL). */
export const BOARD_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredBoardSession = {
  token: string;
  expiryMs: number;
};

export function readStoredBoardSession(): StoredBoardSession | null {
  const token = localStorage.getItem(BOARD_TOKEN_STORAGE_KEY);
  const expiryMs = Number.parseInt(localStorage.getItem(BOARD_TOKEN_EXPIRY_STORAGE_KEY) ?? "0", 10);
  if (!token || Number.isNaN(expiryMs) || expiryMs <= Date.now()) {
    return null;
  }
  return { token, expiryMs };
}

export function writeStoredBoardSession(token: string, ttlMs: number): StoredBoardSession {
  const expiryMs = Date.now() + Math.min(ttlMs, BOARD_SESSION_MS);
  localStorage.setItem(BOARD_TOKEN_STORAGE_KEY, token);
  localStorage.setItem(BOARD_TOKEN_EXPIRY_STORAGE_KEY, String(expiryMs));
  api.setBoardToken(token);
  notifyBoardAuthChanged();
  return { token, expiryMs };
}

export function clearStoredBoardSession(): void {
  localStorage.removeItem(BOARD_TOKEN_STORAGE_KEY);
  localStorage.removeItem(BOARD_TOKEN_EXPIRY_STORAGE_KEY);
  api.setBoardToken(null);
  notifyBoardAuthChanged();
}

export function isStoredBoardSessionActive(): boolean {
  return readStoredBoardSession() !== null;
}

/** True only for an explicit HTTP 401 from the board API — not timeouts or offline blips. */
export function isBoardAuthHttpError(error: unknown): boolean {
  return error instanceof Error && error.message === "401";
}
