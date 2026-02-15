import { Card, CardContent } from "@/components/ui/card";
import { numberToLetter } from "@/types";
import { cn } from "@/lib/utils";
import { mixHex, type LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  current: number;
  remaining: number;
  letterColors: LetterColors;
}

export function CurrentNumber({ current, remaining, letterColors }: Props) {
  const letter = current ? numberToLetter(current) : null;
  const baseColor = letter ? letterColors[letter] : null;
  const gradientStyle =
    baseColor
      ? {
          backgroundImage: `linear-gradient(to bottom right, ${mixHex(baseColor, "#ffffff", 0.08)}, ${mixHex(baseColor, "#000000", 0.18)})`,
        }
      : undefined;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div
          className={cn(
            "flex flex-col items-center justify-center py-8 px-4 transition-colors duration-300",
            current
              ? "text-white"
              : "bg-card text-card-foreground dark:bg-muted"
          )}
          style={current ? gradientStyle : undefined}
        >
          <div
            className={cn(
              "inline-flex h-56 w-56 flex-col items-center justify-center rounded-full border-[6px] p-6 text-center",
              current ? "border-white/75 shadow-lg" : "border-border/70 bg-background/70"
            )}
          >
            <span className={cn(
              "text-xs font-medium uppercase tracking-widest mb-1",
              current ? "text-white/80" : "text-muted-foreground"
            )}>
              Current number
            </span>
            <span className="text-5xl md:text-6xl font-black tabular-nums leading-none">
              {current ? `${letter}-${current}` : "—"}
            </span>
            <span className={cn(
              "mt-3 text-sm",
              current ? "text-white/70" : "text-muted-foreground"
            )}>
              {remaining} remaining
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
