import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { DEFAULT_LETTER_COLORS, rgbaFromHex, type LetterColors } from "@/lib/bingo-ui-colors";
import {
  GAME_TYPE_LABELS,
  LETTERS,
  LETTER_RANGES,
  type GameType,
  type CallingStyle,
} from "@/types";

interface Props {
  gameType: GameType;
  callingStyle: CallingStyle;
  gameEstablished: boolean;
  called: number[];
  letterColors?: LetterColors;
  onRefresh: () => void;
}

export function GameSetup({
  gameType,
  callingStyle,
  gameEstablished,
  called,
  letterColors = DEFAULT_LETTER_COLORS,
  onRefresh,
}: Props) {
  const calledSet = new Set(called);
  const radioFocus = `0 0 0 2px ${rgbaFromHex(letterColors.N, 0.35)}`;

  const handleGameType = async (v: string) => {
    try {
      await api.setGameType(v as GameType);
    } finally {
      onRefresh();
    }
  };

  const handleCallingStyle = async (v: string) => {
    try {
      await api.setCallingStyle(v as CallingStyle);
    } finally {
      onRefresh();
    }
  };

  const handleCallNumber = async (n: number) => {
    try {
      await api.callNumber(n);
    } finally {
      onRefresh();
    }
  };

  return (
    <div className="space-y-5">
      {/* Game type — pre-game only */}
      {!gameEstablished && <div>
        <Label className="mb-2 block text-muted-foreground">Game type</Label>
        <RadioGroup value={gameType} onValueChange={handleGameType} className="grid grid-cols-2 gap-2">
          {(Object.keys(GAME_TYPE_LABELS) as GameType[]).map((gt) => (
            <Label
              key={gt}
              htmlFor={`gt-${gt}`}
              className={cn(
                "flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer text-sm transition-colors",
                gameType === gt ? "" : "border-border"
              )}
              style={
                gameType === gt
                  ? {
                      borderColor: letterColors.N,
                      backgroundColor: rgbaFromHex(letterColors.N, 0.12),
                    }
                  : undefined
              }
            >
              <RadioGroupItem
                value={gt}
                id={`gt-${gt}`}
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
                style={{ borderColor: letterColors.N, color: letterColors.N }}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow = radioFocus;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = "";
                }}
              />
              {GAME_TYPE_LABELS[gt]}
            </Label>
          ))}
        </RadioGroup>
      </div>}

      {/* Calling style — pre-game only */}
      {!gameEstablished && (
        <div>
          <Label className="mb-2 block text-muted-foreground">Calling style</Label>
          <RadioGroup value={callingStyle} onValueChange={handleCallingStyle} className="grid grid-cols-2 gap-2">
            <Label
              htmlFor="cs-auto"
              className={cn(
                "flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer text-sm transition-colors",
                callingStyle === "automatic" ? "" : "border-border"
              )}
              style={
                callingStyle === "automatic"
                  ? {
                      borderColor: letterColors.N,
                      backgroundColor: rgbaFromHex(letterColors.N, 0.12),
                    }
                  : undefined
              }
            >
              <RadioGroupItem
                value="automatic"
                id="cs-auto"
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
                style={{ borderColor: letterColors.N, color: letterColors.N }}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow = radioFocus;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = "";
                }}
              />
              Automatic
            </Label>
            <Label
              htmlFor="cs-manual"
              className={cn(
                "flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer text-sm transition-colors",
                callingStyle === "manual" ? "" : "border-border"
              )}
              style={
                callingStyle === "manual"
                  ? {
                      borderColor: letterColors.N,
                      backgroundColor: rgbaFromHex(letterColors.N, 0.12),
                    }
                  : undefined
              }
            >
              <RadioGroupItem
                value="manual"
                id="cs-manual"
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
                style={{ borderColor: letterColors.N, color: letterColors.N }}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow = radioFocus;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = "";
                }}
              />
              Manual
            </Label>
          </RadioGroup>
        </div>
      )}

      {/* Manual call panel — compact number button grid (active game only) */}
      {callingStyle === "manual" && gameEstablished && (
        <div>
          <Label className="mb-3 block text-muted-foreground">Tap a number to call it</Label>
          <div className="space-y-2">
            {LETTERS.map((letter) => {
              const [lo, hi] = LETTER_RANGES[letter];
              const numbers = Array.from({ length: hi - lo + 1 }, (_, j) => lo + j);
              const allCalled = numbers.every((n) => calledSet.has(n));

              return (
                <div key={letter} className={cn("flex items-start gap-2", allCalled && "opacity-40")}>
                  {/* Letter badge */}
                  <div
                    className={cn(
                      "flex-shrink-0 w-9 h-8 md:w-10 md:h-9 rounded-md flex items-center justify-center text-xs md:text-sm font-semibold",
                      allCalled ? "bg-muted text-muted-foreground" : "text-white"
                    )}
                    style={allCalled ? undefined : { backgroundColor: letterColors[letter] }}
                  >
                    {letter}
                  </div>
                  {/* Number buttons */}
                  <div className="flex flex-wrap gap-1">
                    {numbers.map((n) => {
                      const isCalled = calledSet.has(n);
                      return (
                        <button
                          key={n}
                          disabled={isCalled}
                          onClick={() => handleCallNumber(n)}
                          className={cn(
                            "w-9 h-8 md:w-10 md:h-9 rounded-md text-xs md:text-sm font-semibold tabular-nums transition-all hover:brightness-110 active:brightness-90",
                            isCalled
                              ? "bg-muted text-muted-foreground/40 cursor-not-allowed line-through"
                              : "text-white cursor-pointer shadow-sm"
                          )}
                          style={isCalled ? undefined : { backgroundColor: rgbaFromHex(letterColors[letter], 0.95) }}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
