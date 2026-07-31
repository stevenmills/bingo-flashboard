import { useEffect, useState } from "react";
import { CurrentNumber } from "@/components/CurrentNumber";
import { CallHistory } from "@/components/CallHistory";
import { GameTypeIndicator } from "@/components/GameTypeIndicator";
import { NumberGifOverlay } from "@/components/NumberGifOverlay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GameState } from "@/types";
import type { LetterColors } from "@/lib/bingo-ui-colors";

/** How long to show a number's GIF after it becomes current (independent of caller audio). */
const GIF_DISPLAY_MS = 4000;

interface Props {
  state: GameState;
  letterColors: LetterColors;
}

export function HudPage({ state, letterColors }: Props) {
  const gifsOn = Boolean(state.gifModeEnabled);
  const gifUrl = (state.currentGifUrl ?? "").trim();
  const current = state.current;
  const [overlayVisible, setOverlayVisible] = useState(false);

  useEffect(() => {
    if (!gifsOn || !gifUrl || current < 1) {
      setOverlayVisible(false);
      return;
    }
    setOverlayVisible(true);
    const id = window.setTimeout(() => setOverlayVisible(false), GIF_DISPLAY_MS);
    return () => window.clearTimeout(id);
  }, [gifsOn, gifUrl, current]);

  return (
    <div className="relative h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden">
      <div className="grid h-full min-h-0 grid-cols-[3fr_1fr] gap-3 p-3">
        <CurrentNumber
          current={state.current}
          remaining={state.remaining}
          letterColors={letterColors}
          hud
          className="min-h-0"
        />
        <div className="grid min-h-0 grid-rows-2 gap-3">
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="shrink-0 space-y-0 pb-1 pt-3 px-3">
              <CardTitle className="text-sm">Game type</CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 pt-0">
              <div className="min-h-0 flex-1 overflow-hidden">
                <GameTypeIndicator
                  gameType={state.gameType}
                  patternIndex={state.patternIndex}
                  letterColors={letterColors}
                  hud
                />
              </div>
              {state.gameType === "battleship" && (
                <p className="mt-2 shrink-0 text-center text-sm sm:text-base text-muted-foreground tabular-nums">
                  Afloat {state.survivorCount ?? 0} · Sunk {state.eliminatedCount ?? 0}
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="shrink-0 space-y-0 pb-1 pt-3 px-3">
              <CardTitle className="text-sm">Call history</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-0">
              <CallHistory called={state.called} letterColors={letterColors} hud />
            </CardContent>
          </Card>
        </div>
      </div>
      <NumberGifOverlay url={gifUrl} number={current} visible={overlayVisible} />
    </div>
  );
}
