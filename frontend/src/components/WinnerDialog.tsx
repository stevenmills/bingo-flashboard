import { useState, useEffect, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/api";
import { isBoardAuthHttpError } from "@/lib/board-auth";
import type { RefreshOptions } from "@/hooks/useGameState";
import type { GameType } from "@/types";
import { PartyPopper } from "lucide-react";
import confetti from "canvas-confetti";
import type { LetterColors } from "@/lib/bingo-ui-colors";
import { GameTypePicker } from "@/components/GameTypePicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeTypeFlowChange?: (active: boolean) => void;
  onSuppressAutoRestore?: () => void;
  onRefresh?: (options?: RefreshOptions) => void;
  winnerCount?: number;
  letterColors: LetterColors;
  /** Bumps whenever a new winner announcement should start (force winner phase). */
  announcementKey?: number;
}

export function WinnerDialog({
  open,
  onOpenChange,
  onChangeTypeFlowChange,
  onSuppressAutoRestore,
  onRefresh,
  winnerCount,
  letterColors,
  announcementKey = 0,
}: Props) {
  const [phase, setPhase] = useState<"winner" | "changeType">("winner");
  const [newType, setNewType] = useState<GameType | "">("");
  const [actionBusy, setActionBusy] = useState(false);

  const fireConfetti = useCallback(() => {
    const duration = 3000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.6 },
        colors: ["#f59e0b", "#ef4444", "#3b82f6", "#22c55e", "#a855f7"],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.6 },
        colors: ["#f59e0b", "#ef4444", "#3b82f6", "#22c55e", "#a855f7"],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };

    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#f59e0b", "#ef4444", "#3b82f6", "#22c55e", "#a855f7"],
    });

    frame();
  }, []);

  // Every winner activation starts on the announcement screen (never the change-type screen).
  useEffect(() => {
    if (!open) {
      onChangeTypeFlowChange?.(false);
      setPhase("winner");
      setNewType("");
      setActionBusy(false);
      return;
    }
    setPhase("winner");
    setNewType("");
    setActionBusy(false);
    onChangeTypeFlowChange?.(false);
  }, [open, announcementKey, onChangeTypeFlowChange]);

  useEffect(() => {
    if (open && phase === "winner") {
      fireConfetti();
    }
  }, [open, phase, announcementKey, fireConfetti]);

  const handleActionError = useCallback((error: unknown) => {
    if (isBoardAuthHttpError(error)) {
      window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
    }
  }, []);

  const handleKeepGoing = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    // Mark keep-going before clearing so WS winner events don't reopen the announce screen.
    onChangeTypeFlowChange?.(true);
    setPhase("changeType");
    try {
      await api.clearWinner();
    } catch (error) {
      handleActionError(error);
      onChangeTypeFlowChange?.(false);
      setPhase("winner");
      onRefresh?.({ force: true });
    } finally {
      setActionBusy(false);
    }
  };

  const handleReset = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    onSuppressAutoRestore?.();
    try {
      await api.reset();
      closeDialog();
    } catch (error) {
      handleActionError(error);
      onRefresh?.({ force: true });
    } finally {
      setActionBusy(false);
    }
  };

  const handleChangeType = async () => {
    if (actionBusy || !newType) return;
    setActionBusy(true);
    try {
      await api.setGameType(newType);
      closeDialog();
    } catch (error) {
      handleActionError(error);
      onRefresh?.({ force: true });
    } finally {
      setActionBusy(false);
    }
  };

  const closeDialog = () => {
    onChangeTypeFlowChange?.(false);
    setPhase("winner");
    setNewType("");
    onOpenChange(false);
  };

  const handleSkip = () => {
    closeDialog();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeDialog(); }}>
      <DialogContent
        className={phase === "winner" ? "text-center" : "max-w-lg sm:max-w-xl"}
        hideClose
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {phase === "changeType" ? (
          <>
            <DialogHeader>
              <DialogTitle>Change game type?</DialogTitle>
              <DialogDescription>
                Pick a type for the next round, or keep the current one.
              </DialogDescription>
            </DialogHeader>
            <GameTypePicker
              value={newType}
              onChange={(gt) => setNewType(gt)}
              letterColors={letterColors}
              idPrefix="winner-gt"
              maxListHeightClass="max-h-[min(40dvh,18rem)]"
            />
            <div className="flex gap-3 mt-2">
              <Button variant="outline" className="flex-1" onClick={handleChangeType} disabled={!newType || actionBusy}>
                Change
              </Button>
              <Button className="flex-1" onClick={handleSkip} disabled={actionBusy}>
                Keep current
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              <PartyPopper className="h-12 w-12" style={{ color: letterColors.G }} />
            </div>
            <DialogHeader className="text-center">
              <DialogTitle className="text-center text-2xl">Winner!</DialogTitle>
              {typeof winnerCount === "number" && winnerCount > 0 && (
                <p className="text-center text-sm font-medium" style={{ color: letterColors.G }}>
                  Winners identified: {winnerCount}
                </p>
              )}
              <DialogDescription className="text-center">
                What would you like to do?
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-2">
              <Button
                size="lg"
                onClick={handleKeepGoing}
                disabled={actionBusy}
                className="text-white"
                style={{ backgroundColor: letterColors.N }}
              >
                Keep going
              </Button>
              <Button
                size="lg"
                onClick={handleReset}
                disabled={actionBusy}
                className="text-white"
                style={{ backgroundColor: letterColors.B }}
              >
                Reset / New game
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
