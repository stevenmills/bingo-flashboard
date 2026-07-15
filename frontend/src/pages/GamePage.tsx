import { useState, useRef, useEffect } from "react";
import { CurrentNumber } from "@/components/CurrentNumber";
import { Flashboard } from "@/components/Flashboard";
import { GameControls } from "@/components/GameControls";
import { GameSetup } from "@/components/GameSetup";
import { GameTypeIndicator } from "@/components/GameTypeIndicator";
import { CallHistory } from "@/components/CallHistory";
import { NewGameDialog } from "@/components/NewGameDialog";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Undo2 } from "lucide-react";
import { api } from "@/api";
import { isBoardAuthHttpError } from "@/lib/board-auth";
import { optimisticResetState } from "@/lib/game-state-merge";
import { cn } from "@/lib/utils";
import type { RefreshOptions } from "@/hooks/useGameState";
import type { GameState } from "@/types";
import type { LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  state: GameState;
  onRefresh: (options?: RefreshOptions) => void;
  onApplyOptimistic?: (updater: (prev: GameState) => GameState) => void;
  onApplyServerState?: (state: GameState) => void;
  onPrefetchCallNumber?: (n: number) => void;
  onAnnounceCallNumber?: (n: number) => void;
  onWinnerDialogActiveChange?: (active: boolean) => void;
  onSuppressAutoRestore?: () => void;
  uiLetterColors: LetterColors;
  stateHydrated: boolean;
}

export function GamePage({
  state,
  onRefresh,
  onApplyOptimistic,
  onApplyServerState,
  onPrefetchCallNumber,
  onAnnounceCallNumber,
  onWinnerDialogActiveChange,
  onSuppressAutoRestore,
  uiLetterColors,
  stateHydrated,
}: Props) {
  // Local flag to transition to the active view before the first number
  // is actually called (which sets gameEstablished on the backend).
  const [localStarted, setLocalStarted] = useState(false);
  const prevEstablished = useRef(state.gameEstablished);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  const gameActive = state.gameEstablished || localStarted;

  // Reset local flag only when the backend actually resets
  // (gameEstablished transitions from true → false)
  useEffect(() => {
    if (prevEstablished.current && !state.gameEstablished) {
      setLocalStarted(false);
    }
    prevEstablished.current = state.gameEstablished;
  }, [state.gameEstablished]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const handleStartGame = () => {
    onApplyOptimistic?.((prev) => optimisticResetState(prev));
    setLocalStarted(true);
    void api.reset().then(
      () => onRefresh({ force: true }),
      (error: unknown) => {
        if (isBoardAuthHttpError(error)) {
          window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
        }
        onRefresh({ force: true });
      }
    );
  };

  const handleResetComplete = () => {
    setLocalStarted(false);
  };

  const handleUndo = () => {
    onApplyOptimistic?.((prev) => {
      if (prev.called.length === 0) return prev;
      const nextCalled = prev.called.slice(0, -1);
      return {
        ...prev,
        called: nextCalled,
        current: nextCalled[nextCalled.length - 1] ?? 0,
        remaining: Math.min(75, prev.remaining + 1),
      };
    });
    void api.undo().catch(() => onRefresh());
  };

  return (
    <>
      {/* New game modal — shown when no active game */}
      <NewGameDialog
        open={stateHydrated && !gameActive}
        state={state}
        onStart={handleStartGame}
        onRefresh={onRefresh}
        onApplyOptimistic={onApplyOptimistic}
        letterColors={uiLetterColors}
      />

      {/* Game layout — always rendered */}
      <div className="grid grid-cols-2 md:grid-cols-1 gap-4 md:gap-6">
        {/* Mobile top row: current number (left), controls (right) */}
        <div className="col-span-1 md:hidden">
          <CurrentNumber
            current={state.current}
            remaining={state.remaining}
            letterColors={uiLetterColors}
            compact
            className="h-full"
          />
        </div>
        {!isDesktop && (
        <div className="col-span-1">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Controls</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <GameControls
                callingStyle={state.callingStyle}
                gameStyle={state.gameStyle ?? "bingo"}
                gameType={state.gameType}
                called={state.called}
                remaining={state.remaining}
                winnerDeclared={state.winnerDeclared}
                winnerEventId={state.winnerEventId}
                winnerCount={state.winnerCount}
                survivorCount={state.survivorCount}
                eliminatedCount={state.eliminatedCount}
                onRefresh={onRefresh}
                onApplyOptimistic={onApplyOptimistic}
                onApplyServerState={onApplyServerState}
                onResetComplete={handleResetComplete}
                onWinnerDialogActiveChange={onWinnerDialogActiveChange}
                onSuppressAutoRestore={onSuppressAutoRestore}
                onAnnounceCallNumber={onAnnounceCallNumber}
                letterColors={uiLetterColors}
              />
            </CardContent>
          </Card>
        </div>
        )}

        {/* Desktop current number */}
        <div className="hidden md:block md:order-1">
          <CurrentNumber current={state.current} remaining={state.remaining} letterColors={uiLetterColors} />
        </div>

        {/* Full row board values */}
        <div className="col-span-2 md:order-2 flex flex-col md:flex-row gap-4 items-stretch">
          <Card className="w-full md:flex-1 md:min-w-0">
            <CardHeader>
              <CardTitle>Board</CardTitle>
            </CardHeader>
            <CardContent>
              <Flashboard called={state.called} current={state.current} letterColors={uiLetterColors} />
            </CardContent>
          </Card>
          <Card className="w-full portrait:block landscape:hidden md:block md:w-auto md:flex-shrink-0">
            <CardContent className="pt-6 px-4 flex items-center justify-center md:justify-start">
              <GameTypeIndicator gameType={state.gameType} patternIndex={state.patternIndex} letterColors={uiLetterColors} gameStyle={state.gameStyle ?? "bingo"} />
            </CardContent>
          </Card>
        </div>

        {/* Desktop controls row */}
        {isDesktop && (
        <div className="md:order-3">
          <GameControls
            callingStyle={state.callingStyle}
            gameStyle={state.gameStyle ?? "bingo"}
            gameType={state.gameType}
            called={state.called}
            remaining={state.remaining}
            winnerDeclared={state.winnerDeclared}
            winnerEventId={state.winnerEventId}
            winnerCount={state.winnerCount}
            survivorCount={state.survivorCount}
            eliminatedCount={state.eliminatedCount}
            onRefresh={onRefresh}
            onApplyOptimistic={onApplyOptimistic}
            onApplyServerState={onApplyServerState}
            onResetComplete={handleResetComplete}
            onWinnerDialogActiveChange={onWinnerDialogActiveChange}
            onSuppressAutoRestore={onSuppressAutoRestore}
            onAnnounceCallNumber={onAnnounceCallNumber}
            letterColors={uiLetterColors}
          />
        </div>
        )}

        {/* Mobile landscape only: game type + history split 1/2 : 1/2 */}
        <div className="hidden landscape:grid md:hidden col-span-2 grid-cols-2 gap-4">
          <Card className="col-span-1">
            <CardContent className="pt-6 px-4 flex items-center justify-center">
              <GameTypeIndicator gameType={state.gameType} patternIndex={state.patternIndex} letterColors={uiLetterColors} gameStyle={state.gameStyle ?? "bingo"} />
            </CardContent>
          </Card>
          <Card className="col-span-1">
            <CardHeader className="pb-1">
              <CardTitle>Call history</CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <CallHistory called={state.called} letterColors={uiLetterColors} />
            </CardContent>
          </Card>
        </div>

        {/* Manual call panel (during active game) + Call history */}
        <div className={cn("col-span-2 md:order-4", state.callingStyle === "manual" && gameActive ? "grid md:grid-cols-5 gap-4" : "")}>
          {state.callingStyle === "manual" && gameActive && (
            <Card className="md:col-span-3">
              <CardHeader className="pb-1">
                <CardTitle>Call a number</CardTitle>
              </CardHeader>
              <CardContent className="pt-1">
                <GameSetup
                  gameStyle={state.gameStyle ?? "bingo"}
                  gameType={state.gameType}
                  callingStyle={state.callingStyle}
                  gameEstablished={gameActive}
                  called={state.called}
                  letterColors={uiLetterColors}
                  onRefresh={onRefresh}
                  onApplyOptimistic={onApplyOptimistic}
                  onApplyServerState={onApplyServerState}
                  onPrefetchCallNumber={onPrefetchCallNumber}
                  onAnnounceCallNumber={onAnnounceCallNumber}
                />
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleUndo}
                    disabled={state.called.length === 0}
                    className="h-8 w-8 text-muted-foreground"
                    aria-label="Undo last called number"
                    title="Undo last call"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className={cn(
            state.callingStyle === "manual" && gameActive ? "md:col-span-2" : "",
            "portrait:block landscape:hidden md:block"
          )}>
            <CardHeader className="pb-1">
              <CardTitle>Call history</CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <CallHistory called={state.called} letterColors={uiLetterColors} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
