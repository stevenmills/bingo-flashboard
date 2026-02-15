import { cn } from "@/lib/utils";
import { GAME_TYPE_LABELS, type GameType } from "@/types";
import { useGameTypeCells } from "@/hooks/useGameTypeCells";
import { LETTERS } from "@/types";
import { rgbaFromHex, type LetterColors } from "@/lib/bingo-ui-colors";

const FREE_CELL = 13;

interface Props {
  gameType: GameType;
  patternIndex: number;
  letterColors: LetterColors;
}

export function GameTypeIndicator({ gameType, patternIndex, letterColors }: Props) {
  const activeCells = useGameTypeCells(gameType, patternIndex);
  const activeCellSet = new Set(activeCells);

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-sm font-semibold text-muted-foreground">
        {GAME_TYPE_LABELS[gameType]}
      </span>
      <div className="grid grid-cols-5 gap-1.5 w-[10rem] aspect-square mx-auto">
        {Array.from({ length: 25 }, (_, i) => {
          const cell = i + 1;
          const isFreeCell = cell === FREE_CELL;
          const isActive = activeCellSet.has(cell) || (gameType === "y" && isFreeCell);
          const columnIdx = i % 5;

          return (
            <div
              key={i}
              className={cn(
                "relative rounded-sm transition-colors duration-300",
                isActive ? "" : "bg-muted"
              )}
              style={isActive ? { backgroundColor: rgbaFromHex(letterColors[LETTERS[columnIdx]], 0.9) } : undefined}
            >
              {isActive && isFreeCell && (
                <span
                  role="img"
                  aria-label="Free space"
                  className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-1 ring-black/35 shadow-sm"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
