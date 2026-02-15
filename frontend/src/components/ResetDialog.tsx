import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import type { LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  letterColors: LetterColors;
}

export function ResetDialog({ open, onOpenChange, onConfirm, letterColors }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" style={{ color: letterColors.I }} />
            <DialogTitle>Reset game?</DialogTitle>
          </div>
          <DialogDescription>
            All called numbers will be cleared. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 mt-2">
          <Button
            className="flex-1 text-white"
            style={{ backgroundColor: letterColors.I }}
            onClick={onConfirm}
          >
            Reset
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
