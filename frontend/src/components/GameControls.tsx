import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResetDialog } from "@/components/ResetDialog";
import { WinnerDialog } from "@/components/WinnerDialog";
import { GameOverDialog } from "@/components/GameOverDialog";
import { api } from "@/api";
import { isBoardAuthHttpError } from "@/lib/board-auth";
import type { RefreshOptions } from "@/hooks/useGameState";
import type { CallingStyle, GameState, AnyGameType, GameStyle } from "@/types";
import { minCallsForSelection } from "@/types";
import { Dices, Trophy, RotateCcw } from "lucide-react";
import type { LetterColors } from "@/lib/bingo-ui-colors";
import { cn } from "@/lib/utils";

interface Props {
  callingStyle: CallingStyle;
  gameStyle?: GameStyle;
  gameType: AnyGameType;
  called: number[];
  remaining: number;
  winnerDeclared: boolean;
  winnerEventId?: number;
  winnerCount?: number;
  survivorCount?: number;
  eliminatedCount?: number;
  onRefresh: (options?: RefreshOptions) => void;
  onApplyOptimistic?: (updater: (prev: GameState) => GameState) => void;
  onApplyServerState?: (state: GameState) => void;
  onResetComplete?: () => void;
  onWinnerDialogActiveChange?: (active: boolean) => void;
  onSuppressAutoRestore?: () => void;
  onAnnounceCallNumber?: (n: number) => void;
  letterColors: LetterColors;
}

export function GameControls({
  callingStyle,
  gameStyle = "bingo",
  gameType,
  called,
  remaining,
  winnerDeclared,
  winnerEventId,
  winnerCount,
  survivorCount,
  eliminatedCount,
  onRefresh,
  onApplyOptimistic,
  onApplyServerState,
  onResetComplete,
  onWinnerDialogActiveChange,
  onSuppressAutoRestore,
  onAnnounceCallNumber,
  letterColors,
}: Props) {
  const [resetOpen, setResetOpen] = useState(false);
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [winnerAnnouncementKey, setWinnerAnnouncementKey] = useState(0);
  const winnerChangeTypeFlowRef = useRef(false);
  const [gameOverOpen, setGameOverOpen] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);
  const gameOverShownRef = useRef(false);
  const lastWinnerEventIdRef = useRef(0);
  const lastWinnerFallbackKeyRef = useRef("");
  const declareInFlightRef = useRef(false);
  const [declareBusy, setDeclareBusy] = useState(false);

  const openWinnerAnnouncement = useCallback(() => {
    setWinnerAnnouncementKey((k) => k + 1);
    setWinnerOpen(true);
  }, []);

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
      // Don't interrupt keep-going → change-type flow.
      if (winnerChangeTypeFlowRef.current) return;

      const wsWinnerCount = detail.data.winnerCount;
      const wsWinnerEventId = detail.data.winnerEventId ?? 0;

      if (typeof wsWinnerEventId === "number" && wsWinnerEventId > 0) {
        if (wsWinnerEventId > lastWinnerEventIdRef.current) {
          lastWinnerEventIdRef.current = wsWinnerEventId;
          openWinnerAnnouncement();
        }
        return;
      }

      if (typeof wsWinnerCount === "number" && wsWinnerCount > 0) {
        openWinnerAnnouncement();
      }
    };
    window.addEventListener("bingo:ws-message", onWsMessage as EventListener);
    return () => window.removeEventListener("bingo:ws-message", onWsMessage as EventListener);
  }, [openWinnerAnnouncement]);

  useEffect(() => {
    if (remaining > 0 || called.length === 0) {
      gameOverShownRef.current = false;
      setGameOverOpen(false);
      return;
    }
    if (!gameOverShownRef.current) {
      gameOverShownRef.current = true;
      setGameOverOpen(true);
    }
  }, [remaining, called.length]);

  useEffect(() => {
    const eventId = winnerEventId ?? 0;
    if (eventId <= 0) return;
    if (eventId <= lastWinnerEventIdRef.current) return;
    lastWinnerEventIdRef.current = eventId;
    if (winnerChangeTypeFlowRef.current) return;
    openWinnerAnnouncement();
  }, [winnerEventId, openWinnerAnnouncement]);

  useEffect(() => {
    const activeWinner = (winnerCount ?? 0) > 0 || winnerDeclared;
    if (!activeWinner) return;
    if (winnerChangeTypeFlowRef.current) return;
    const fallbackKey = `${winnerCount ?? 0}:${called.length}:${winnerDeclared ? 1 : 0}`;
    if (lastWinnerFallbackKeyRef.current === fallbackKey) return;
    lastWinnerFallbackKeyRef.current = fallbackKey;
    openWinnerAnnouncement();
  }, [winnerDeclared, winnerCount, called.length, openWinnerAnnouncement]);

  useEffect(() => {
    if (!winnerDeclared && !winnerChangeTypeFlowRef.current) {
      setWinnerOpen(false);
    }
  }, [winnerDeclared]);

  const handleWinnerChangeTypeFlowChange = useCallback((active: boolean) => {
    winnerChangeTypeFlowRef.current = active;
  }, []);

  useEffect(() => {
    // Clear dedupe keys when winner state is inactive so next winner always re-opens modal.
    if ((winnerCount ?? 0) > 0 || winnerDeclared) return;
    lastWinnerFallbackKeyRef.current = "";
    if (called.length === 0) {
      // New round after reset uses event IDs from 0 again.
      lastWinnerEventIdRef.current = 0;
    }
  }, [winnerCount, winnerDeclared, called.length]);

  useEffect(() => {
    onWinnerDialogActiveChange?.(winnerOpen);
  }, [winnerOpen, onWinnerDialogActiveChange]);

  const handleDraw = async () => {
    if (drawingRef.current) return;
    drawingRef.current = true;
    setDrawing(true);
    try {
      const next = await api.draw();
      if (typeof next.current === "number" && next.current >= 1) {
        onAnnounceCallNumber?.(next.current);
      }
      if (onApplyServerState) {
        onApplyServerState(next);
      } else {
        onApplyOptimistic?.((prev) => next);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("pool empty") && !gameOverShownRef.current) {
        gameOverShownRef.current = true;
        setGameOverOpen(true);
      } else if (e instanceof Error && e.message.includes("409") && !gameOverShownRef.current) {
        gameOverShownRef.current = true;
        setGameOverOpen(true);
      } else if (isBoardAuthHttpError(e)) {
        window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
      }
      onRefresh({ force: true });
    } finally {
      drawingRef.current = false;
      setDrawing(false);
    }
  };

  const handleReset = async () => {
    try {
      await api.reset();
      setResetOpen(false);
      setGameOverOpen(false);
      gameOverShownRef.current = false;
      onResetComplete?.();
      onRefresh({ force: true });
    } catch (e: unknown) {
      if (isBoardAuthHttpError(e)) {
        window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
      }
      onRefresh({ force: true });
    }
  };

  const handleDeclareWinner = async () => {
    if (declareInFlightRef.current || winnerOpen || winnerDeclared) return;
    declareInFlightRef.current = true;
    setDeclareBusy(true);
    try {
      await api.declareWinner();
      openWinnerAnnouncement();
    } catch (e: unknown) {
      if (isBoardAuthHttpError(e)) {
        window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
      }
      onRefresh({ force: true });
    } finally {
      declareInFlightRef.current = false;
      setDeclareBusy(false);
    }
  };

  const poolEmpty = remaining === 0 && called.length > 0;
  const drawDisabled = poolEmpty || drawing;
  const minCalls = minCallsForSelection(gameStyle, gameType);
  // While the winner dialog is up (announce or change-type), Winner stays idle.
  const winnerDisabled = called.length < minCalls || winnerOpen || winnerDeclared || declareBusy;
  const gridClassName =
    callingStyle === "manual"
      ? "grid gap-3 portrait:grid-cols-1 landscape:grid-cols-2 md:grid-cols-2"
      : "grid gap-3 portrait:grid-cols-1 landscape:grid-cols-2 md:grid-cols-3";
  const primaryButtonClassName = "portrait:col-span-1 landscape:col-span-1 md:col-span-1";
  const resetButtonClassName =
    callingStyle === "manual"
      ? "portrait:col-span-1 landscape:col-span-2 md:col-span-1"
      : "portrait:col-span-1 landscape:col-span-2 md:col-span-1";

  return (
    <>
      <div className={gridClassName}>
        {callingStyle === "automatic" && (
          <Button
            size="lg"
            onClick={handleDraw}
            disabled={drawDisabled}
            className={cn("text-white", primaryButtonClassName)}
            style={{ backgroundColor: letterColors.N }}
          >
            <Dices className="mr-2 h-5 w-5" />
            {drawing ? "Drawing..." : "Draw next"}
          </Button>
        )}
        <Button
          size="lg"
          onClick={handleDeclareWinner}
          disabled={winnerDisabled}
          className={cn("text-white", primaryButtonClassName)}
          style={{ backgroundColor: letterColors.G }}
        >
          <Trophy className="mr-2 h-5 w-5" />
          Winner
        </Button>
        <Button
          size="lg"
          variant="outline"
          className={resetButtonClassName}
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
        announcementKey={winnerAnnouncementKey}
        onChangeTypeFlowChange={handleWinnerChangeTypeFlowChange}
        onSuppressAutoRestore={onSuppressAutoRestore}
        onRefresh={onRefresh}
        winnerCount={winnerCount}
        letterColors={letterColors}
        gameStyle={gameStyle}
      />
      {gameStyle === "housey" && gameType === "battleship" && (
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
          Afloat {survivorCount ?? 0} · Sunk {eliminatedCount ?? 0}
        </p>
      )}
      {gameStyle === "housey" && gameType !== "battleship" && (winnerCount ?? 0) > 0 && !winnerDeclared && (
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
          Pattern complete · {winnerCount} card{(winnerCount ?? 0) === 1 ? "" : "s"}
        </p>
      )}
      <GameOverDialog open={gameOverOpen} onOpenChange={setGameOverOpen} onReset={handleReset} />
    </>
  );
}
