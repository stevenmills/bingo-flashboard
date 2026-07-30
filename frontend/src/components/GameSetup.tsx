import { useEffect, useMemo, useState } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { api } from "@/api";
import { isBoardAuthHttpError } from "@/lib/board-auth";
import { cn } from "@/lib/utils";
import { DEFAULT_LETTER_COLORS, rgbaFromHex, type LetterColors } from "@/lib/bingo-ui-colors";
import type { RefreshOptions } from "@/hooks/useGameState";
import {
  LETTERS,
  LETTER_RANGES,
  type GameState,
  type AnyGameType,
  type CallingStyle,
} from "@/types";
import { GameTypePicker } from "@/components/GameTypePicker";

interface Props {
  gameType: AnyGameType;
  callingStyle: CallingStyle;
  gameEstablished: boolean;
  called: number[];
  letterColors?: LetterColors;
  onRefresh: (options?: RefreshOptions) => void;
  onApplyOptimistic?: (updater: (prev: GameState) => GameState) => void;
  onApplyServerState?: (state: GameState) => void;
  onPrefetchCallNumber?: (n: number) => void;
  onAnnounceCallNumber?: (n: number) => void;
  /**
   * Pre-game only: fill the parent's height so the game-type list is the sole
   * scroll region and the calling-style controls stay pinned (mobile dialogs).
   */
  fillHeight?: boolean;
}

export function GameSetup({
  gameType,
  callingStyle,
  gameEstablished,
  called,
  letterColors = DEFAULT_LETTER_COLORS,
  onRefresh,
  onApplyOptimistic,
  onApplyServerState,
  onPrefetchCallNumber,
  onAnnounceCallNumber,
  fillHeight = false,
}: Props) {
  const [pendingGameType, setPendingGameType] = useState<AnyGameType | null>(null);
  const [pendingCallingStyle, setPendingCallingStyle] = useState<CallingStyle | null>(null);
  const displayGameType = pendingGameType ?? gameType;
  const displayCallingStyle = pendingCallingStyle ?? callingStyle;

  useEffect(() => {
    if (pendingGameType !== null && pendingGameType === gameType) setPendingGameType(null);
  }, [gameType, pendingGameType]);

  useEffect(() => {
    if (pendingCallingStyle !== null && pendingCallingStyle === callingStyle) {
      setPendingCallingStyle(null);
    }
  }, [callingStyle, pendingCallingStyle]);

  const [pendingCalls, setPendingCalls] = useState<Set<number>>(() => new Set());
  const calledSet = useMemo(() => {
    const next = new Set(called);
    pendingCalls.forEach((n) => next.add(n));
    return next;
  }, [called, pendingCalls]);
  const radioFocus = `0 0 0 2px ${rgbaFromHex(letterColors.N, 0.35)}`;

  useEffect(() => {
    setPendingCalls((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<number>();
      let changed = false;
      prev.forEach((n) => {
        if (called.includes(n)) changed = true;
        else next.add(n);
      });
      if (called.length === 0 && prev.size > 0) return new Set();
      return changed ? next : prev;
    });
  }, [called]);

  const handleGameType = (v: AnyGameType) => {
    if (v === gameType) return;
    setPendingGameType(v);
    void api.setGameType(v).catch((e: unknown) => {
      setPendingGameType(null);
      if (isBoardAuthHttpError(e)) {
        window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
      }
      onRefresh({ force: true });
    });
  };

  const handleCallingStyle = (v: string) => {
    const cs = v as CallingStyle;
    if (cs === callingStyle) return;
    setPendingCallingStyle(cs);
    void api.setCallingStyle(cs).catch((e: unknown) => {
      setPendingCallingStyle(null);
      if (isBoardAuthHttpError(e)) {
        window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
      }
      onRefresh({ force: true });
    });
  };

  const handleCallNumber = (n: number) => {
    if (calledSet.has(n)) return;
    setPendingCalls((prev) => {
      const next = new Set(prev);
      next.add(n);
      return next;
    });
    onApplyOptimistic?.((prev) => {
      if (prev.called.includes(n)) return prev;
      const nextCalled = [...prev.called, n];
      return {
        ...prev,
        called: nextCalled,
        current: n,
        remaining: Math.max(0, prev.remaining - 1),
        gameEstablished: true,
      };
    });
    onAnnounceCallNumber?.(n);
    void api.callNumber(n).then(
      (next) => {
        onApplyServerState?.(next);
      },
      (e: unknown) => {
        setPendingCalls((prev) => {
          const next = new Set(prev);
          next.delete(n);
          return next;
        });
        if (isBoardAuthHttpError(e)) {
          window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
        }
        onRefresh({ force: true });
      }
    );
  };

  return (
    <div className={cn("space-y-5", fillHeight && "flex min-h-0 flex-1 flex-col space-y-0")}>
      {!gameEstablished && (
        <div className={cn(fillHeight && "flex min-h-0 flex-1 flex-col")}>
          <Label className="mb-2 block shrink-0 text-muted-foreground">Game type</Label>
          <GameTypePicker
            value={displayGameType}
            onChange={handleGameType}
            letterColors={letterColors}
            idPrefix="setup-gt"
            fillHeight={fillHeight}
          />
        </div>
      )}

      {!gameEstablished && (
        <div className={cn(fillHeight && "mt-5 shrink-0")}>
          <Label className="mb-2 block text-muted-foreground">Calling style</Label>
          <RadioGroup value={displayCallingStyle} onValueChange={handleCallingStyle} className="grid grid-cols-2 gap-2">
            <Label
              htmlFor="cs-auto"
              className={cn(
                "flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer text-sm transition-colors",
                displayCallingStyle === "automatic" ? "" : "border-border"
              )}
              style={
                displayCallingStyle === "automatic"
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
                displayCallingStyle === "manual" ? "" : "border-border"
              )}
              style={
                displayCallingStyle === "manual"
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
                  <div
                    className={cn(
                      "flex-shrink-0 w-9 h-8 md:w-10 md:h-9 rounded-md flex items-center justify-center text-xs md:text-sm font-semibold",
                      allCalled ? "bg-muted text-muted-foreground" : "text-white"
                    )}
                    style={allCalled ? undefined : { backgroundColor: letterColors[letter] }}
                  >
                    {letter}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {numbers.map((n) => {
                      const isCalled = calledSet.has(n);
                      return (
                        <button
                          key={n}
                          disabled={isCalled}
                          onPointerDown={() => onPrefetchCallNumber?.(n)}
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
