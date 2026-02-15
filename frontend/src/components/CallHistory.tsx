import { Badge } from "@/components/ui/badge";
import { numberToLetter, type Letter } from "@/types";
import { rgbaFromHex, type LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  called: number[];
  letterColors: LetterColors;
}

export function CallHistory({ called, letterColors }: Props) {
  if (!called.length) {
    return <p className="text-sm text-muted-foreground">No numbers called yet</p>;
  }

  return (
    <div className="h-full overflow-y-auto flex flex-wrap gap-2.5 content-start">
      {[...called].reverse().map((n) => {
        const letter = numberToLetter(n) as Letter;
        return (
          <Badge
            key={n}
            className="px-3.5 py-1.5 text-base font-extrabold leading-none tabular-nums"
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
