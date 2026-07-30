import { Card, CardContent } from "@/components/ui/card";
import { numberToLetter } from "@/types";
import { cn } from "@/lib/utils";
import { mixHex, type LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  current: number;
  remaining: number;
  letterColors: LetterColors;
  compact?: boolean;
  /** Fill parent and scale the badge to available space (HUD / TV). */
  hud?: boolean;
  className?: string;
}

export function CurrentNumber({
  current,
  remaining,
  letterColors,
  compact = false,
  hud = false,
  className,
}: Props) {
  const letter = current ? numberToLetter(current) : null;
  const baseColor = letter ? letterColors[letter] : null;
  const gradientStyle =
    baseColor
      ? {
          backgroundImage: `linear-gradient(to bottom right, ${mixHex(baseColor, "#ffffff", 0.08)}, ${mixHex(baseColor, "#000000", 0.18)})`,
        }
      : undefined;

  return (
    <Card className={cn("overflow-hidden", hud && "h-full min-h-0", className)}>
      <CardContent className="p-0 h-full">
        <div
          className={cn(
            "flex h-full flex-col items-center justify-center px-4 transition-colors duration-300",
            hud ? "py-4" : compact ? "py-4" : "py-8",
            current
              ? "text-white"
              : "bg-card text-card-foreground dark:bg-muted"
          )}
          style={current ? gradientStyle : undefined}
        >
          <div
            className={cn(
              "inline-flex flex-col items-center justify-center rounded-full border-[6px] text-center",
              hud
                ? "h-[min(70vmin,85%)] w-[min(70vmin,85%)] max-h-full max-w-full aspect-square p-[clamp(1rem,3vmin,2.5rem)]"
                : compact
                  ? "h-36 w-36 p-4"
                  : "h-56 w-56 p-6",
              current ? "border-white/75 shadow-lg" : "border-border/70 bg-background/70"
            )}
          >
            <span
              className={cn(
                "font-medium uppercase tracking-widest mb-1",
                hud ? "text-[clamp(0.65rem,1.5vmin,1rem)]" : "text-xs",
                current ? "text-white/80" : "text-muted-foreground"
              )}
            >
              Current number
            </span>
            <span
              className={cn(
                "font-black tabular-nums leading-none",
                hud
                  ? "text-[clamp(2.5rem,12vmin,8rem)]"
                  : compact
                    ? "text-3xl"
                    : "text-5xl md:text-6xl"
              )}
            >
              {current ? `${letter}-${current}` : "—"}
            </span>
            <span
              className={cn(
                "mt-3",
                hud ? "text-[clamp(0.75rem,2vmin,1.25rem)]" : "text-sm",
                current ? "text-white/70" : "text-muted-foreground"
              )}
            >
              {remaining} remaining
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
