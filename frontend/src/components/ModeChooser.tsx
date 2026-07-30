import { Button } from "@/components/ui/button";
import type { AppMode } from "@/types";
import { AppWindow, Camera, Sheet, Tv } from "lucide-react";

interface Props {
  onSelect: (mode: AppMode) => void;
}

export function ModeChooser({ onSelect }: Props) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-5xl grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Button
          type="button"
          variant="outline"
          className="h-52 text-xl font-semibold flex-col gap-3"
          onClick={() => onSelect("board")}
        >
          <AppWindow className="h-10 w-10" />
          Board
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-52 text-xl font-semibold flex-col gap-3"
          onClick={() => onSelect("card")}
        >
          <Sheet className="h-10 w-10" />
          Card
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-52 text-xl font-semibold flex-col gap-3"
          onClick={() => onSelect("scan")}
        >
          <Camera className="h-10 w-10" />
          Scan
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-52 text-xl font-semibold flex-col gap-3"
          onClick={() => onSelect("hud")}
        >
          <Tv className="h-10 w-10" />
          HUD
        </Button>
      </div>
    </div>
  );
}
