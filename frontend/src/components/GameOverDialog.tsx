import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CircleOff } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
}

export function GameOverDialog({ open, onOpenChange, onReset }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-center">
        <div className="flex justify-center">
          <CircleOff className="h-12 w-12 text-muted-foreground" />
        </div>
        <DialogHeader className="text-center">
          <DialogTitle className="text-center text-2xl">Out of numbers!</DialogTitle>
          <DialogDescription className="text-center">
            All 75 numbers have been called. Start a new game to continue playing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          <Button size="lg" onClick={onReset}>
            Reset / New game
          </Button>
          <Button size="lg" variant="outline" onClick={() => onOpenChange(false)}>
            Dismiss
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
