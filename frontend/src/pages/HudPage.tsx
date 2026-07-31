import { useEffect, useState } from "react";
import { CurrentNumber } from "@/components/CurrentNumber";
import { CallHistory } from "@/components/CallHistory";
import { GameTypeIndicator } from "@/components/GameTypeIndicator";
import { NumberGifOverlay } from "@/components/NumberGifOverlay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { GameState } from "@/types";
import type { LetterColors } from "@/lib/bingo-ui-colors";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

const HUD_SIDE_PANEL_KEY = "bingo-hud-side-panel";

function readSidePanelOpen(): boolean {
  if (typeof window === "undefined") return true;
  const raw = localStorage.getItem(HUD_SIDE_PANEL_KEY);
  if (raw === null) return true;
  return raw !== "0" && raw !== "false";
}

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
  const [sidePanelOpen, setSidePanelOpen] = useState(readSidePanelOpen);

  useEffect(() => {
    if (!gifsOn || !gifUrl || current < 1) {
      setOverlayVisible(false);
      return;
    }
    setOverlayVisible(true);
    const id = window.setTimeout(() => setOverlayVisible(false), GIF_DISPLAY_MS);
    return () => window.clearTimeout(id);
  }, [gifsOn, gifUrl, current]);

  useEffect(() => {
    localStorage.setItem(HUD_SIDE_PANEL_KEY, sidePanelOpen ? "1" : "0");
  }, [sidePanelOpen]);

  return (
    <div className="relative h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden">
      <div
        className={cn(
          "grid h-full min-h-0 gap-3 p-3",
          sidePanelOpen ? "grid-cols-[3fr_1fr]" : "grid-cols-1"
        )}
      >
        <div className="relative min-h-0 min-w-0">
          <CurrentNumber
            current={state.current}
            remaining={state.remaining}
            letterColors={letterColors}
            hud
            className="h-full min-h-0"
          />
          <button
            type="button"
            className="absolute right-3 top-3 z-10 h-9 w-9 rounded-md border bg-background/80 text-muted-foreground shadow-sm backdrop-blur inline-flex items-center justify-center transition-colors hover:bg-accent hover:text-foreground"
            aria-label={sidePanelOpen ? "Hide game type and call history" : "Show game type and call history"}
            aria-pressed={sidePanelOpen}
            title={sidePanelOpen ? "Hide side panel" : "Show side panel"}
            onClick={() => setSidePanelOpen((open) => !open)}
          >
            {sidePanelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        </div>
        {sidePanelOpen ? (
          <div className="grid min-h-0 min-w-0 grid-rows-2 gap-3">
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
        ) : null}
      </div>
      <NumberGifOverlay url={gifUrl} number={current} visible={overlayVisible} />
    </div>
  );
}
