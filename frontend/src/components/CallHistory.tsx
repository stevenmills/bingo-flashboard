import { Badge } from "@/components/ui/badge";
import { numberToLetter, type Letter } from "@/types";
import { rgbaFromHex, type LetterColors } from "@/lib/bingo-ui-colors";
import { cn } from "@/lib/utils";

interface Props {
  called: number[];
  letterColors: LetterColors;
  /** Dense badges that clip instead of scrolling (HUD). */
  hud?: boolean;
  className?: string;
}

export function CallHistory({ called, letterColors, hud = false, className }: Props) {
  if (!called.length) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        No numbers called yet
      </p>
    );
  }

  return (
    <div
      className={cn(
        "h-full",
        hud
          ? "grid grid-cols-1 content-start gap-2 overflow-hidden sm:gap-2.5"
          : "flex flex-wrap content-start gap-2.5 overflow-y-auto",
        className
      )}
    >
      {[...called].reverse().map((n) => {
        const letter = numberToLetter(n) as Letter;
        return (
          <Badge
            key={n}
            className={cn(
              "font-extrabold leading-none tabular-nums",
              hud
                ? "w-full justify-center rounded-md px-3 py-3 text-xl sm:py-3.5 sm:text-2xl"
                : "px-3.5 py-1.5 text-base"
            )}
            style={{
              backgroundColor: rgbaFromHex(letterColors[letter], 0.95),
              color: "#ffffff",
            }}
          >
            {letter}-{n}
          </Badge>
        );
      })}
    </div>
  );
}
