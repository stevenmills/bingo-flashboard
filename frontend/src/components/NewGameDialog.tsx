import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GameSetup } from "@/components/GameSetup";
import type { RefreshOptions } from "@/hooks/useGameState";
import type { GameState } from "@/types";
import { Play } from "lucide-react";
import type { LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: GameState;
  onStart: () => void;
  onRefresh: (options?: RefreshOptions) => void;
  onApplyOptimistic?: (updater: (prev: GameState) => GameState) => void;
  letterColors: LetterColors;
}

export function NewGameDialog({
  open,
  onOpenChange,
  state,
  onStart,
  onRefresh,
  onApplyOptimistic,
  letterColors,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(calc(100dvh-1.5rem),42rem)] max-w-lg flex-col gap-3 overflow-hidden sm:h-[min(calc(100dvh-2rem),50rem)] sm:max-w-3xl lg:max-w-4xl lg:h-[min(calc(100dvh-3rem),54rem)]">
        <DialogHeader className="shrink-0">
          <DialogTitle>New Game</DialogTitle>
          <DialogDescription>
            Choose your game type and calling style, then start the game.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <GameSetup
            gameStyle={state.gameStyle ?? "bingo"}
            gameType={state.gameType}
            callingStyle={state.callingStyle}
            gameEstablished={false}
            called={state.called}
            letterColors={letterColors}
            onRefresh={onRefresh}
            onApplyOptimistic={onApplyOptimistic}
            fillHeight
          />
        </div>

        <Button
          size="lg"
          className="w-full shrink-0 text-white"
          style={{ backgroundColor: letterColors.N }}
          onClick={onStart}
        >
          <Play className="mr-2 h-5 w-5" />
          Start game
        </Button>
      </DialogContent>
    </Dialog>
  );
}
