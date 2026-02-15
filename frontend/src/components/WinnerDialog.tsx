import { useState, useEffect, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { api } from "@/api";
import { GAME_TYPE_LABELS, type GameType } from "@/types";
import { cn } from "@/lib/utils";
import { PartyPopper } from "lucide-react";
import confetti from "canvas-confetti";
import type { LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  winnerCount?: number;
  letterColors: LetterColors;
}

export function WinnerDialog({ open, onOpenChange, onRefresh, winnerCount, letterColors }: Props) {
  const [phase, setPhase] = useState<"winner" | "changeType">("winner");
  const [newType, setNewType] = useState<GameType | "">("");

  const fireConfetti = useCallback(() => {
    const duration = 3000;
    const end = Date.now() + duration;

    const frame = () => {
      // Left side burst
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.6 },
        colors: ["#f59e0b", "#ef4444", "#3b82f6", "#22c55e", "#a855f7"],
      });
      // Right side burst
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

    // Initial big burst from center
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#f59e0b", "#ef4444", "#3b82f6", "#22c55e", "#a855f7"],
    });

    // Then continuous side bursts
    frame();
  }, []);

  useEffect(() => {
    if (open && phase === "winner") {
      fireConfetti();
    }
  }, [open, phase, fireConfetti]);

  const handleKeepGoing = async () => {
    await api.clearWinner();
    onRefresh();
    setPhase("changeType");
  };

  const handleReset = async () => {
    await api.reset();
    onRefresh();
    setPhase("winner");
    onOpenChange(false);
  };

  const handleChangeType = async () => {
    if (newType) {
      await api.setGameType(newType);
      onRefresh();
    }
    setPhase("winner");
    onOpenChange(false);
  };

  const handleSkip = () => {
    setPhase("winner");
    onOpenChange(false);
  };

  if (phase === "changeType") {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleSkip(); }}>
        <DialogContent
          hideClose
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Change game type?</DialogTitle>
            <DialogDescription>
              Pick a type for the next round, or keep the current one.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={newType} onValueChange={(v) => setNewType(v as GameType)} className="grid grid-cols-2 gap-2">
            {(Object.keys(GAME_TYPE_LABELS) as GameType[]).map((gt) => (
              <Label
                key={gt}
                htmlFor={`wgt-${gt}`}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer text-sm transition-colors",
                  newType === gt ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                )}
              >
                <RadioGroupItem value={gt} id={`wgt-${gt}`} />
                {GAME_TYPE_LABELS[gt]}
              </Label>
            ))}
          </RadioGroup>
          <div className="flex gap-3 mt-2">
            <Button className="flex-1" onClick={handleChangeType} disabled={!newType}>
              Change
            </Button>
            <Button variant="outline" className="flex-1" onClick={handleSkip}>
              Keep current
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="text-center"
        hideClose
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
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
            className="text-white"
            style={{ backgroundColor: letterColors.N }}
          >
            Keep going
          </Button>
          <Button
            size="lg"
            onClick={handleReset}
            className="text-white"
            style={{ backgroundColor: letterColors.B }}
          >
            Reset / New game
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
