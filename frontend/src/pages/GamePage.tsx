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
import type { GameState } from "@/types";
import type { LetterColors } from "@/lib/bingo-ui-colors";

interface Props {
  state: GameState;
  onRefresh: () => void;
  uiLetterColors: LetterColors;
}

export function GamePage({ state, onRefresh, uiLetterColors }: Props) {
  // Local flag to transition to the active view before the first number
  // is actually called (which sets gameEstablished on the backend).
  const [localStarted, setLocalStarted] = useState(false);
  const prevEstablished = useRef(state.gameEstablished);

  const gameActive = state.gameEstablished || localStarted;

  // Reset local flag only when the backend actually resets
  // (gameEstablished transitions from true → false)
  useEffect(() => {
    if (prevEstablished.current && !state.gameEstablished) {
      setLocalStarted(false);
    }
    prevEstablished.current = state.gameEstablished;
  }, [state.gameEstablished]);

  const handleStartGame = () => {
    setLocalStarted(true);
  };

  const handleResetComplete = () => {
    setLocalStarted(false);
  };

  const handleUndo = async () => {
    try {
      await api.undo();
    } finally {
      onRefresh();
    }
  };

  return (
    <>
      {/* New game modal — shown when no active game */}
      <NewGameDialog
        open={!gameActive}
        state={state}
        onStart={handleStartGame}
        onRefresh={onRefresh}
        letterColors={uiLetterColors}
      />

      {/* Game layout — always rendered */}
      <div className="space-y-6">
        {/* Current number */}
        <CurrentNumber current={state.current} remaining={state.remaining} letterColors={uiLetterColors} />

        {/* Flashboard + Game type indicator */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch">
          <Card className="w-full md:flex-1 md:min-w-0">
            <CardHeader>
              <CardTitle>Board</CardTitle>
            </CardHeader>
            <CardContent>
              <Flashboard called={state.called} current={state.current} letterColors={uiLetterColors} />
            </CardContent>
          </Card>
          <Card className="w-full md:w-auto md:flex-shrink-0">
            <CardContent className="pt-6 px-4 flex items-center justify-center md:justify-start">
              <GameTypeIndicator gameType={state.gameType} patternIndex={state.patternIndex} letterColors={uiLetterColors} />
            </CardContent>
          </Card>
        </div>

        {/* Controls */}
        <GameControls
          callingStyle={state.callingStyle}
          gameType={state.gameType}
          called={state.called}
          remaining={state.remaining}
          winnerDeclared={state.winnerDeclared}
          winnerEventId={state.winnerEventId}
          winnerCount={state.winnerCount}
          onRefresh={onRefresh}
          onResetComplete={handleResetComplete}
          letterColors={uiLetterColors}
        />

        {/* Manual call panel (during active game) + Call history */}
        <div className={state.callingStyle === "manual" && gameActive ? "grid md:grid-cols-5 gap-4" : ""}>
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

          <Card className={state.callingStyle === "manual" && gameActive ? "md:col-span-2" : ""}>
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
