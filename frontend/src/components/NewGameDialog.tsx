import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GameSetup } from "@/components/GameSetup";
import type { GameState } from "@/types";
import { Play } from "lucide-react";
import type { LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  open: boolean;
  state: GameState;
  onStart: () => void;
  onRefresh: () => void;
  letterColors: LetterColors;
}

export function NewGameDialog({ open, state, onStart, onRefresh, letterColors }: Props) {
  return (
    <Dialog open={open}>
      <DialogContent className="max-w-2xl" hideClose onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>New Game</DialogTitle>
          <DialogDescription>
            Choose your game type and calling style, then start the game.
          </DialogDescription>
        </DialogHeader>

        <GameSetup
          gameType={state.gameType}
          callingStyle={state.callingStyle}
          gameEstablished={false}
          called={state.called}
          letterColors={letterColors}
          onRefresh={onRefresh}
        />

        <Button
          size="lg"
          className="w-full mt-2 text-white"
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
