import { useCallback, useEffect, useState } from "react";
import { api } from "@/api";
import type { AppMode } from "@/types";
import {
  clearStoredBoardSession,
  isBoardAuthHttpError,
  readStoredBoardSession,
  writeStoredBoardSession,
  type StoredBoardSession,
} from "@/lib/board-auth";

const RESUME_REFRESH_DELAY_MS = 2000;

export function useBoardAuth() {
  const [session, setSession] = useState<StoredBoardSession | null>(() => {
    const stored = readStoredBoardSession();
    if (stored) api.setBoardToken(stored.token);
    return stored;
  });
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<AppMode | null>(null);

  const boardAuthActive = session !== null && session.expiryMs > Date.now();

  const applySession = useCallback((next: StoredBoardSession | null) => {
    setSession(next);
    api.setBoardToken(next?.token ?? null);
  }, []);

  const persistSession = useCallback((token: string, ttlMs: number) => {
    const stored = writeStoredBoardSession(token, ttlMs);
    applySession(stored);
    return stored;
  }, [applySession]);

  const clearSession = useCallback(
    (opts?: { promptUnlock?: boolean }) => {
      clearStoredBoardSession();
      applySession(null);
      setUnlockOpen(false);
      if (opts?.promptUnlock) {
        // Never PIN-prompt players in card/HUD mode (e.g. QR claim without board auth).
        const mode = sessionStorage.getItem("bingo-app-mode");
        if (mode === "card" || mode === "hud") {
          setPendingMode(null);
          return;
        }
        setPendingMode(mode === "scan" ? "scan" : "board");
        setUnlockError(null);
        setUnlockPin("");
        setUnlockOpen(true);
      }
    },
    [applySession]
  );

  const requestUnlock = useCallback((mode: AppMode = "board") => {
    // Card / HUD / player flows must never open the board PIN dialog.
    const stored = sessionStorage.getItem("bingo-app-mode");
    if (mode === "card" || mode === "hud" || stored === "card" || stored === "hud") {
      setUnlockOpen(false);
      setPendingMode(null);
      return;
    }
    setPendingMode(mode === "scan" ? "scan" : "board");
    setUnlockError(null);
    setUnlockPin("");
    setUnlockOpen(true);
  }, []);

  const unlockWithPin = useCallback(
    async (pin: string) => {
      const trimmed = pin.trim();
      if (!trimmed) return false;
      try {
        const result = await api.unlockBoard(trimmed);
        persistSession(result.token, result.ttlMs);
        setUnlockOpen(false);
        setUnlockError(null);
        setPendingMode(null);
        return true;
      } catch {
        setUnlockError("Invalid board PIN.");
        return false;
      }
    },
    [persistSession]
  );

  /** Exit to mode chooser — clear auth on this device only (other devices keep the shared board token). */
  const clearSessionForModeExit = useCallback(() => {
    clearSession({ promptUnlock: false });
    setPendingMode(null);
  }, [clearSession]);

  /** Best-effort server refresh; never clears session on network failure. */
  const tryRefreshSession = useCallback(async (): Promise<boolean> => {
    const local = readStoredBoardSession();
    if (!local) return false;
    api.setBoardToken(local.token);
    try {
      const refreshed = await api.refreshBoardAuth();
      persistSession(refreshed.token, refreshed.ttlMs);
      return true;
    } catch (error) {
      if (isBoardAuthHttpError(error)) {
        clearSession({ promptUnlock: true });
        return false;
      }
      // Offline / timeout — keep using local session until client expiry.
      applySession(local);
      return false;
    }
  }, [applySession, clearSession, persistSession]);

  // Verify stored token against firmware on load (before mutations silently 401).
  useEffect(() => {
    if (!session) return;
    void tryRefreshSession();
  }, [session?.token, tryRefreshSession]);

  // After phone unlock, refresh in the background once WiFi is likely back.
  useEffect(() => {
    if (!session) return;

    let resumeTimer: number | null = null;

    const scheduleRefresh = () => {
      if (resumeTimer !== null) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        void tryRefreshSession();
      }, RESUME_REFRESH_DELAY_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      if (resumeTimer !== null) window.clearTimeout(resumeTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [session?.token, tryRefreshSession]);

  // Mutation 401: try one refresh before forcing re-PIN.
  useEffect(() => {
    const onAuthInvalid = () => {
      void tryRefreshSession();
    };
    window.addEventListener("bingo:board-auth-invalid", onAuthInvalid);
    return () => window.removeEventListener("bingo:board-auth-invalid", onAuthInvalid);
  }, [tryRefreshSession]);

  return {
    session,
    boardAuthActive,
    unlockOpen,
    setUnlockOpen,
    unlockPin,
    setUnlockPin,
    unlockError,
    setUnlockError,
    pendingMode,
    setPendingMode,
    requestUnlock,
    unlockWithPin,
    clearSession,
    clearSessionForModeExit,
    persistSession,
    tryRefreshSession,
  };
}
