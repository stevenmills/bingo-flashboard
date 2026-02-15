import { LETTERS, LETTER_RANGES } from "@/types";
import { cn } from "@/lib/utils";
import { rgbaFromHex, type LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  called: number[];
  current: number;
  letterColors: LetterColors;
}

export function Flashboard({ called, current, letterColors }: Props) {
  const calledSet = new Set(called);

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-xs md:text-sm">
        <tbody>
          {LETTERS.map((letter) => {
            const [lo, hi] = LETTER_RANGES[letter];
            const hasCall = called.some((n) => n >= lo && n <= hi);
            return (
              <tr key={letter}>
                {/* Letter header — lit when any number in row is called, off otherwise */}
                <td
                  className={cn(
                    "py-1.5 px-2 text-center font-bold border border-border/50 w-8 transition-colors",
                    hasCall
                      ? "text-white"
                      : "bg-muted/50 text-muted-foreground/40 dark:bg-muted/30 dark:text-muted-foreground/25"
                  )}
                  style={hasCall ? { backgroundColor: letterColors[letter] } : undefined}
                >
                  {letter}
                </td>
                {Array.from({ length: 15 }, (_, j) => {
                  const n = lo + j;
                  const isCalled = calledSet.has(n);
                  const isCurrent = n === current;
                  return (
                    <td
                      key={n}
                      className={cn(
                        "py-1.5 px-0.5 text-center tabular-nums font-semibold border border-border/50 transition-colors",
                        isCalled
                          ? "text-white"
                          : "text-muted-foreground/50 dark:text-muted-foreground/30",
                        isCurrent &&
                          "ring-2 ring-white ring-inset animate-pulse"
                      )}
                      style={isCalled ? { backgroundColor: rgbaFromHex(letterColors[letter], 0.9) } : undefined}
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
  );
}
