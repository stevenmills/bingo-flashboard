import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import { CurrentNumber } from "@/components/CurrentNumber";
import { Flashboard } from "@/components/Flashboard";
import { GameControls } from "@/components/GameControls";
import { GameSetup } from "@/components/GameSetup";
import { GameTypeIndicator } from "@/components/GameTypeIndicator";
import { CallHistory } from "@/components/CallHistory";
import { NewGameDialog } from "@/components/NewGameDialog";
import { ResetDialog } from "@/components/ResetDialog";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Play, RotateCcw, Undo2 } from "lucide-react";
import { api } from "@/api";
import { isBoardAuthHttpError } from "@/lib/board-auth";
import { optimisticResetState } from "@/lib/game-state-merge";
import { cn } from "@/lib/utils";
import type { RefreshOptions } from "@/hooks/useGameState";
import type { GameState } from "@/types";
import type { LetterColors } from "@/lib/bingo-ui-colors";

/** Tailwind `md` — only mount controls once (CSS hide still mounts two dialog hosts). */
function useMdUp() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia("(min-width: 768px)");
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => false
  );
}

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
  /** When false, hold NewGameDialog so it does not race a closing unlock dialog. */
  allowNewGameDialog?: boolean;
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
  allowNewGameDialog = true,
}: Props) {
  const [localStarted, setLocalStarted] = useState(false);
  const [newGameDismissed, setNewGameDismissed] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const prevEstablished = useRef(state.gameEstablished);
  const mdUp = useMdUp();

  const gameActive = state.gameEstablished || localStarted;
  const newGameOpen =
    allowNewGameDialog && stateHydrated && !gameActive && !newGameDismissed;
  const showPreGameControls = stateHydrated && !gameActive && newGameDismissed;

  // Reset local flag only when the backend actually resets
  // (gameEstablished transitions from true → false)
  useEffect(() => {
    if (prevEstablished.current && !state.gameEstablished) {
      setLocalStarted(false);
      setNewGameDismissed(false);
    }
    prevEstablished.current = state.gameEstablished;
  }, [state.gameEstablished]);

  const handleStartGame = () => {
    onApplyOptimistic?.((prev) => optimisticResetState(prev));
    setLocalStarted(true);
    setNewGameDismissed(false);
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
    setNewGameDismissed(false);
  };

  const handleReset = async () => {
    try {
      await api.reset();
      setResetOpen(false);
      handleResetComplete();
      onRefresh({ force: true });
    } catch (e: unknown) {
      if (isBoardAuthHttpError(e)) {
        window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
      }
      onRefresh({ force: true });
    }
  };

  const requestReset = () => {
    if (state.called.length === 0) {
      void handleReset();
      return;
    }
    setResetOpen(true);
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

  const gameControls = (
    <GameControls
      callingStyle={state.callingStyle}
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
  );

  const preGameControls = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Button
        size="lg"
        className="text-white"
        style={{ backgroundColor: uiLetterColors.N }}
        onClick={() => setNewGameDismissed(false)}
      >
        <Play className="mr-2 h-5 w-5" />
        New game
      </Button>
      <Button size="lg" variant="outline" onClick={requestReset}>
        <RotateCcw className="mr-2 h-5 w-5" />
        Reset
      </Button>
    </div>
  );

  const controls = showPreGameControls ? preGameControls : gameControls;

  return (
    <>
      <NewGameDialog
        open={newGameOpen}
        onOpenChange={(open) => {
          if (!open) setNewGameDismissed(true);
          else setNewGameDismissed(false);
        }}
        state={state}
        onStart={handleStartGame}
        onRefresh={onRefresh}
        onApplyOptimistic={onApplyOptimistic}
        letterColors={uiLetterColors}
      />
      <ResetDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        onConfirm={handleReset}
        letterColors={uiLetterColors}
      />

      <div className="flex flex-col gap-4">
        {/* Mobile: current number + controls (single GameControls mount — see desktop below) */}
        {!mdUp && (
          <div className="grid grid-cols-2 gap-4">
            <CurrentNumber
              current={state.current}
              remaining={state.remaining}
              letterColors={uiLetterColors}
              compact
              className="h-full"
            />
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Controls</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">{controls}</CardContent>
            </Card>
          </div>
        )}

        {/* Desktop: current number banner (full width) */}
        {mdUp && (
          <div className="w-full">
            <CurrentNumber
              current={state.current}
              remaining={state.remaining}
              letterColors={uiLetterColors}
            />
          </div>
        )}

        {/* Board + pattern preview */}
        <div className="flex w-full flex-col gap-4 md:flex-row md:items-stretch">
          <Card className="w-full md:min-w-0 md:flex-1">
            <CardHeader>
              <CardTitle>Board</CardTitle>
            </CardHeader>
            <CardContent>
              <Flashboard
                called={state.called}
                current={state.current}
                letterColors={uiLetterColors}
                sinkMode={state.gameType === "battleship"}
              />
            </CardContent>
          </Card>
          <Card className="hidden w-full shrink-0 md:block md:w-auto">
            <CardContent className="flex items-center justify-center px-4 pt-6 md:justify-start">
              <GameTypeIndicator
                gameType={state.gameType}
                patternIndex={state.patternIndex}
                letterColors={uiLetterColors}
              />
            </CardContent>
          </Card>
          {/* Portrait phones: pattern under the board */}
          <Card className="hidden w-full max-md:portrait:block">
            <CardContent className="flex items-center justify-center px-4 pt-6">
              <GameTypeIndicator
                gameType={state.gameType}
                patternIndex={state.patternIndex}
                letterColors={uiLetterColors}
              />
            </CardContent>
          </Card>
        </div>

        {/* Desktop controls — mutually exclusive with mobile mount above */}
        {mdUp && <div className="w-full">{controls}</div>}

        {/* Mobile landscape: pattern + call history */}
        <div className="hidden w-full grid-cols-2 gap-4 max-md:landscape:grid">
          <Card>
            <CardContent className="flex items-center justify-center px-4 pt-6">
              <GameTypeIndicator
                gameType={state.gameType}
                patternIndex={state.patternIndex}
                letterColors={uiLetterColors}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle>Call history</CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <CallHistory called={state.called} letterColors={uiLetterColors} />
            </CardContent>
          </Card>
        </div>

        {/* Manual call panel + call history */}
        <div
          className={cn(
            "w-full",
            state.callingStyle === "manual" && gameActive
              ? "grid gap-4 md:grid-cols-5"
              : undefined
          )}
        >
          {state.callingStyle === "manual" && gameActive && (
            <Card className="md:col-span-3">
              <CardHeader className="pb-1">
                <CardTitle>Call a number</CardTitle>
              </CardHeader>
              <CardContent className="pt-1">
                <GameSetup
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

          <Card
            className={cn(
              state.callingStyle === "manual" && gameActive ? "md:col-span-2" : "",
              // Show on desktop always; on phones only in portrait (landscape uses the split row above).
              "hidden max-md:portrait:block md:block"
            )}
          >
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
