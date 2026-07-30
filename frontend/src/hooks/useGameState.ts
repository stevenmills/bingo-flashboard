import { useState, useEffect, useCallback, useRef } from "react";
import { api, isOnBoardHost } from "@/api";
import {
  APP_MODE_CHANGED_EVENT,
  BOARD_AUTH_CHANGED_EVENT,
  CARD_SESSION_CHANGED_EVENT,
} from "@/lib/card-session-events";
import {
  initialGameState,
  isValidSnapshot,
  mergePartialState,
  mergeServerSnapshot,
} from "@/lib/game-state-merge";
import type { GameState } from "@/types";

const WS_FRESH_MS = 2000;

export type RefreshOptions = { force?: boolean };

export function useGameState(pollMs = isOnBoardHost() ? 4000 : 1500) {
  const [state, setState] = useState<GameState>(initialGameState);
  const [connected, setConnected] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const pendingForceRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const lastWsSnapshotAtRef = useRef(0);
  const lastLocalMutationAtRef = useRef(0);
  const lastWsSeqRef = useRef(0);
  const wsLiveRef = useRef(false);
  const sendSubscriptionRef = useRef<() => void>(() => {});

  const applyOptimistic = useCallback((updater: (prev: GameState) => GameState) => {
    lastLocalMutationAtRef.current = Date.now();
    setState((prev) => {
      const next = updater(prev);
      return isValidSnapshot(next) ? mergeServerSnapshot(prev, next) : prev;
    });
  }, []);

  /** Replace state from a server draw/call/undo response — bypasses WS seq merge guards. */
  const applyServerState = useCallback((incoming: GameState) => {
    if (!isValidSnapshot(incoming)) return;
    lastLocalMutationAtRef.current = Date.now();
    // Do not reset lastWsSeq — resetting to 0 lets older WS envelopes replay and flicker UI.
    setState((prev) => mergeServerSnapshot(prev, incoming, { allowCallRegression: true }));
    setHydrated(true);
    setConnected(true);
  }, []);

  const commitSnapshot = useCallback((prev: GameState, incoming: GameState, wsSeq?: number): GameState => {
    if (typeof wsSeq === "number" && wsSeq > 0 && wsSeq < lastWsSeqRef.current) {
      return prev;
    }
    if (typeof wsSeq === "number" && wsSeq > lastWsSeqRef.current) {
      lastWsSeqRef.current = wsSeq;
    }
    return mergeServerSnapshot(prev, incoming);
  }, []);

  const refresh = useCallback(async (options?: RefreshOptions) => {
    const force = options?.force ?? false;
    const recentlyLive =
      Date.now() - lastWsSnapshotAtRef.current < WS_FRESH_MS ||
      Date.now() - lastLocalMutationAtRef.current < WS_FRESH_MS;
    if (!force && recentlyLive) {
      return;
    }
    if (inFlightRef.current) {
      pendingRefreshRef.current = true;
      pendingForceRef.current = pendingForceRef.current || force;
      return;
    }
    inFlightRef.current = true;
    try {
      const s = await api.getState();
      if (mountedRef.current) {
        if (!isValidSnapshot(s)) return;
        setHydrated(true);
        const recentlyLiveAfterFetch =
          Date.now() - lastWsSnapshotAtRef.current < WS_FRESH_MS ||
          Date.now() - lastLocalMutationAtRef.current < WS_FRESH_MS;
        if (!recentlyLiveAfterFetch || force) {
          setState((prev) =>
            force
              ? mergeServerSnapshot(prev, s, { allowCallRegression: true })
              : commitSnapshot(prev, s)
          );
        }
        setConnected(true);
      }
    } catch {
      if (mountedRef.current) setConnected(false);
    } finally {
      inFlightRef.current = false;
      if (pendingRefreshRef.current) {
        const pendingForce = pendingForceRef.current;
        pendingRefreshRef.current = false;
        pendingForceRef.current = false;
        void refresh({ force: pendingForce });
      }
    }
  }, [commitSnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    // Drop legacy cached UI state that could desync from firmware LEDs.
    try {
      sessionStorage.removeItem("bingo-last-state");
    } catch {
      // ignore
    }
    void refresh({ force: true });
    const id = window.setInterval(() => {
      if (isOnBoardHost() && wsLiveRef.current) {
        return;
      }
      if (wsLiveRef.current && Date.now() - lastWsSnapshotAtRef.current < 5000) {
        return;
      }
      void refresh();
    }, pollMs);
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
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
      const boardToken = localStorage.getItem("bingo-board-token");
      // Scan shares board subscription so verify stays live against game state.
      const isBoard = mode === "board" || mode === "scan";
      const isJoinedCard = mode === "card" && Boolean(cardId);
      ws.send(
        JSON.stringify({
          type: "subscribe",
          mode: isBoard ? "board" : isJoinedCard ? "card" : "none",
          cardId: isJoinedCard ? cardId : undefined,
          boardToken: isBoard && boardToken ? boardToken : undefined,
        })
      );
    };
    sendSubscriptionRef.current = sendSubscription;

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
        resubscribeId = window.setInterval(sendSubscription, 5000);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as
            | {
                type?: string;
                seq?: number;
                data?: GameState | Record<string, unknown>;
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
                      : cardData.winner === true || Boolean(prev.winnerDeclared);

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

          if ("type" in parsed && parsed.data && typeof parsed.data === "object") {
            const msgType = parsed.type;
            const data = parsed.data as Record<string, unknown>;
            if (msgType === "auto_calling_tick" || msgType === "pattern_index_changed") {
              if (mountedRef.current) {
                setState((prev) => mergePartialState(prev, data));
                lastWsSnapshotAtRef.current = Date.now();
                setConnected(true);
              }
              return;
            }
          }

          const msgType = "type" in parsed ? parsed.type : undefined;
          const snapshot = "type" in parsed ? parsed.data : parsed;
          if (!snapshot || typeof snapshot !== "object" || !("called" in snapshot)) return;
          const nextState = snapshot as GameState;
          if (!isValidSnapshot(nextState)) return;
          const wsSeq = "type" in parsed && typeof parsed.seq === "number" ? parsed.seq : undefined;
          const forceApply =
            msgType === "game_reset" ||
            msgType === "number_called" ||
            msgType === "number_undone" ||
            msgType === "screensaver_changed" ||
            msgType === "auto_calling_changed";
          const allowCallRegression =
            msgType === "game_reset" || msgType === "number_undone";
          if (mountedRef.current) {
            setState((prev) =>
              forceApply
                ? mergeServerSnapshot(prev, nextState, { allowCallRegression })
                : commitSnapshot(prev, nextState, wsSeq)
            );
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
  }, [commitSnapshot]);

  useEffect(() => {
    const resubscribe = () => sendSubscriptionRef.current();
    window.addEventListener(CARD_SESSION_CHANGED_EVENT, resubscribe);
    window.addEventListener(APP_MODE_CHANGED_EVENT, resubscribe);
    window.addEventListener(BOARD_AUTH_CHANGED_EVENT, resubscribe);
    return () => {
      window.removeEventListener(CARD_SESSION_CHANGED_EVENT, resubscribe);
      window.removeEventListener(APP_MODE_CHANGED_EVENT, resubscribe);
      window.removeEventListener(BOARD_AUTH_CHANGED_EVENT, resubscribe);
    };
  }, []);

  return { state, connected, refresh, applyOptimistic, applyServerState, hydrated };
}
