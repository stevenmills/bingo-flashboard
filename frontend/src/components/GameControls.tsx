import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResetDialog } from "@/components/ResetDialog";
import { WinnerDialog } from "@/components/WinnerDialog";
import { GameOverDialog } from "@/components/GameOverDialog";
import { api } from "@/api";
import type { CallingStyle, GameType } from "@/types";
import { GAME_TYPE_MIN_CALLS } from "@/types";
import { Dices, Trophy, RotateCcw } from "lucide-react";
import type { LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  callingStyle: CallingStyle;
  gameType: GameType;
  called: number[];
  remaining: number;
  winnerDeclared: boolean;
  winnerEventId?: number;
  winnerCount?: number;
  onRefresh: () => void;
  onResetComplete?: () => void;
  letterColors: LetterColors;
}

export function GameControls({
  callingStyle,
  gameType,
  called,
  remaining,
  winnerDeclared,
  winnerEventId,
  winnerCount,
  onRefresh,
  onResetComplete,
  letterColors,
}: Props) {
  const [resetOpen, setResetOpen] = useState(false);
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [gameOverOpen, setGameOverOpen] = useState(false);
  const lastWinnerEventIdRef = useRef(0);
  const lastWinnerFallbackKeyRef = useRef("");

  useEffect(() => {
    const onWsMessage = (event: Event) => {
      const customEvent = event as CustomEvent<{
        type?: string;
        data?: {
          winnerCount?: number;
          winnerEventId?: number;
        };
      }>;
      const detail = customEvent.detail;
      if (!detail || !detail.type || !detail.data) return;
      if (
        detail.type !== "card_state" &&
        detail.type !== "snapshot" &&
        detail.type !== "winner_changed" &&
        detail.type !== "card_mark_changed"
      ) {
        return;
      }
      const wsWinnerCount = detail.data.winnerCount;
      const wsWinnerEventId = detail.data.winnerEventId ?? 0;

      if (typeof wsWinnerEventId === "number" && wsWinnerEventId > 0) {
        if (wsWinnerEventId > lastWinnerEventIdRef.current) {
          lastWinnerEventIdRef.current = wsWinnerEventId;
          setWinnerOpen(true);
        }
        return;
      }

      if (typeof wsWinnerCount === "number" && wsWinnerCount > 0) {
        setWinnerOpen(true);
      }
    };
    window.addEventListener("bingo:ws-message", onWsMessage as EventListener);
    return () => window.removeEventListener("bingo:ws-message", onWsMessage as EventListener);
  }, []);

  useEffect(() => {
    if (remaining === 0 && called.length > 0) {
      setGameOverOpen(true);
    }
  }, [remaining, called.length]);

  useEffect(() => {
    const eventId = winnerEventId ?? 0;
    if (eventId <= 0) return;
    if (eventId <= lastWinnerEventIdRef.current) return;
    lastWinnerEventIdRef.current = eventId;
    setWinnerOpen(true);
  }, [winnerEventId]);

  useEffect(() => {
    const activeWinner = (winnerCount ?? 0) > 0;
    if (!activeWinner) return;
    const fallbackKey = `${winnerCount ?? 0}:${called.length}`;
    if (lastWinnerFallbackKeyRef.current === fallbackKey) return;
    lastWinnerFallbackKeyRef.current = fallbackKey;
    setWinnerOpen(true);
  }, [winnerDeclared, winnerCount, called.length]);

  useEffect(() => {
    // Clear dedupe keys when winner state is inactive so next winner always re-opens modal.
    if ((winnerCount ?? 0) > 0 || winnerDeclared) return;
    lastWinnerFallbackKeyRef.current = "";
    if (called.length === 0) {
      // New round after reset uses event IDs from 0 again.
      lastWinnerEventIdRef.current = 0;
    }
  }, [winnerCount, winnerDeclared, called.length]);

  const handleDraw = async () => {
    try {
      await api.draw();
      onRefresh();
      const freshState = await api.getState();
      if (freshState.remaining === 0) {
        setGameOverOpen(true);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("pool empty")) {
        setGameOverOpen(true);
      } else if (e instanceof Error && e.message.includes("409")) {
        setGameOverOpen(true);
      }
      onRefresh();
    }
  };

  const handleReset = async () => {
    try {
      await api.reset();
      setResetOpen(false);
      setGameOverOpen(false);
      onResetComplete?.();
    } finally {
      onRefresh();
    }
  };

  const handleDeclareWinner = async () => {
    try {
      await api.declareWinner();
      setWinnerOpen(true);
    } finally {
      onRefresh();
    }
  };

  const poolEmpty = remaining === 0 && called.length > 0;
  const minCalls = GAME_TYPE_MIN_CALLS[gameType];
  const winnerDisabled = called.length < minCalls;
  const gridClassName =
    callingStyle === "manual"
      ? "grid grid-cols-2 gap-3"
      : "grid grid-cols-2 md:grid-cols-3 gap-3";

  return (
    <>
      <div className={gridClassName}>
        {callingStyle === "automatic" && (
          <Button
            size="lg"
            onClick={handleDraw}
            disabled={poolEmpty}
            className="text-white"
            style={{ backgroundColor: letterColors.N }}
          >
            <Dices className="mr-2 h-5 w-5" />
            Draw next
          </Button>
        )}
        <Button
          size="lg"
          onClick={handleDeclareWinner}
          disabled={winnerDisabled}
          className="text-white"
          style={{ backgroundColor: letterColors.G }}
        >
          <Trophy className="mr-2 h-5 w-5" />
          Winner
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={() => {
            if (poolEmpty || called.length === 0) {
              void handleReset();
              return;
            }
            setResetOpen(true);
          }}
        >
          <RotateCcw className="mr-2 h-5 w-5" />
          Reset
        </Button>
      </div>

      <ResetDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        onConfirm={handleReset}
        letterColors={letterColors}
      />
      <WinnerDialog
        open={winnerOpen}
        onOpenChange={setWinnerOpen}
        onRefresh={onRefresh}
        winnerCount={winnerCount}
        letterColors={letterColors}
      />
      <GameOverDialog open={gameOverOpen} onOpenChange={setGameOverOpen} onReset={handleReset} />
    </>
  );
}
