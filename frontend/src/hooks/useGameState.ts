import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/api";
import { DEFAULT_STATE, type GameState } from "@/types";

export function useGameState(pollMs = 1500) {
  const [state, setState] = useState<GameState>(DEFAULT_STATE);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const s = await api.getState();
      if (mountedRef.current) {
        setState(s);
        setConnected(true);
      }
    } catch {
      if (mountedRef.current) setConnected(false);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
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
        reconnectDelayMs = 1000;
        sendSubscription();
        if (resubscribeId !== null) window.clearInterval(resubscribeId);
        // Keep subscription aligned when app mode/card join changes.
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

                  // Avoid re-render storms: board can receive one card_state per joined card.
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
          if (mountedRef.current) {
            setState(snapshot as GameState);
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
      clearReconnect();
      if (resubscribeId !== null) window.clearInterval(resubscribeId);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, []);

  return { state, connected, refresh };
}
