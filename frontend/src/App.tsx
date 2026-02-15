import { useCallback, useEffect, useState } from "react";
import { useGameState } from "@/hooks/useGameState";
import { GamePage } from "@/pages/GamePage";
import { CardPage } from "@/pages/CardPage";
import { OddsDrawer } from "@/components/OddsDrawer";
import { ModeChooser } from "@/components/ModeChooser";
import { Settings } from "@/components/Settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Dices, Lock, LogOut, Maximize2, Minimize2, Pause, PawPrint, Play, Settings2 } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useBingoUiColors } from "@/hooks/useBingoUiColors";
import { useAutoCallingTimer } from "@/hooks/useAutoCallingTimer";
import { api } from "@/api";
import { Input } from "@/components/ui/input";
import { rgbaFromHex } from "@/lib/bingo-ui-colors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { AppMode, GameType } from "@/types";

type FullscreenDoc = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitCancelFullScreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitCurrentFullScreenElement?: Element | null;
  mozCancelFullScreen?: () => Promise<void> | void;
  mozFullScreenElement?: Element | null;
  msExitFullscreen?: () => Promise<void> | void;
  msFullscreenElement?: Element | null;
};

type FullscreenEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

function isFullscreenNow(): boolean {
  const doc = document as FullscreenDoc;
  return Boolean(
    doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.webkitCurrentFullScreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
  );
}

const APP_MODE_STORAGE_KEY = "bingo-app-mode";
const BOARD_TOKEN_STORAGE_KEY = "bingo-board-token";
const BOARD_TOKEN_EXPIRY_STORAGE_KEY = "bingo-board-token-expiry";

export default function App() {
  const readStoredAutoSync = () => {
    try {
      const raw = localStorage.getItem("bingo-card-state");
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { autoSync?: boolean };
      return Boolean(parsed.autoSync);
    } catch {
      return false;
    }
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [oddsOpen, setOddsOpen] = useState(false);
  const [modeInitialized, setModeInitialized] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>("board");
  const [pendingMode, setPendingMode] = useState<AppMode | null>(null);
  // Keep state highly responsive during active board/card play even if websocket hiccups.
  const gameStatePollMs = modeInitialized ? 250 : 1500;
  const { state, connected, refresh } = useGameState(gameStatePollMs);
  const {
    activeTheme: uiColorTheme,
    customColors: uiCustomColors,
    effectiveColors: uiLetterColors,
    setActiveTheme: setUiColorTheme,
    setCustomColor: setUiCustomColor,
  } = useBingoUiColors();
  const [boardToken, setBoardToken] = useState<string | null>(null);
  const [boardTokenExpiry, setBoardTokenExpiry] = useState<number>(0);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [cardOddsGameType, setCardOddsGameType] = useState<GameType>("traditional");
  const [cardAutoSyncEnabled, setCardAutoSyncEnabled] = useState<boolean>(() => readStoredAutoSync());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => isFullscreenNow());
  const [secondsDraft, setSecondsDraft] = useState<string>("30");
  const cardJoined = Boolean(localStorage.getItem("bingo-card-id"));
  const allowOddsGameTypeSelect = modeInitialized && appMode === "card" && (!cardJoined || !connected);
  const oddsGameType = allowOddsGameTypeSelect ? cardOddsGameType : state.gameType;

  const showAutoControls =
    modeInitialized && appMode === "board" && !settingsOpen && state.callingStyle === "automatic";

  useEffect(() => {
    const savedMode = sessionStorage.getItem(APP_MODE_STORAGE_KEY);
    if (savedMode === "board" || savedMode === "card") {
      setAppMode(savedMode);
      setModeInitialized(true);
      return;
    }
    setModeInitialized(false);
  }, []);

  useEffect(() => {
    if (!cardJoined) return;
    setCardOddsGameType(state.gameType);
  }, [state.gameType, cardJoined]);

  useEffect(() => {
    const onCardAutoSyncChanged = (event: Event) => {
      const custom = event as CustomEvent<{ enabled?: boolean }>;
      setCardAutoSyncEnabled(Boolean(custom.detail?.enabled));
    };
    window.addEventListener("bingo:card-auto-sync-changed", onCardAutoSyncChanged as EventListener);
    return () => window.removeEventListener("bingo:card-auto-sync-changed", onCardAutoSyncChanged as EventListener);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(BOARD_TOKEN_STORAGE_KEY);
    const expiry = Number.parseInt(localStorage.getItem(BOARD_TOKEN_EXPIRY_STORAGE_KEY) ?? "0", 10);
    if (!token || Number.isNaN(expiry) || expiry <= Date.now()) {
      api.setBoardToken(null);
      localStorage.removeItem(BOARD_TOKEN_STORAGE_KEY);
      localStorage.removeItem(BOARD_TOKEN_EXPIRY_STORAGE_KEY);
      return;
    }
    setBoardToken(token);
    setBoardTokenExpiry(expiry);
    api.setBoardToken(token);
  }, []);

  useEffect(() => {
    if (!boardToken || boardTokenExpiry <= 0) return;
    const id = window.setInterval(() => {
      if (Date.now() < boardTokenExpiry) return;
      setBoardToken(null);
      setBoardTokenExpiry(0);
      api.setBoardToken(null);
      localStorage.removeItem(BOARD_TOKEN_STORAGE_KEY);
      localStorage.removeItem(BOARD_TOKEN_EXPIRY_STORAGE_KEY);
      if (appMode === "board") {
        setPendingMode("board");
        setUnlockError(null);
        setUnlockPin("");
        setUnlockOpen(true);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [boardToken, boardTokenExpiry, appMode]);

  const boardAuthActive = Boolean(
    boardToken &&
      boardTokenExpiry > Date.now() &&
      (
        // Before the first successful state poll, avoid invalidating a stored token preemptively.
        !connected ||
        state.boardAccessRequired === false ||
        state.boardAuthValid !== false
      )
  );

  useEffect(() => {
    // If the server says our board auth is invalid, clear stale local auth so unlock flow can recover.
    if (!connected) return;
    if (!boardToken) return;
    if (state.boardAccessRequired === false) return;
    if (state.boardAuthValid !== false) return;
    setBoardToken(null);
    setBoardTokenExpiry(0);
    api.setBoardToken(null);
    localStorage.removeItem(BOARD_TOKEN_STORAGE_KEY);
    localStorage.removeItem(BOARD_TOKEN_EXPIRY_STORAGE_KEY);
  }, [connected, boardToken, state.boardAccessRequired, state.boardAuthValid]);

  useEffect(() => {
    if (!modeInitialized) return;
    if (appMode !== "board") return;
    if (boardAuthActive) return;
    if (unlockOpen) return;
    const id = window.setTimeout(() => {
      // Debounce board->card ejection so transient auth/state blips don't flip mode.
      if (!modeInitialized) return;
      if (appMode !== "board") return;
      if (boardAuthActive) return;
      if (unlockOpen) return;
      setPendingMode("board");
      setUnlockError(null);
      setUnlockPin("");
      setUnlockOpen(true);
    }, 1500);
    return () => window.clearTimeout(id);
  }, [modeInitialized, appMode, boardAuthActive, unlockOpen]);

  const handleAutoElapsed = useCallback(async (): Promise<boolean> => {
    if (!showAutoControls || state.remaining === 0 || !connected || state.winnerDeclared) return false;
    try {
      await api.draw();
      const fresh = await api.getState();
      await refresh();
      return fresh.remaining > 0;
    } catch {
      await refresh();
      return false;
    }
  }, [showAutoControls, state.remaining, connected, state.winnerDeclared, refresh]);

  const {
    isRunning: autoRunning,
    seconds: autoSeconds,
    progressRemaining,
    setSeconds: setAutoSeconds,
    pause: pauseAuto,
    toggle: toggleAuto,
  } = useAutoCallingTimer({ onElapsed: handleAutoElapsed });

  useEffect(() => {
    setSecondsDraft(String(autoSeconds));
  }, [autoSeconds]);

  useEffect(() => {
    if (!showAutoControls || state.remaining === 0 || !connected || state.winnerDeclared) {
      pauseAuto();
    }
  }, [showAutoControls, state.remaining, connected, state.winnerDeclared, pauseAuto]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(isFullscreenNow());
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange as EventListener);
    document.addEventListener("mozfullscreenchange", onFullscreenChange as EventListener);
    document.addEventListener("MSFullscreenChange", onFullscreenChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange as EventListener);
      document.removeEventListener("mozfullscreenchange", onFullscreenChange as EventListener);
      document.removeEventListener("MSFullscreenChange", onFullscreenChange as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!(modeInitialized && appMode === "board")) return;
    const existingCardId = localStorage.getItem("bingo-card-id");
    if (existingCardId) {
      // Board-mode devices should not keep an active background card session.
      void api.leaveCard(existingCardId).catch(() => {
        // Best effort cleanup only.
      });
      localStorage.removeItem("bingo-card-id");
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Browser-native confirmation for page refresh/close in board mode.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [modeInitialized, appMode]);

  const commitSecondsDraft = () => {
    const parsed = Number.parseInt(secondsDraft, 10);
    if (Number.isNaN(parsed)) {
      setSecondsDraft(String(autoSeconds));
      return;
    }
    setAutoSeconds(parsed);
  };

  const handleToggleFullscreen = async () => {
    try {
      const doc = document as FullscreenDoc;
      const el = document.documentElement as FullscreenEl;
      if (isFullscreenNow()) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.webkitCancelFullScreen) {
          await doc.webkitCancelFullScreen();
        } else if (doc.mozCancelFullScreen) {
          await doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      } else {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        } else if (el.webkitRequestFullScreen) {
          await el.webkitRequestFullScreen();
        } else if (el.mozRequestFullScreen) {
          await el.mozRequestFullScreen();
        } else if (el.msRequestFullscreen) {
          await el.msRequestFullscreen();
        }
      }
    } catch {
      // Ignore browser fullscreen errors (permissions/user gesture issues).
    }
  };

  const setMode = (mode: AppMode) => {
    setAppMode(mode);
    setModeInitialized(true);
    setSettingsOpen(false);
    sessionStorage.setItem(APP_MODE_STORAGE_KEY, mode);
  };

  const requestModeChange = (mode: AppMode) => {
    if (mode === "card") {
      setMode("card");
      return;
    }
    if (boardAuthActive) {
      setMode("board");
      return;
    }
    setPendingMode("board");
    setUnlockError(null);
    setUnlockPin("");
    setUnlockOpen(true);
  };

  const handleExitToModeChooser = () => {
    setSettingsOpen(false);
    setOddsOpen(false);
    setModeInitialized(false);
    setExitConfirmOpen(false);
  };

  const handleUnlockBoard = async () => {
    try {
      const session = await api.unlockBoard(unlockPin.trim());
      await refresh();
      const expiry = Date.now() + session.ttlMs;
      setBoardToken(session.token);
      setBoardTokenExpiry(expiry);
      localStorage.setItem(BOARD_TOKEN_STORAGE_KEY, session.token);
      localStorage.setItem(BOARD_TOKEN_EXPIRY_STORAGE_KEY, String(expiry));
      setUnlockOpen(false);
      setUnlockError(null);
      if (pendingMode === "board") setMode("board");
      setPendingMode(null);
    } catch {
      setUnlockError("Invalid board PIN.");
    }
  };

  const handleBoardLock = async () => {
    await api.lockBoard();
    setBoardToken(null);
    setBoardTokenExpiry(0);
    api.setBoardToken(null);
    localStorage.removeItem(BOARD_TOKEN_STORAGE_KEY);
    localStorage.removeItem(BOARD_TOKEN_EXPIRY_STORAGE_KEY);
    setMode("card");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 relative">
        <div className="max-w-7xl mx-auto px-4 flex h-14 items-center justify-between relative">
          <div className="flex items-center gap-3">
            <PawPrint className="h-6 w-6" style={{ color: uiLetterColors.N }} />
            <h1 className="text-lg font-bold tracking-tight">Bingo Flashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              {modeInitialized && (
                <button
                  type="button"
                  className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center justify-center transition-colors"
                  onClick={() => setExitConfirmOpen(true)}
                  aria-label="Exit to mode selection"
                  title="Exit to mode selection"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )}
              {modeInitialized && (
                <button
                  type="button"
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center",
                    settingsOpen
                      ? "text-white"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                  style={settingsOpen ? { backgroundColor: uiLetterColors.N } : undefined}
                  aria-label="Toggle settings"
                  onClick={() =>
                    setSettingsOpen((open) => {
                      const nextOpen = !open;
                      if (nextOpen) {
                        pauseAuto();
                        setOddsOpen(false);
                      }
                      return nextOpen;
                    })
                  }
                >
                  <Settings2 className="h-4 w-4" />
                </button>
              )}
              {modeInitialized && (
                <button
                  type="button"
                  className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center justify-center transition-colors"
                  aria-label="Toggle odds drawer"
                  title="Odds"
                  onClick={() => setOddsOpen((open) => !open)}
                >
                  <Dices className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center justify-center transition-colors"
                aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
                title={isFullscreen ? "Exit full screen" : "Enter full screen"}
                onClick={handleToggleFullscreen}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
              <ThemeToggle />
            </div>
            {showAutoControls && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleAuto}
                  disabled={state.remaining === 0 || !connected || state.winnerDeclared}
                  className={cn(
                    "h-8 px-2 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
                    autoRunning
                      ? "text-primary-foreground"
                      : "bg-background hover:bg-accent",
                    (state.remaining === 0 || !connected || state.winnerDeclared) && "opacity-50 cursor-not-allowed"
                  )}
                  style={{
                    borderColor: uiLetterColors.N,
                    backgroundColor: autoRunning ? uiLetterColors.N : undefined,
                    color: autoRunning ? "#ffffff" : uiLetterColors.N,
                  }}
                  aria-label={autoRunning ? "Pause automatic calling" : "Play automatic calling"}
                  title={autoRunning ? "Pause automatic calling" : "Play automatic calling"}
                >
                  {autoRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {autoRunning ? "Pause" : "Play"}
                </button>
                <Input
                  type="number"
                  min={1}
                  max={600}
                  step={1}
                  value={secondsDraft}
                  onChange={(e) => setSecondsDraft(e.target.value)}
                  className="h-8 w-16 px-2 text-xs"
                  style={{ borderColor: uiLetterColors.N }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = uiLetterColors.N;
                    e.currentTarget.style.boxShadow = `0 0 0 2px ${rgbaFromHex(uiLetterColors.N, 0.35)}`;
                  }}
                  onBlur={(e) => {
                    commitSecondsDraft();
                    e.currentTarget.style.borderColor = uiLetterColors.N;
                    e.currentTarget.style.boxShadow = "";
                  }}
                  aria-label="Automatic calling interval seconds"
                  title="Automatic calling interval seconds"
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>
            )}
            <div className="relative group">
              <span
                className={cn(
                  "h-2.5 w-2.5 rounded-full block",
                  connected ? "bg-primary" : "bg-destructive"
                )}
                role="status"
                aria-label={connected ? "API connected" : "API offline"}
                tabIndex={0}
              />
              <span className="pointer-events-none absolute right-0 top-full mt-2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {(connected ? "API connected" : "API offline") + " — " + api.getBackendLabel()}
              </span>
            </div>
          </div>
        </div>
        {showAutoControls && autoRunning && (
          <div className="absolute left-0 right-0 top-0 h-0.5 bg-transparent pointer-events-none">
            <div
              className="h-full ml-auto"
              style={{
                width: `${Math.max(0, Math.min(1, progressRemaining)) * 100}%`,
                backgroundColor: rgbaFromHex(uiLetterColors.N, 0.7),
              }}
            />
          </div>
        )}
      </header>

      {/* Content */}
      <main
        className={cn(
          "max-w-7xl mx-auto px-4 py-6",
          modeInitialized && (appMode === "board" || appMode === "card") && "pb-16"
        )}
      >
        {!modeInitialized ? (
          <ModeChooser onSelect={requestModeChange} />
        ) : (
          <>
            <div className={cn(settingsOpen && "hidden")} aria-hidden={settingsOpen}>
              {appMode === "board" ? (
                <GamePage
                  state={state}
                  onRefresh={refresh}
                  uiLetterColors={uiLetterColors}
                />
              ) : (
                <CardPage state={state} letterColors={uiLetterColors} connected={connected} />
              )}
            </div>
            <div className={cn(!settingsOpen && "hidden")} aria-hidden={!settingsOpen}>
              <Card>
                <CardHeader>
                  <CardTitle>Settings</CardTitle>
                </CardHeader>
                <CardContent>
                  <Settings
                    settingsMode={appMode}
                    brightness={state.brightness}
                    theme={state.theme}
                    colorMode={state.colorMode}
                    staticColor={state.staticColor}
                    ledTestMode={state.ledTestMode}
                    boardAuthGranted={boardAuthActive}
                    uiColorTheme={uiColorTheme}
                    uiCustomColors={uiCustomColors}
                    letterColors={uiLetterColors}
                    onUiColorThemeChange={setUiColorTheme}
                    onUiCustomColorChange={setUiCustomColor}
                    onRefresh={refresh}
                  />
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>
      <OddsDrawer
        open={oddsOpen}
        onOpenChange={setOddsOpen}
        gameType={oddsGameType}
        remaining={state.remaining}
        allowGameTypeSelect={allowOddsGameTypeSelect}
        onGameTypeChange={setCardOddsGameType}
      />
      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Board Access
            </DialogTitle>
            <DialogDescription>Enter the board PIN to open Board mode.</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            value={unlockPin}
            onChange={(e) => setUnlockPin(e.target.value)}
            placeholder="Board PIN"
            className="focus-visible:ring-0 focus-visible:ring-offset-0"
            style={{ borderColor: uiLetterColors.N }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = uiLetterColors.N;
              e.currentTarget.style.boxShadow = `0 0 0 2px ${rgbaFromHex(uiLetterColors.N, 0.35)}`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = uiLetterColors.N;
              e.currentTarget.style.boxShadow = "";
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (!unlockPin.trim()) return;
              void handleUnlockBoard();
            }}
          />
          {unlockError && <p className="text-sm text-destructive">{unlockError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlockOpen(false)}>
              Cancel
            </Button>
            <button
              type="button"
              onClick={handleUnlockBoard}
              disabled={!unlockPin.trim()}
              className="inline-flex h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: uiLetterColors.N }}
            >
              Unlock
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exit Current Mode?</DialogTitle>
            <DialogDescription>
              This will close the current view and return to the Board/Card selection screen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExitConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleExitToModeChooser}>Exit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {modeInitialized && appMode === "board" && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="max-w-7xl mx-auto px-4 h-10 flex items-center justify-between text-xs sm:text-sm">
            <span className="text-muted-foreground">
              Players: <span className="font-semibold text-foreground">{state.playerCount ?? 0}</span>
            </span>
            <span />
            <span className="text-muted-foreground">
              Cards: <span className="font-semibold text-foreground">{state.cardCount ?? 0}</span>
            </span>
          </div>
        </div>
      )}
      {modeInitialized && appMode === "card" && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="max-w-7xl mx-auto px-4 h-10 flex items-center justify-between text-xs sm:text-sm">
            <span className="text-muted-foreground">
              Board:{" "}
              <span className="font-semibold text-foreground">
                {cardJoined ? (connected ? "Joined" : "Joined (offline)") : "Not joined"}
              </span>
            </span>
            <span className="text-muted-foreground">
              Cards synced:{" "}
              <span className="font-semibold text-foreground">
                {cardJoined && connected && cardAutoSyncEnabled ? "Yes" : "No"}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
