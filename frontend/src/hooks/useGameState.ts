import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/api";
import { DEFAULT_STATE, type GameState } from "@/types";

const WS_FRESH_MS = 900;

function isValidSnapshot(state: GameState): boolean {
  if (!Array.isArray(state.called)) return false;
  if (typeof state.remaining !== "number") return false;
  const expectedCalledCount = 75 - state.remaining;
  if (expectedCalledCount < 0 || expectedCalledCount > 75) return false;
  return state.called.length === expectedCalledCount;
}

export type RefreshOptions = { force?: boolean };

export function useGameState(pollMs = 1500) {
  const [state, setState] = useState<GameState>(DEFAULT_STATE);
  const [connected, setConnected] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const refreshSoonTimeoutRef = useRef<number | null>(null);
  const lastWsSnapshotAtRef = useRef(0);
  const wsLiveRef = useRef(false);

  const applyOptimistic = useCallback((updater: (prev: GameState) => GameState) => {
    setState((prev) => {
      const next = updater(prev);
      return isValidSnapshot(next) ? next : prev;
    });
  }, []);

  const refresh = useCallback(async (options?: RefreshOptions) => {
    const force = options?.force ?? false;
    if (!force && Date.now() - lastWsSnapshotAtRef.current < WS_FRESH_MS) {
      return;
    }
    if (inFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    inFlightRef.current = true;
    try {
      const s = await api.getState();
      if (mountedRef.current) {
        if (!isValidSnapshot(s)) return;
        setHydrated(true);
        const wsRecentlyUpdated = Date.now() - lastWsSnapshotAtRef.current < WS_FRESH_MS;
        if (!wsRecentlyUpdated || force) {
          setState(s);
        }
        setConnected(true);
      }
    } catch {
      if (mountedRef.current) setConnected(false);
    } finally {
      inFlightRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void refresh({ force });
      }
    }
  }, []);

  const refreshSoon = useCallback(
    (delayMs = 1200) => {
      if (refreshSoonTimeoutRef.current !== null) {
        window.clearTimeout(refreshSoonTimeoutRef.current);
      }
      refreshSoonTimeoutRef.current = window.setTimeout(() => {
        refreshSoonTimeoutRef.current = null;
        void refresh({ force: true });
      }, delayMs);
    },
    [refresh]
  );

  useEffect(() => {
    mountedRef.current = true;
    void refresh({ force: true });
    const id = window.setInterval(() => {
      if (wsLiveRef.current && Date.now() - lastWsSnapshotAtRef.current < 5000) {
        return;
      }
      void refresh();
    }, pollMs);
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
      if (refreshSoonTimeoutRef.current !== null) {
        window.clearTimeout(refreshSoonTimeoutRef.current);
      }
    };
  }, [refresh, pollMs]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectDelayMs = 1000;
    let stopping = false;
    let resubscribeId: number | null = null;

    const sendSubscription = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const mode = sessionStorage.getItem("bingo-app-mode");
      const cardId = localStorage.getItem("bingo-card-id");
      const isBoard = mode === "board";
      const isJoinedCard = mode === "card" && Boolean(cardId);
      ws.send(
        JSON.stringify({
          type: "subscribe",
          mode: isBoard ? "board" : isJoinedCard ? "card" : "none",
          cardId: isJoinedCard ? cardId : undefined,
        })
      );
    };

    const clearReconnect = () => {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopping || !mountedRef.current) return;
      clearReconnect();
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10000);
    };

    const connect = () => {
      if (stopping || !mountedRef.current) return;
      try {
        ws = new WebSocket(api.getWebSocketUrl());
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        wsLiveRef.current = true;
        reconnectDelayMs = 1000;
        sendSubscription();
        if (resubscribeId !== null) window.clearInterval(resubscribeId);
        resubscribeId = window.setInterval(sendSubscription, 1000);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as
            | {
                type?: string;
                data?: GameState | {
                  winner?: boolean;
                  winnerCount?: number;
                  winnerEventId?: number;
                };
              }
            | GameState;
          window.dispatchEvent(
            new CustomEvent("bingo:ws-message", {
              detail: parsed,
            })
          );
          if ("type" in parsed && parsed.type === "card_state" && parsed.data && typeof parsed.data === "object") {
            const cardData = parsed.data as {
              winner?: boolean;
              winnerCount?: number;
              winnerEventId?: number;
            };
            if (typeof cardData.winnerCount === "number" || typeof cardData.winnerEventId === "number") {
              if (mountedRef.current) {
                setState((prev) => {
                  const nextWinnerCount =
                    typeof cardData.winnerCount === "number" ? cardData.winnerCount : (prev.winnerCount ?? 0);
                  const nextWinnerEventId =
                    typeof cardData.winnerEventId === "number" ? cardData.winnerEventId : (prev.winnerEventId ?? 0);
                  const nextWinnerDeclared =
                    typeof cardData.winnerCount === "number"
                      ? cardData.winnerCount > 0 || Boolean(prev.manualWinnerDeclared)
                      : (cardData.winner === true || Boolean(prev.winnerDeclared));

                  if (
                    nextWinnerCount === (prev.winnerCount ?? 0) &&
                    nextWinnerEventId === (prev.winnerEventId ?? 0) &&
                    nextWinnerDeclared === Boolean(prev.winnerDeclared)
                  ) {
                    return prev;
                  }

                  return {
                    ...prev,
                    winnerCount: nextWinnerCount,
                    winnerEventId: nextWinnerEventId,
                    winnerDeclared: nextWinnerDeclared,
                  };
                });
              }
            }
          }
          const snapshot = "type" in parsed ? parsed.data : parsed;
          if (!snapshot || typeof snapshot !== "object" || !("called" in snapshot)) return;
          const nextState = snapshot as GameState;
          if (!isValidSnapshot(nextState)) return;
          if (mountedRef.current) {
            setState(nextState);
            lastWsSnapshotAtRef.current = Date.now();
            setHydrated(true);
            setConnected(true);
          }
        } catch {
          // Ignore malformed websocket payloads.
        }
      };

      ws.onerror = () => {
        // Polling remains the fallback source of truth.
      };

      ws.onclose = () => {
        wsLiveRef.current = false;
        if (resubscribeId !== null) {
          window.clearInterval(resubscribeId);
          resubscribeId = null;
        }
        if (stopping) return;
        scheduleReconnect();
      };
    };

    connect();
    return () => {
      stopping = true;
      wsLiveRef.current = false;
      clearReconnect();
      if (resubscribeId !== null) window.clearInterval(resubscribeId);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, []);

  return { state, connected, refresh, refreshSoon, applyOptimistic, hydrated };
}
