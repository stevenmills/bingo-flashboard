import { cn } from "@/lib/utils";
import {
  labelForGameType,
  type AnyGameType,
} from "@/types";
import { useGameTypeCells } from "@/hooks/useGameTypeCells";
import { LETTERS } from "@/types";
import { rgbaFromHex, type LetterColors } from "@/lib/bingo-ui-colors";

const FREE_CELL = 13;

interface Props {
  gameType: AnyGameType;
  patternIndex: number;
  letterColors: LetterColors;
  /** Scale to fill parent cell without overflowing (HUD). */
  hud?: boolean;
  className?: string;
}

export function GameTypeIndicator({
  gameType,
  patternIndex,
  letterColors,
  hud = false,
  className,
}: Props) {
  const activeCells = useGameTypeCells(gameType, patternIndex);
  const activeCellSet = new Set(activeCells);

  return (
    <div
      className={cn(
        "flex flex-col items-center",
        hud
          ? "h-full min-h-0 w-full justify-center gap-2 overflow-hidden [container-type:size]"
          : "gap-2",
        className
      )}
    >
      <span
        className={cn(
          "font-semibold text-muted-foreground text-center shrink-0",
          hud ? "text-base sm:text-lg px-1 truncate max-w-full" : "text-sm"
        )}
      >
        {labelForGameType(gameType)}
      </span>
      <div
        className={cn(
          "grid grid-cols-5 mx-auto",
          hud
            ? // Largest square that fits beside the label inside the HUD cell.
              "gap-1.5 sm:gap-2 aspect-square min-h-0 w-[min(100cqw,calc(100cqh-2.75rem))]"
            : "gap-1.5 w-[10rem] aspect-square"
        )}
      >
        {Array.from({ length: 25 }, (_, i) => {
          const cell = i + 1;
          const isFreeCell = cell === FREE_CELL;
          const isActive = activeCellSet.has(cell);
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
                  className={cn(
                    "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-1 ring-black/35 shadow-sm",
                    hud ? "h-3 w-3 sm:h-3.5 sm:w-3.5" : "h-2.5 w-2.5"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
