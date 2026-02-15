import { Button } from "@/components/ui/button";
import { AppWindow, Sheet } from "lucide-react";

type AppMode = "board" | "card";

interface Props {
  onSelect: (mode: AppMode) => void;
}

export function ModeChooser({ onSelect }: Props) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-4xl grid gap-4 sm:grid-cols-2">
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
      </div>
    </div>
  );
}
