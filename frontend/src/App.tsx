import { useCallback, useEffect, useRef, useState } from "react";
import { useGameState } from "@/hooks/useGameState";
import { GamePage } from "@/pages/GamePage";
import { CardPage } from "@/pages/CardPage";
import { OddsDrawer } from "@/components/OddsDrawer";
import { ModeChooser } from "@/components/ModeChooser";
import { Settings } from "@/components/Settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Dices, Laugh, Lock, LogOut, Maximize2, Menu, Minimize2, Moon, Pause, PawPrint, Play, Settings2, Sun, Volume2, VolumeX, X } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/hooks/useTheme";
import { useBingoUiColors } from "@/hooks/useBingoUiColors";
import { useCallerSpeech } from "@/hooks/useCallerSpeech";
import { AutoCallingProgressBar } from "@/components/AutoCallingProgressBar";
import { useBoardAuth } from "@/hooks/useBoardAuth";
import { notifyAppModeChanged, notifyCardSessionChanged } from "@/lib/card-session-events";
import { isBoardAuthHttpError, isStoredBoardSessionActive } from "@/lib/board-auth";
import { api } from "@/api";
import { Input } from "@/components/ui/input";
import { rgbaFromHex } from "@/lib/bingo-ui-colors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { AppMode, GameType } from "@/types";
import { isGameType } from "@/types";
import { bootstrapQrCardClaim, clearQrBoardVerifyFlag, isQrBoardVerifyPending, takeQrCardClaim } from "@/lib/bingo-card-codec";

const APP_MODE_STORAGE_KEY = "bingo-app-mode";
// QR scan: unauthenticated → card mode; authenticated board session → board verify.
const qrClaimRoute = bootstrapQrCardClaim(APP_MODE_STORAGE_KEY);

function readInitialAppMode(): AppMode {
  const saved = sessionStorage.getItem(APP_MODE_STORAGE_KEY);
  if (saved === "board" || saved === "card") return saved;
  return "board";
}

function readModeInitialized(): boolean {
  const saved = sessionStorage.getItem(APP_MODE_STORAGE_KEY);
  return saved === "board" || saved === "card";
}

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
  // Initialize from storage after QR bootstrap so card claims never flash board+PIN.
  const [modeInitialized, setModeInitialized] = useState(readModeInitialized);
  const [appMode, setAppMode] = useState<AppMode>(readInitialAppMode);
  const { state, connected, refresh, applyOptimistic, applyServerState, hydrated } = useGameState();
  const {
    boardAuthActive,
    unlockOpen,
    setUnlockOpen,
    unlockPin,
    setUnlockPin,
    unlockError,
    setUnlockError,
    pendingMode,
    setPendingMode,
    requestUnlock,
    unlockWithPin,
    clearSession,
    clearSessionForModeExit,
    tryRefreshSession,
  } = useBoardAuth();
  const {
    activeTheme: uiColorTheme,
    customColors: uiCustomColors,
    effectiveColors: uiLetterColors,
    setActiveTheme: setUiColorTheme,
    setCustomColor: setUiCustomColor,
  } = useBingoUiColors();
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [cardOddsGameType, setCardOddsGameType] = useState<GameType>("traditional");
  const [cardAutoSyncEnabled, setCardAutoSyncEnabled] = useState<boolean>(() => readStoredAutoSync());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => isFullscreenNow());
  const [secondsDraft, setSecondsDraft] = useState<string>("10");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const autoCallingBeforeWinnerRef = useRef<boolean | null>(null);
  const suppressAutoRestoreRef = useRef(false);
  const autoRunningRef = useRef(false);
  const [winnerDialogActive, setWinnerDialogActive] = useState(false);
  const [noWinnerOpen, setNoWinnerOpen] = useState(false);
  const [cardNotAuthenticOpen, setCardNotAuthenticOpen] = useState(false);
  const boardQrVerifyStartedRef = useRef(false);
  const { theme, setTheme } = useTheme(appMode);
  const canOpenSettings = appMode !== "board" || boardAuthActive;
  const [cardJoined, setCardJoined] = useState(() => Boolean(localStorage.getItem("bingo-card-id")));
  const allowOddsGameTypeSelect = modeInitialized && appMode === "card" && (!cardJoined || !connected);
  const oddsGameType: GameType = allowOddsGameTypeSelect
    ? cardOddsGameType
    : isGameType(state.gameType)
      ? state.gameType
      : "cover_all";

  const showAutoControls =
    modeInitialized && appMode === "board" && boardAuthActive && state.callingStyle === "automatic";

  const callerSpeechActive =
    modeInitialized && appMode === "board" && boardAuthActive && connected;
  const {
    speechOn,
    jokesOn,
    speechUnlocked,
    speechSupported,
    speechRate,
    setSpeechRate,
    callerVoice,
    setCallerVoice,
    toggleSpeech,
    toggleJokes,
    isAudioHoldActive,
    prefetchNumberClip,
    announceNumberNow,
  } = useCallerSpeech({
    active: callerSpeechActive,
    called: state.called,
    winnerDeclared: state.winnerDeclared,
    hydrated,
    autoCallingEnabled: Boolean(state.autoCallingEnabled),
  });
  const showCallerSpeechControl =
    modeInitialized && appMode === "board" && boardAuthActive && speechSupported;
  const callerSpeechLive = speechOn && speechUnlocked;
  const callerSpeechLabel = !speechOn
    ? "Unmute number caller"
    : !speechUnlocked
      ? "Tap to enable caller sound"
      : "Mute number caller";
  const callerSpeechMenuLabel = !speechOn
    ? "Unmute caller"
    : !speechUnlocked
      ? "Enable caller sound"
      : "Mute caller";
  const jokesEnabled = callerSpeechLive;
  const jokesLabel = !jokesEnabled
    ? "Enable caller sound first"
    : jokesOn
      ? "Turn jokes off"
      : "Turn jokes on";
  const jokesMenuLabel = !jokesEnabled
    ? "Enable caller first"
    : jokesOn
      ? "Jokes off"
      : "Jokes on";

  useEffect(() => {
    const savedMode = sessionStorage.getItem(APP_MODE_STORAGE_KEY);
    if (savedMode === "board" || savedMode === "card") {
      setAppMode(savedMode);
      setModeInitialized(true);
      // Card / player QR claims must never open the PIN unlock dialog.
      if (savedMode === "card" || qrClaimRoute === "card") {
        setUnlockOpen(false);
        setPendingMode(null);
        return;
      }
      if (savedMode === "board" && !isStoredBoardSessionActive()) {
        requestUnlock("board");
      }
      return;
    }
    setModeInitialized(false);
  }, [requestUnlock, setUnlockOpen, setPendingMode]);

  useEffect(() => {
    if (appMode === "card") {
      setUnlockOpen(false);
      setPendingMode(null);
    }
  }, [appMode, setUnlockOpen, setPendingMode]);

  useEffect(() => {
    if (appMode === "board" && settingsOpen && !boardAuthActive) {
      setSettingsOpen(false);
    }
  }, [appMode, settingsOpen, boardAuthActive]);

  useEffect(() => {
    if (!modeInitialized || appMode !== "board") return;
    if (boardAuthActive || unlockOpen) return;
    // Don't PIN-gate a player QR claim that was forced into card mode.
    if (qrClaimRoute === "card") return;
    requestUnlock("board");
  }, [modeInitialized, appMode, boardAuthActive, unlockOpen, requestUnlock]);

  useEffect(() => {
    if (!modeInitialized || appMode !== "board" || !boardAuthActive || !connected) return;
    if (state.boardAuthValid !== false) return;
    void tryRefreshSession();
  }, [modeInitialized, appMode, boardAuthActive, connected, state.boardAuthValid, tryRefreshSession]);

  useEffect(() => {
    if (!modeInitialized || appMode !== "board" || !boardAuthActive || !connected || !hydrated) return;
    if (!isQrBoardVerifyPending()) return;
    if (boardQrVerifyStartedRef.current) return;
    boardQrVerifyStartedRef.current = true;

    const claim = takeQrCardClaim();
    clearQrBoardVerifyFlag();
    if (!claim) {
      boardQrVerifyStartedRef.current = false;
      return;
    }

    void (async () => {
      try {
        const result = await api.claimPrintedCard(claim.numbers, claim.sig);
        if (result.authentic !== true) {
          try {
            await api.leaveCard(result.cardId);
          } catch {
            // Best effort.
          }
          await refresh({ force: true });
          setCardNotAuthenticOpen(true);
          return;
        }
        if (result.winner) {
          await refresh({ force: true });
        } else {
          try {
            await api.leaveCard(result.cardId);
          } catch {
            // Best effort.
          }
          await refresh({ force: true });
          setNoWinnerOpen(true);
        }
      } catch {
        setNoWinnerOpen(true);
      } finally {
        boardQrVerifyStartedRef.current = false;
      }
    })();
  }, [modeInitialized, appMode, boardAuthActive, connected, hydrated, refresh]);

  const boardSessionStale =
    modeInitialized &&
    appMode === "board" &&
    boardAuthActive &&
    connected &&
    state.boardAuthValid === false;

  useEffect(() => {
    const syncCardJoined = () => setCardJoined(Boolean(localStorage.getItem("bingo-card-id")));
    window.addEventListener("bingo:card-session-changed", syncCardJoined);
    return () => window.removeEventListener("bingo:card-session-changed", syncCardJoined);
  }, []);

  useEffect(() => {
    if (!cardJoined) return;
    if (isGameType(state.gameType)) setCardOddsGameType(state.gameType);
  }, [state.gameType, cardJoined]);

  useEffect(() => {
    const onCardAutoSyncChanged = (event: Event) => {
      const custom = event as CustomEvent<{ enabled?: boolean }>;
      setCardAutoSyncEnabled(Boolean(custom.detail?.enabled));
    };
    window.addEventListener("bingo:card-auto-sync-changed", onCardAutoSyncChanged as EventListener);
    return () => window.removeEventListener("bingo:card-auto-sync-changed", onCardAutoSyncChanged as EventListener);
  }, []);

  const autoRunning = Boolean(state.autoCallingEnabled);
  const autoSeconds = Math.max(1, Math.min(600, state.autoCallingSeconds ?? 10));

  useEffect(() => {
    autoRunningRef.current = autoRunning;
  }, [autoRunning]);

  const handleWinnerDialogActiveChange = useCallback((active: boolean) => {
    setWinnerDialogActive(active);
    if (active) {
      suppressAutoRestoreRef.current = false;
      if (autoCallingBeforeWinnerRef.current !== null) return;
      const wasRunning = autoRunningRef.current;
      autoCallingBeforeWinnerRef.current = wasRunning;
      if (wasRunning) {
        void api.setAutoCallingEnabled(false).catch((e: unknown) => {
          if (isBoardAuthHttpError(e)) {
            window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
          }
        });
      }
      return;
    }

    const shouldRestore = autoCallingBeforeWinnerRef.current === true;
    autoCallingBeforeWinnerRef.current = null;
    if (shouldRestore && !suppressAutoRestoreRef.current) {
      void api.setAutoCallingEnabled(true).catch((e: unknown) => {
        if (isBoardAuthHttpError(e)) {
          window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
        }
      });
    }
    suppressAutoRestoreRef.current = false;
  }, []);

  const handleSuppressAutoRestore = useCallback(() => {
    suppressAutoRestoreRef.current = true;
  }, []);

  useEffect(() => {
    setSecondsDraft(String(autoSeconds));
  }, [autoSeconds]);

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
      notifyCardSessionChanged();
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
    const clamped = Math.max(1, Math.min(600, parsed));
    setSecondsDraft(String(clamped));
    void api.setAutoCallingSeconds(clamped).catch((e: unknown) => {
      if (isBoardAuthHttpError(e)) {
        window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
      }
      void refresh({ force: true });
    });
  };

  const toggleAuto = () => {
    const next = !autoRunning;
    void api
      .setAutoCallingEnabled(next)
      .then((s) => {
        if (s && typeof s === "object" && "called" in s) {
          applyServerState(s as typeof state);
        } else {
          void refresh({ force: true });
        }
      })
      .catch((e: unknown) => {
        if (isBoardAuthHttpError(e)) {
          window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
        }
        void refresh({ force: true });
      });
  };

  const toggleSettingsPanel = useCallback(() => {
    if (appMode === "board" && !boardAuthActive) {
      setSettingsOpen(false);
      requestUnlock("board");
      return;
    }
    setSettingsOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setOddsOpen(false);
      }
      return nextOpen;
    });
  }, [appMode, boardAuthActive, requestUnlock]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!mobileMenuRef.current) return;
      const target = event.target as Node | null;
      if (target && mobileMenuRef.current.contains(target)) return;
      setMobileMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [mobileMenuOpen]);

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
    notifyAppModeChanged();
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
    requestUnlock("board");
  };

  const handleExitToModeChooser = () => {
    setSettingsOpen(false);
    setOddsOpen(false);
    setModeInitialized(false);
    setExitConfirmOpen(false);
    sessionStorage.removeItem(APP_MODE_STORAGE_KEY);
    void clearSessionForModeExit();
  };

  const handleUnlockBoard = async () => {
    const ok = await unlockWithPin(unlockPin);
    if (!ok) return;
    await refresh({ force: true });
    if (pendingMode === "board") setMode("board");
  };

  const handleBoardLock = async () => {
    try {
      await api.lockBoard();
    } catch {
      // Still clear local session if the board is unreachable.
    }
    clearSession({ promptUnlock: false });
    setMode("card");
  };

  const renderBoardLockedState = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-4 w-4" />
          Board Locked
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Enter the board PIN to unlock board controls and game state.
        </p>
        <Button
          type="button"
          onClick={() => requestUnlock("board")}
          className="text-white"
          style={{ backgroundColor: uiLetterColors.N }}
        >
          Unlock Board
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 relative">
        <div className="max-w-7xl mx-auto px-4 flex h-14 items-center justify-between relative">
          <div className="flex items-center gap-3">
            <PawPrint className="h-6 w-6" style={{ color: uiLetterColors.N }} />
            <h1 className="text-lg font-bold tracking-tight">
              <span className="portrait:inline landscape:hidden md:hidden">Bingo</span>
              <span className="hidden landscape:inline md:inline">Bingo Flashboard</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-1.5">
              {modeInitialized && (appMode !== "board" || boardAuthActive) && (
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
              {modeInitialized && canOpenSettings && (
                <button
                  type="button"
                  className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center justify-center transition-colors"
                  aria-label={settingsOpen ? "Close settings" : "Open settings"}
                  aria-pressed={settingsOpen}
                  title={settingsOpen ? "Close settings" : "Settings"}
                  onClick={toggleSettingsPanel}
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
              {showCallerSpeechControl && (
                <button
                  type="button"
                  className={cn(
                    "h-8 w-8 rounded-md inline-flex items-center justify-center transition-colors",
                    callerSpeechLive
                      ? "text-foreground hover:bg-accent"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent",
                    speechOn && !speechUnlocked && "animate-pulse"
                  )}
                  style={callerSpeechLive ? { color: uiLetterColors.N } : undefined}
                  aria-label={callerSpeechLabel}
                  aria-pressed={callerSpeechLive}
                  title={callerSpeechLabel}
                  onClick={toggleSpeech}
                >
                  {callerSpeechLive ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
              )}
              {showCallerSpeechControl && (
                <button
                  type="button"
                  disabled={!jokesEnabled}
                  className={cn(
                    "h-8 w-8 rounded-md inline-flex items-center justify-center transition-colors",
                    jokesOn
                      ? "text-foreground hover:bg-accent"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent",
                    !jokesEnabled && "opacity-40 cursor-not-allowed hover:bg-transparent"
                  )}
                  style={jokesOn && jokesEnabled ? { color: uiLetterColors.G } : undefined}
                  aria-label={jokesLabel}
                  aria-pressed={jokesOn}
                  title={jokesLabel}
                  onClick={toggleJokes}
                >
                  <Laugh className="h-4 w-4" />
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
            <div className="md:hidden relative" ref={mobileMenuRef}>
              <button
                type="button"
                className={cn(
                  "h-8 w-8 rounded-md inline-flex items-center justify-center transition-colors",
                  settingsOpen
                    ? "text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                style={settingsOpen ? { backgroundColor: uiLetterColors.N } : undefined}
                aria-label={settingsOpen ? "Close settings" : "Open menu"}
                title={settingsOpen ? "Close settings" : "Menu"}
                onClick={() => {
                  if (settingsOpen) {
                    setMobileMenuOpen(false);
                    setSettingsOpen(false);
                    return;
                  }
                  setMobileMenuOpen((open) => !open);
                }}
              >
                {settingsOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
              {mobileMenuOpen && !settingsOpen && (
                <div className="absolute right-0 top-10 z-50 w-52 rounded-md border bg-card text-card-foreground p-1 shadow-md">
                  {modeInitialized && (appMode !== "board" || boardAuthActive) && (
                    <button
                      type="button"
                      className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent inline-flex items-center gap-2"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setExitConfirmOpen(true);
                      }}
                    >
                      <LogOut className="h-3.5 w-3.5 shrink-0" />
                      Exit to mode selection
                    </button>
                  )}
                  {modeInitialized && canOpenSettings && (
                    <button
                      type="button"
                      className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent inline-flex items-center gap-2"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        toggleSettingsPanel();
                      }}
                    >
                      <Settings2 className="h-3.5 w-3.5 shrink-0" />
                      {settingsOpen ? "Hide settings" : "Show settings"}
                    </button>
                  )}
                  {modeInitialized && (appMode !== "board" || boardAuthActive) && (
                    <button
                      type="button"
                      className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent inline-flex items-center gap-2"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setOddsOpen((open) => !open);
                      }}
                    >
                      <Dices className="h-3.5 w-3.5 shrink-0" />
                      {oddsOpen ? "Hide odds" : "Show odds"}
                    </button>
                  )}
                  {showCallerSpeechControl && (
                    <button
                      type="button"
                      className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent inline-flex items-center gap-2"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        toggleSpeech();
                      }}
                    >
                      {callerSpeechLive ? (
                        <Volume2 className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <VolumeX className="h-3.5 w-3.5 shrink-0" />
                      )}
                      {callerSpeechMenuLabel}
                    </button>
                  )}
                  {showCallerSpeechControl && (
                    <button
                      type="button"
                      disabled={!jokesEnabled}
                      className={cn(
                        "w-full rounded-sm px-2 py-1.5 text-left text-sm inline-flex items-center gap-2",
                        jokesEnabled ? "hover:bg-accent" : "opacity-40 cursor-not-allowed"
                      )}
                      onClick={() => {
                        if (!jokesEnabled) return;
                        setMobileMenuOpen(false);
                        toggleJokes();
                      }}
                    >
                      <Laugh className="h-3.5 w-3.5 shrink-0" />
                      {jokesMenuLabel}
                    </button>
                  )}
                  <button
                    type="button"
                    className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent inline-flex items-center gap-2"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      void handleToggleFullscreen();
                    }}
                  >
                    {isFullscreen ? (
                      <Minimize2 className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Maximize2 className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {isFullscreen ? "Exit full screen" : "Enter full screen"}
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent inline-flex items-center gap-2"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setTheme(theme === "dark" ? "light" : "dark");
                    }}
                  >
                    {theme === "dark" ? (
                      <Sun className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Moon className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {theme === "dark" ? "Light mode" : "Dark mode"}
                  </button>
                </div>
              )}
            </div>
            {showAutoControls && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleAuto}
                  disabled={state.remaining === 0 || !connected || state.winnerDeclared || winnerDialogActive}
                  className={cn(
                    "h-8 px-2 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
                    autoRunning
                      ? "text-primary-foreground"
                      : "bg-background hover:bg-accent",
                    (state.remaining === 0 || !connected || state.winnerDeclared || winnerDialogActive) &&
                      "opacity-50 cursor-not-allowed"
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
          <AutoCallingProgressBar
            running={autoRunning}
            intervalSeconds={autoSeconds}
            remainingMs={state.autoCallingRemainingMs ?? 0}
            serverHold={Boolean(state.autoCallingHold)}
            isAudioHold={isAudioHoldActive}
            color={rgbaFromHex(uiLetterColors.N, 0.7)}
          />
        )}
      </header>

      {/* Content */}
      <main
        className={cn(
          "max-w-7xl mx-auto px-4 py-6",
          modeInitialized && (appMode === "board" || appMode === "card") && "pb-16"
        )}
      >
        {boardSessionStale && (
          <div className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
            Board session expired on the flashboard. Unlock with your PIN again — until then, reset and draw
            won&apos;t update the physical LEDs.
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-3 h-7"
              onClick={() => requestUnlock("board")}
            >
              Unlock board
            </Button>
          </div>
        )}
        {!modeInitialized ? (
          <ModeChooser onSelect={requestModeChange} />
        ) : (
          <>
            <div className={cn(settingsOpen && "hidden")} aria-hidden={settingsOpen}>
              {appMode === "board" ? (
                boardAuthActive ? (
                  <GamePage
                    state={state}
                    onRefresh={refresh}
                    onApplyOptimistic={applyOptimistic}
                    onApplyServerState={applyServerState}
                    onPrefetchCallNumber={prefetchNumberClip}
                    onAnnounceCallNumber={announceNumberNow}
                    onWinnerDialogActiveChange={handleWinnerDialogActiveChange}
                    onSuppressAutoRestore={handleSuppressAutoRestore}
                    uiLetterColors={uiLetterColors}
                    stateHydrated={hydrated}
                  />
                ) : (
                  renderBoardLockedState()
                )
              ) : (
                <CardPage
                  state={state}
                  letterColors={uiLetterColors}
                  connected={connected}
                  stateHydrated={hydrated}
                />
              )}
            </div>
            <div className={cn(!settingsOpen && "hidden")} aria-hidden={!settingsOpen}>
              {appMode === "board" && !boardAuthActive ? (
                renderBoardLockedState()
              ) : (
                <Card>
                  <CardHeader className="md:hidden">
                    <CardTitle>Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="md:pt-6">
                    <Settings
                      settingsOpen={settingsOpen}
                      settingsMode={appMode}
                      onClose={() => setSettingsOpen(false)}
                      brightness={state.brightness}
                      ledVibrance={state.ledVibrance}
                      theme={state.theme}
                      colorMode={state.colorMode}
                      staticColor={state.staticColor}
                      ledHeaderColor={state.ledHeaderColor}
                      ledGameTypeColor={state.ledGameTypeColor}
                      screensaverEnabled={state.screensaverEnabled}
                      screensaverType={state.screensaverType}
                      screensaverText={state.screensaverText}
                      screensaverSpeedMs={state.screensaverSpeedMs}
                      screensaverColor={state.screensaverColor}
                      ledLetterColors={state.ledLetterColors}
                      letterFullMode={state.letterFullMode}
                      currentNumberEffect={state.currentNumberEffect}
                      currentNumberColor={state.currentNumberColor}
                      calledNumberBanner={state.calledNumberBanner}
                      winnerEffect={state.winnerEffect}
                      wifiSsid={state.wifiSsid}
                      wifiConfigured={state.wifiConfigured}
                      wifiConnected={state.wifiConnected}
                      wifiMode={state.wifiMode}
                      ledTestMode={state.ledTestMode}
                      boardAuthGranted={boardAuthActive}
                      uiColorTheme={uiColorTheme}
                      uiCustomColors={uiCustomColors}
                      letterColors={uiLetterColors}
                      onUiColorThemeChange={setUiColorTheme}
                      onUiCustomColorChange={setUiCustomColor}
                      callerSpeechRate={speechRate}
                      onCallerSpeechRateChange={setSpeechRate}
                      callerVoice={callerVoice}
                      onCallerVoiceChange={setCallerVoice}
                      onRefresh={refresh}
                      gameStyle={state.gameStyle ?? "bingo"}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </main>
      {(appMode !== "board" || boardAuthActive) && (
        <OddsDrawer
          open={oddsOpen}
          onOpenChange={setOddsOpen}
          gameType={oddsGameType}
          remaining={state.remaining}
          allowGameTypeSelect={allowOddsGameTypeSelect}
          onGameTypeChange={setCardOddsGameType}
        />
      )}
      <Dialog
        open={unlockOpen && appMode === "board"}
        onOpenChange={(open) => {
          if (appMode === "card") {
            setUnlockOpen(false);
            return;
          }
          setUnlockOpen(open);
        }}
      >
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
      <Dialog open={cardNotAuthenticOpen} onOpenChange={setCardNotAuthenticOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invalid Card</DialogTitle>
            <DialogDescription>
              This card is not valid on this device. Its security hash does not match this bingo
              board, so it was not generated here (or the QR was altered).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setCardNotAuthenticOpen(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={noWinnerOpen} onOpenChange={setNoWinnerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No Winner Identified!</DialogTitle>
            <DialogDescription>
              This scanned card is not a bingo for the numbers called and the current game type.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setNoWinnerOpen(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {modeInitialized && appMode === "board" && boardAuthActive && (
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
