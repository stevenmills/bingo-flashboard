import { LETTERS, LETTER_RANGES } from "@/types";
import { cn } from "@/lib/utils";
import { rgbaFromHex, type LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  called: number[];
  current: number;
  letterColors: LetterColors;
  /** Battleship: invert board (lit until called) + late-round red strobe. */
  sinkMode?: boolean;
}

function cellLit(sinkMode: boolean, isCalled: boolean, isCurrent: boolean): boolean {
  if (sinkMode) return !isCalled || isCurrent;
  return isCalled;
}

function letterHeaderLit(sinkMode: boolean, calledInCol: number, colSize: number): boolean {
  if (sinkMode) return calledInCol < colSize;
  return calledInCol > 0;
}

export function Flashboard({ called, current, letterColors, sinkMode = false }: Props) {
  const calledSet = new Set(called);
  const sinkThreat = sinkMode && called.length >= 38;

  return (
    <>
      <div className="portrait:block landscape:hidden md:hidden space-y-2">
        {LETTERS.map((letter) => {
          const [lo, hi] = LETTER_RANGES[letter];
          const colSize = hi - lo + 1;
          const calledInCol = called.filter((n) => n >= lo && n <= hi).length;
          const headerOn = letterHeaderLit(sinkMode, calledInCol, colSize);
          return (
            <div key={letter} className="rounded-md border border-border/50 p-2">
              <div
                className={cn(
                  "mb-2 rounded-sm px-2 py-1 text-center text-sm font-bold transition-colors",
                  headerOn
                    ? "text-white"
                    : "bg-muted/50 text-muted-foreground/40 dark:bg-muted/30 dark:text-muted-foreground/25"
                )}
                style={headerOn ? { backgroundColor: letterColors[letter] } : undefined}
              >
                {letter}
              </div>
              <div className="grid grid-cols-5 gap-1">
                {Array.from({ length: 15 }, (_, j) => {
                  const n = lo + j;
                  const isCalled = calledSet.has(n);
                  const isCurrent = n === current;
                  const lit = cellLit(sinkMode, isCalled, isCurrent);
                  const threatCurrent = sinkThreat && isCurrent;
                  return (
                    <div
                      key={n}
                      className={cn(
                        "rounded-sm border border-border/50 py-1 text-center text-sm tabular-nums font-semibold transition-colors",
                        lit
                          ? "text-white"
                          : "text-muted-foreground/50 dark:text-muted-foreground/30",
                        isCurrent && !threatCurrent && "ring-2 ring-white ring-inset animate-pulse",
                        threatCurrent && "ring-2 ring-red-500 ring-inset battleship-sink-strobe"
                      )}
                      style={
                        threatCurrent
                          ? { backgroundColor: "#FF0000" }
                          : lit
                            ? { backgroundColor: rgbaFromHex(letterColors[letter], 0.9) }
                            : undefined
                      }
                    >
                      {n}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden landscape:block md:block overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-xs md:text-sm">
          <tbody>
            {LETTERS.map((letter) => {
              const [lo, hi] = LETTER_RANGES[letter];
              const colSize = hi - lo + 1;
              const calledInCol = called.filter((n) => n >= lo && n <= hi).length;
              const headerOn = letterHeaderLit(sinkMode, calledInCol, colSize);
              return (
                <tr key={letter}>
                  <td
                    className={cn(
                      "py-1.5 px-2 text-center font-bold border border-border/50 w-8 transition-colors",
                      headerOn
                        ? "text-white"
                        : "bg-muted/50 text-muted-foreground/40 dark:bg-muted/30 dark:text-muted-foreground/25"
                    )}
                    style={headerOn ? { backgroundColor: letterColors[letter] } : undefined}
                  >
                    {letter}
                  </td>
                  {Array.from({ length: 15 }, (_, j) => {
                    const n = lo + j;
                    const isCalled = calledSet.has(n);
                    const isCurrent = n === current;
                    const lit = cellLit(sinkMode, isCalled, isCurrent);
                    const threatCurrent = sinkThreat && isCurrent;
                    return (
                      <td
                        key={n}
                        className={cn(
                          "py-1.5 px-0.5 text-center tabular-nums font-semibold border border-border/50 transition-colors",
                          lit
                            ? "text-white"
                            : "text-muted-foreground/50 dark:text-muted-foreground/30",
                          isCurrent && !threatCurrent && "ring-2 ring-white ring-inset animate-pulse",
                          threatCurrent && "ring-2 ring-red-500 ring-inset battleship-sink-strobe"
                        )}
                        style={
                          threatCurrent
                            ? { backgroundColor: "#FF0000" }
                            : lit
                              ? { backgroundColor: rgbaFromHex(letterColors[letter], 0.9) }
                              : undefined
                        }
                      >
                        {n}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
