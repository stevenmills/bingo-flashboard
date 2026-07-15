import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notifyCardSessionChanged } from "@/lib/card-session-events";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link2, RefreshCw } from "lucide-react";
import { LETTERS, type GameState, GAME_TYPE_BY_ID, isGameType } from "@/types";
import type { LetterColors } from "@/lib/bingo-ui-colors";
import {
  CARD_STATE_STORAGE_VERSION,
  generateBingoCard,
  generateHouseyCard,
  gameTypeUsesFreeSpace,
  gridHasWinningPattern,
  gridHasHouseyWinningPattern,
  houseyWinningFlashCells,
  buildAutoSyncedGrid,
  gridToStoredCardState,
  isCellClickableInManual,
  storedCardStateToGrid,
  winningPatterns,
  type CardCell,
  type CardGrid,
  type StoredCardState,
} from "@/lib/card";
import { flatNumbersToGrid, takeQrCardClaim, QR_BOARD_VERIFY_KEY } from "@/lib/bingo-card-codec";
import { isHouseyGameType, type GameStyle } from "@/lib/game-style";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import confetti from "canvas-confetti";

interface Props {
  state: GameState;
  letterColors: LetterColors;
  connected: boolean;
}

const CARD_STATE_STORAGE_KEY = "bingo-card-state";
const CARD_UNJOINED_SELECTIONS_STORAGE_KEY = "bingo-card-unjoined-selections";

interface WsCardStateData {
  cardId: string;
  winner: boolean;
  winnerCount: number;
  winnerEventId?: number;
  marks: boolean[];
}

interface WsMessageEnvelope {
  type?: string;
  data?: unknown;
}

function generateCardForStyle(gameStyle: GameStyle): CardGrid {
  return gameStyle === "housey" ? generateHouseyCard() : generateBingoCard();
}

function loadStoredCardState(gameStyle: GameStyle = "bingo"): { card: CardGrid; autoSync: boolean; gameStyle: GameStyle } {
  try {
    const raw = localStorage.getItem(CARD_STATE_STORAGE_KEY);
    if (!raw) return { card: generateCardForStyle(gameStyle), autoSync: true, gameStyle };
    const parsed = JSON.parse(raw) as StoredCardState;
    if ((parsed.version ?? 1) !== CARD_STATE_STORAGE_VERSION) {
      return { card: generateCardForStyle(gameStyle), autoSync: true, gameStyle };
    }
    const restored = storedCardStateToGrid(parsed);
    if (!restored) return { card: generateCardForStyle(gameStyle), autoSync: true, gameStyle };
    const storedStyle: GameStyle = parsed.gameStyle === "housey" ? "housey" : "bingo";
    // Default on when key was missing from older saved state.
    return { card: restored, autoSync: parsed.autoSync !== false, gameStyle: storedStyle };
  } catch {
    return { card: generateCardForStyle(gameStyle), autoSync: true, gameStyle };
  }
}

function loadUnjoinedSelections(): boolean[] | null {
  try {
    const raw = localStorage.getItem(CARD_UNJOINED_SELECTIONS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 25) return null;
    return parsed.map((value) => Boolean(value));
  } catch {
    return null;
  }
}

function applySelectionsToCard(card: CardGrid, selections: boolean[]): CardGrid {
  return card.map((row, rowIdx) =>
    row.map((cell, colIdx) => {
      const idx = rowIdx * 5 + colIdx;
      if (cell.isFree) return { ...cell, marked: true };
      if (cell.isBlank || cell.value === null) return { ...cell, marked: false };
      return { ...cell, marked: Boolean(selections[idx]) };
    })
  );
}

function isBlankCell(cell: CardCell): boolean {
  return Boolean(cell.isBlank) || (cell.value === null && !cell.isFree);
}

function loadInitialCardState(boardGameStyle: GameStyle = "bingo"): {
  card: CardGrid;
  autoSync: boolean;
  gameStyle: GameStyle;
  printedClaim: boolean;
  claimSig: string | null;
} {
  // Board-host QR verify keeps the payload for App — don't hydrate card mode from it.
  if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(QR_BOARD_VERIFY_KEY) === "1") {
    const stored = loadStoredCardState(boardGameStyle);
    return { ...stored, printedClaim: false, claimSig: null };
  }
  const claim = takeQrCardClaim();
  if (claim) {
    const grid = flatNumbersToGrid(claim.numbers, claim.gameStyle);
    if (grid) {
      localStorage.removeItem("bingo-card-id");
      localStorage.removeItem(CARD_UNJOINED_SELECTIONS_STORAGE_KEY);
      const cleared = grid.map((row) =>
        row.map((cell) => ({
          ...cell,
          marked: cell.isFree,
        }))
      );
      localStorage.setItem(
        CARD_STATE_STORAGE_KEY,
        JSON.stringify(gridToStoredCardState(cleared, false, claim.gameStyle))
      );
      return {
        card: cleared,
        autoSync: false,
        gameStyle: claim.gameStyle,
        printedClaim: true,
        claimSig: claim.sig,
      };
    }
  }

  const stored = loadStoredCardState(boardGameStyle);
  const hasJoinedBoard = Boolean(localStorage.getItem("bingo-card-id"));
  if (hasJoinedBoard) return { ...stored, printedClaim: false, claimSig: null };
  const selections = loadUnjoinedSelections();
  if (!selections) {
    const cleared = stored.card.map((row) =>
      row.map((cell) => ({
        ...cell,
        marked: cell.isFree,
      }))
    );
    return {
      card: cleared,
      autoSync: stored.autoSync,
      gameStyle: stored.gameStyle,
      printedClaim: false,
      claimSig: null,
    };
  }
  return {
    card: applySelectionsToCard(stored.card, selections),
    autoSync: stored.autoSync,
    gameStyle: stored.gameStyle,
    printedClaim: false,
    claimSig: null,
  };
}

export function CardPage({ state, letterColors, connected }: Props) {
  const boardGameStyle: GameStyle = state.gameStyle ?? "bingo";
  const initialStoredState = useMemo(
    () => loadInitialCardState(boardGameStyle),
    // Intentionally once on mount — board style at first paint seeds local generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [card, setCard] = useState<CardGrid>(initialStoredState.card);
  const [autoSync, setAutoSync] = useState<boolean>(initialStoredState.autoSync);
  const [cardGameStyle, setCardGameStyle] = useState<GameStyle>(initialStoredState.gameStyle);
  const [cardId, setCardId] = useState<string | null>(localStorage.getItem("bingo-card-id"));
  const [printedClaimPending, setPrintedClaimPending] = useState(initialStoredState.printedClaim);
  const claimSigRef = useRef<string | null>(initialStoredState.claimSig);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinErrorOpen, setJoinErrorOpen] = useState(false);
  const [winnerFlashCells, setWinnerFlashCells] = useState<Set<number>>(new Set());
  const [winnerFlashPhase, setWinnerFlashPhase] = useState(false);
  const [cardWinnerActive, setCardWinnerActive] = useState(false);
  const [rerollConfirmOpen, setRerollConfirmOpen] = useState(false);
  const prevWinnerRef = useRef(false);
  const lastConfettiKeyRef = useRef<string>("");
  const flashedPatternKeysRef = useRef<Set<string>>(new Set());
  const activeFlashPatternKeyRef = useRef<string>("");
  const latestCardRef = useRef<CardGrid>(initialStoredState.card);
  const latestCardWinnerRef = useRef(false);
  const pendingMarksRef = useRef<Map<number, boolean>>(new Map());
  const prevAutoSyncRef = useRef(initialStoredState.autoSync);
  const syncMarksInFlightRef = useRef(false);
  const pendingSyncMarksRef = useRef<boolean[] | null>(null);
  const calledSet = useMemo(() => new Set(state.called), [state.called]);
  const freeSpaceActive = useMemo(
    () =>
      boardGameStyle === "bingo" &&
      isGameType(state.gameType) &&
      gameTypeUsesFreeSpace(state.gameType),
    [boardGameStyle, state.gameType]
  );
  const joinedToBoard = Boolean(cardId);
  const rerollDisabled = state.called.length > 0;
  const gameStyle = boardGameStyle;

  useEffect(() => {
    // Claim flow may have cleared bingo-card-id before React subscribed to session events.
    notifyCardSessionChanged();
  }, []);

  const clearJoinedCardSession = useCallback(() => {
    setCardId(null);
    localStorage.removeItem("bingo-card-id");
    notifyCardSessionChanged();
    pendingMarksRef.current.clear();
  }, []);
  const captureWinningFlashCells = useCallback((grid: CardGrid) => {
    if (gameStyle === "housey" && isHouseyGameType(state.gameType)) {
      const flashIdx = houseyWinningFlashCells(
        grid,
        state.gameType,
        calledSet,
        state.current > 0 ? state.current : undefined
      );
      const nextKey = flashIdx.join("-");
      if (activeFlashPatternKeyRef.current === nextKey) return;
      if (flashIdx.length === 0) {
        activeFlashPatternKeyRef.current = "";
        setWinnerFlashCells(new Set());
        return;
      }
      activeFlashPatternKeyRef.current = nextKey;
      setWinnerFlashCells(new Set(flashIdx));
      return;
    }

    if (!isGameType(state.gameType)) {
      activeFlashPatternKeyRef.current = "";
      setWinnerFlashCells(new Set());
      return;
    }

    const satisfied = winningPatterns(grid, state.gameType, calledSet);
    const requiredPatterns = GAME_TYPE_BY_ID[state.gameType]?.requiredPatterns ?? 1;
    if (satisfied.length < requiredPatterns) {
      activeFlashPatternKeyRef.current = "";
      setWinnerFlashCells(new Set());
      return;
    }

    // Keep the current flash pattern stable while winner is active.
    if (activeFlashPatternKeyRef.current) {
      const stillActive = activeFlashPatternKeyRef.current
        .split("|")
        .every((key) => satisfied.some((pattern) => pattern.join("-") === key));
      if (stillActive) return;
    }

    // Prefer newly satisfied patterns so subsequent bingos flash the newest win.
    // Double Bingo flashes two distinct lines together.
    const unused = satisfied.filter((pattern) => !flashedPatternKeysRef.current.has(pattern.join("-")));
    if (unused.length < requiredPatterns) return;
    const nextPatterns = unused.slice(0, requiredPatterns);
    const nextKey = nextPatterns.map((pattern) => pattern.join("-")).join("|");
    nextPatterns.forEach((pattern) => flashedPatternKeysRef.current.add(pattern.join("-")));
    activeFlashPatternKeyRef.current = nextKey;
    const flashIdx = new Set(nextPatterns.flat());
    const filtered = [...flashIdx].filter((idx) => {
      // FREE is always marked for qualifying game types — don't include it in flash.
      if (idx === 12) return false;
      const cell = grid.flat()[idx];
      if (!cell) return false;
      if (cell.isFree) return false;
      return cell.value !== null && calledSet.has(cell.value);
    });
    setWinnerFlashCells(new Set<number>(filtered));
  }, [gameStyle, state.gameType, state.current, calledSet]);

  const cardNumbers = useMemo(
    () =>
      card
        .flat()
        .map((cell) => (cell.isFree || cell.isBlank ? null : cell.value)),
    [card]
  );

  const fireConfetti = useCallback(() => {
    const duration = 3000;
    const end = Date.now() + duration;
    const colors = ["#f59e0b", "#ef4444", "#3b82f6", "#22c55e", "#a855f7"];

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.6 },
        colors,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.6 },
        colors,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    };

    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors,
    });
    frame();
  }, []);

  const triggerWinnerEffects = useCallback((winnerActive: boolean, grid: CardGrid) => {
    if (!winnerActive) return;
    const confettiKey = [
      cardId ?? "no-card",
      state.winnerEventId ?? 0,
      state.current,
      state.called.length,
      state.winnerCount ?? 0,
      state.manualWinnerDeclared ? 1 : 0,
    ].join(":");
    captureWinningFlashCells(grid);
    if (lastConfettiKeyRef.current === confettiKey) return;
    lastConfettiKeyRef.current = confettiKey;
    fireConfetti();
  }, [
    cardId,
    state.winnerEventId,
    state.current,
    state.called.length,
    state.winnerCount,
    state.manualWinnerDeclared,
    captureWinningFlashCells,
    fireConfetti,
  ]);

  const applyWinnerState = useCallback((cardWinner: boolean, grid: CardGrid) => {
    latestCardWinnerRef.current = cardWinner;
    setCardWinnerActive(cardWinner);
    if (!cardWinner) {
      prevWinnerRef.current = false;
      lastConfettiKeyRef.current = "";
      activeFlashPatternKeyRef.current = "";
      setWinnerFlashCells(new Set());
      return;
    }
    if (!prevWinnerRef.current) {
      triggerWinnerEffects(true, grid);
    }
    prevWinnerRef.current = true;
  }, [triggerWinnerEffects]);

  const queueMarkUpdate = useCallback((idx: number, marked: boolean) => {
    pendingMarksRef.current.set(idx, marked);
  }, []);

  const flushPendingMarks = useCallback(() => {
    if (!joinedToBoard || !connected || !cardId || autoSync) return;
    if (pendingMarksRef.current.size === 0) return;
    const entries = Array.from(pendingMarksRef.current.entries());
    pendingMarksRef.current.clear();
    entries.forEach(([idx, marked]) => {
      void api.markCardCell(cardId, idx, marked).catch(() => {
        pendingMarksRef.current.set(idx, marked);
      });
    });
  }, [joinedToBoard, connected, cardId, autoSync]);

  const resolveCardWinner = useCallback(
    (grid: CardGrid, serverWinner: boolean) => {
      if (gameStyle === "housey") {
        if (!isHouseyGameType(state.gameType)) return serverWinner;
        // Battleship: survivors win — local "complete" is sunk, not a win.
        if (state.gameType === "battleship") return serverWinner;
        if (!autoSync) return serverWinner;
        return (
          serverWinner ||
          gridHasHouseyWinningPattern(
            grid,
            state.gameType,
            calledSet,
            state.current > 0 ? state.current : undefined
          )
        );
      }
      if (!autoSync) return serverWinner;
      if (!isGameType(state.gameType)) return serverWinner;
      return serverWinner || gridHasWinningPattern(grid, state.gameType, calledSet);
    },
    [autoSync, gameStyle, state.gameType, state.current, calledSet]
  );

  const pushAutoSyncToServer = useCallback(
    async (marks: boolean[]) => {
      if (!cardId || !connected) return;
      if (syncMarksInFlightRef.current) {
        pendingSyncMarksRef.current = marks;
        return;
      }
      syncMarksInFlightRef.current = true;
      try {
        const result = await api.syncCardMarks(cardId, marks);
        const grid = latestCardRef.current;
        applyWinnerState(resolveCardWinner(grid, Boolean(result.winner)), grid);
      } catch {
        pendingSyncMarksRef.current = marks;
      } finally {
        syncMarksInFlightRef.current = false;
        const pending = pendingSyncMarksRef.current;
        if (pending) {
          pendingSyncMarksRef.current = null;
          void pushAutoSyncToServer(pending);
        }
      }
    },
    [cardId, connected, applyWinnerState, resolveCardWinner]
  );

  useEffect(() => {
    const stored = gridToStoredCardState(card, autoSync, cardGameStyle);
    localStorage.setItem(CARD_STATE_STORAGE_KEY, JSON.stringify(stored));
  }, [card, autoSync, cardGameStyle]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("bingo:card-auto-sync-changed", {
        detail: { enabled: autoSync },
      })
    );
  }, [autoSync]);

  useEffect(() => {
    latestCardRef.current = card;
  }, [card]);

  useEffect(() => {
    if (joinedToBoard) return;
    const selections = card.flat().map((cell) => (cell.isFree ? true : Boolean(cell.marked)));
    localStorage.setItem(CARD_UNJOINED_SELECTIONS_STORAGE_KEY, JSON.stringify(selections));
  }, [card, joinedToBoard]);

  useEffect(() => {
    if (!cardId || !connected) return;
    const pollCardState = async () => {
      try {
        const cardState = await api.getCardState(cardId);
        let nextGrid: CardGrid | null = null;
        if (!autoSync) {
          setCard((prev) => {
            nextGrid = prev.map((row, rowIdx) =>
              row.map((cell, colIdx) => {
                if (cell.isFree) return { ...cell, marked: true };
                if (isBlankCell(cell)) return { ...cell, marked: false };
                return {
                  ...cell,
                  marked: Boolean(cardState.marks[rowIdx * 5 + colIdx]),
                };
              })
            );
            return nextGrid;
          });
        }
        const grid = nextGrid ?? latestCardRef.current;
        applyWinnerState(resolveCardWinner(grid, Boolean(cardState.winner)), grid);
      } catch (e: unknown) {
        // If the card session is gone, fall back to local/unjoined mode.
        if (e instanceof Error && (e.message.includes("404") || e.message.includes("400"))) {
          clearJoinedCardSession();
          prevWinnerRef.current = false;
          setJoinError("Card session is unavailable. Rejoin the available board.");
        }
      }
    };
    // Run immediately so winner effects (flash/confetti) don't wait for the first interval tick.
    void pollCardState();
    const id = setInterval(() => {
      void pollCardState();
    }, 1500);
    return () => clearInterval(id);
  }, [cardId, connected, autoSync, state.current, applyWinnerState, clearJoinedCardSession, resolveCardWinner]);

  useEffect(() => {
    if (!cardId) return;
    const onWsMessage = (event: Event) => {
      const customEvent = event as CustomEvent<WsMessageEnvelope>;
      const detail = customEvent.detail;
      if (!detail || detail.type !== "card_state") return;
      const payload = detail.data as WsCardStateData | undefined;
      if (!payload || payload.cardId !== cardId) return;
      const marks = Array.isArray(payload.marks) && payload.marks.length === 25
        ? payload.marks.map(Boolean)
        : null;
      let nextGrid: CardGrid | null = null;
      if (marks && !autoSync) {
        setCard((prev) => {
          nextGrid = prev.map((row, rowIdx) =>
            row.map((cell, colIdx) => {
              if (cell.isFree) return { ...cell, marked: true };
              if (isBlankCell(cell)) return { ...cell, marked: false };
              return {
                ...cell,
                marked: Boolean(marks[rowIdx * 5 + colIdx]),
              };
            })
          );
          return nextGrid;
        });
      }
      const grid = nextGrid ?? latestCardRef.current;
      applyWinnerState(resolveCardWinner(grid, Boolean(payload.winner)), grid);
    };
    window.addEventListener("bingo:ws-message", onWsMessage as EventListener);
    return () => window.removeEventListener("bingo:ws-message", onWsMessage as EventListener);
  }, [cardId, autoSync, applyWinnerState, resolveCardWinner]);

  const handleJoin = useCallback(async () => {
    try {
      let joined;
      try {
        joined = await api.joinCard(cardNumbers, cardId ?? undefined, cardGameStyle);
      } catch {
        if (!cardId) throw new Error("join failed");
        clearJoinedCardSession();
        joined = await api.joinCard(cardNumbers, undefined, cardGameStyle);
      }
      setCardId(joined.cardId);
      localStorage.setItem("bingo-card-id", joined.cardId);
      notifyCardSessionChanged();
      pendingMarksRef.current.clear();
      setJoinError(null);
      applyWinnerState(Boolean(joined.winner), card);
    } catch (e: unknown) {
      if (!connected) {
        setJoinError("Board is unreachable. For local multi-window testing, run: npm run dev:shared-mock");
        setJoinErrorOpen(true);
        return;
      }
      if (e instanceof Error && e.message.includes("401")) {
        setJoinError("Unable to join card session.");
        setJoinErrorOpen(true);
        return;
      }
      if (e instanceof Error && e.message.toLowerCase().includes("abort")) {
        setJoinError("Join request timed out. Verify shared mock is running, then refresh both tabs and retry.");
        setJoinErrorOpen(true);
        return;
      }
      if (e instanceof Error && /^\d{3}$/.test(e.message)) {
        setJoinError(`Unable to join card session (HTTP ${e.message}).`);
        setJoinErrorOpen(true);
        return;
      }
      setJoinError("Unable to join card session. Try again.");
      setJoinErrorOpen(true);
    }
  }, [cardNumbers, cardId, cardGameStyle, connected, applyWinnerState, card, clearJoinedCardSession]);

  const handleLeaveBoard = useCallback(async () => {
    if (cardId) {
      try {
        await api.leaveCard(cardId);
      } catch {
        // Best effort cleanup; local state still clears.
      }
    }
    setCardId(null);
    localStorage.removeItem("bingo-card-id");
    notifyCardSessionChanged();
    pendingMarksRef.current.clear();
    flashedPatternKeysRef.current.clear();
    activeFlashPatternKeyRef.current = "";
    prevWinnerRef.current = false;
    setWinnerFlashCells(new Set());
    setJoinError(null);
  }, [cardId]);

  useEffect(() => {
    flushPendingMarks();
  }, [flushPendingMarks, connected, joinedToBoard, cardId]);

  useEffect(() => {
    const onLeaveBoard = () => handleLeaveBoard();
    window.addEventListener("bingo:leave-board", onLeaveBoard as EventListener);
    return () => window.removeEventListener("bingo:leave-board", onLeaveBoard as EventListener);
  }, [handleLeaveBoard]);

  useEffect(() => {
    const onJoinBoard = () => {
      void handleJoin();
    };
    window.addEventListener("bingo:join-board", onJoinBoard as EventListener);
    return () => window.removeEventListener("bingo:join-board", onJoinBoard as EventListener);
  }, [handleJoin]);

  useEffect(() => {
    if (!printedClaimPending || !connected) return;
    let cancelled = false;
    const run = async () => {
      try {
        const claimed = await api.claimPrintedCard(cardNumbers, claimSigRef.current, {
          autoSync: false,
          gameStyle: cardGameStyle,
        });
        if (cancelled) return;
        setCardId(claimed.cardId);
        localStorage.setItem("bingo-card-id", claimed.cardId);
        notifyCardSessionChanged();
        pendingMarksRef.current.clear();
        setJoinError(null);
        setPrintedClaimPending(false);
        setAutoSync(false);
        if (Array.isArray(claimed.marks) && claimed.marks.length === 25) {
          setCard((prev) => {
            const next = prev.map((row, rowIdx) =>
              row.map((cell, colIdx) => {
                const idx = rowIdx * 5 + colIdx;
                if (cell.isFree) return { ...cell, marked: true };
                if (isBlankCell(cell)) return { ...cell, marked: false };
                return {
                  ...cell,
                  marked: Boolean(claimed.marks[idx]),
                };
              })
            );
            latestCardRef.current = next;
            applyWinnerState(resolveCardWinner(next, Boolean(claimed.winner)), next);
            return next;
          });
        } else {
          applyWinnerState(Boolean(claimed.winner), latestCardRef.current);
        }
      } catch {
        if (cancelled) return;
        setPrintedClaimPending(false);
        setJoinError("Unable to verify printed card. Try again.");
        setJoinErrorOpen(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    printedClaimPending,
    connected,
    cardNumbers,
    cardGameStyle,
    applyWinnerState,
    resolveCardWinner,
  ]);

  useEffect(() => {
    if (!connected) return;
    if (cardId) return;
    if (printedClaimPending) return;
    void handleJoin();
  }, [connected, cardId, printedClaimPending, handleJoin]);

  useEffect(() => {
    if (!cardId) return;
    const onBeforeUnload = () => {
      const payload = JSON.stringify({ cardId });
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/card/leave", blob);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [cardId]);

  useEffect(() => {
    if (cardWinnerActive) return;
    prevWinnerRef.current = false;
    setWinnerFlashCells(new Set());
  }, [cardWinnerActive]);

  useEffect(() => {
    // Recompute flash cells while winner state is active in case called/marks state arrives slightly later.
    if (!cardWinnerActive) return;
    if (!joinedToBoard) return;
    captureWinningFlashCells(card);
  }, [cardWinnerActive, joinedToBoard, card, captureWinningFlashCells]);

  useEffect(() => {
    if (!cardWinnerActive || winnerFlashCells.size === 0) return;
    const id = window.setInterval(() => {
      setWinnerFlashPhase((v) => !v);
    }, 350);
    return () => window.clearInterval(id);
  }, [cardWinnerActive, winnerFlashCells.size]);

  useEffect(() => {
    if (!autoSync || !joinedToBoard) return;

    const justEnabled = autoSync && !prevAutoSyncRef.current;
    prevAutoSyncRef.current = autoSync;

    const { grid, changed, marks } = buildAutoSyncedGrid(latestCardRef.current, calledSet);
    latestCardRef.current = grid;
    setCard(grid);

    // Battleship: keep prior server winner until sync responds (local complete ≠ win).
    const winnerHint =
      gameStyle === "housey" && state.gameType === "battleship"
        ? latestCardWinnerRef.current
        : false;
    applyWinnerState(resolveCardWinner(grid, winnerHint), grid);

    if (cardId && connected && (changed || justEnabled)) {
      void pushAutoSyncToServer(marks);
    }
  }, [
    autoSync,
    calledSet,
    joinedToBoard,
    cardId,
    connected,
    gameStyle,
    state.gameType,
    applyWinnerState,
    resolveCardWinner,
    pushAutoSyncToServer,
  ]);

  useEffect(() => {
    if (autoSync) return;
    prevAutoSyncRef.current = false;
  }, [autoSync]);

  useEffect(() => {
    // When a joined board resets, immediately clear local marks to FREE-only / blanks unmarked.
    if (!joinedToBoard) return;
    if (state.called.length !== 0) return;
    flashedPatternKeysRef.current.clear();
    activeFlashPatternKeyRef.current = "";
    setCard((prev) =>
      prev.map((row) =>
        row.map((cell) => ({
          ...cell,
          marked: cell.isFree,
        }))
      )
    );
  }, [joinedToBoard, state.called.length]);

  const handleReroll = async () => {
    const next = generateCardForStyle(gameStyle);
    setCardGameStyle(gameStyle);
    flashedPatternKeysRef.current.clear();
    activeFlashPatternKeyRef.current = "";
    setCard(next);
    pendingMarksRef.current.clear();
    if (joinedToBoard && connected && cardId) {
      const numbers = next.flat().map((cell) => (cell.isFree || cell.isBlank ? null : cell.value));
      await api.joinCard(numbers, cardId, gameStyle);
    }
  };

  const handleCellClick = async (rowIdx: number, colIdx: number) => {
    setCard((prev) => {
      const next = prev.map((row) => row.map((cell) => ({ ...cell })));
      const cell = next[rowIdx][colIdx];
      if (isBlankCell(cell)) return prev;
      const baseClickable = joinedToBoard
        ? isCellClickableInManual(cell, calledSet)
        : !cell.isFree && cell.value !== null;
      const clickable = baseClickable && !(autoSync && cell.marked);
      if (!clickable) return prev;
      cell.marked = !cell.marked;
      if (joinedToBoard && cardId) {
        const idx = rowIdx * 5 + colIdx;
        queueMarkUpdate(idx, cell.marked);
        flushPendingMarks();
      }
      return next;
    });
  };

  const getCellClasses = (cell: CardCell, colIdx: number, rowIdx: number) => {
    const idx = rowIdx * 5 + colIdx;
    const winningFlash = winnerFlashCells.has(idx);
    if (isBlankCell(cell)) {
      return cn(
        "h-20 sm:h-24 text-xl sm:text-2xl font-extrabold text-center align-middle select-none transition-colors cursor-default opacity-40"
      );
    }
    if (cell.isFree) {
      const freeMarked = freeSpaceActive;
      return cn(
        "h-20 sm:h-24 text-xl sm:text-2xl font-extrabold text-center align-middle select-none transition-colors cursor-default",
        freeMarked ? "text-white" : "text-foreground"
      );
    }
    const baseClickable = joinedToBoard
      ? isCellClickableInManual(cell, calledSet)
      : !cell.isFree && cell.value !== null;
    const disabledByAutoSync = autoSync && cell.marked;
    const clickable = baseClickable && !disabledByAutoSync;
    return cn(
      "h-20 sm:h-24 text-xl sm:text-2xl font-extrabold text-center align-middle select-none transition-colors",
      cell.marked ? "text-white" : "text-foreground",
      clickable ? "cursor-pointer" : "cursor-not-allowed",
      // Sync on: dim uncalled cells. Sync off: called/uncalled look identical until marked.
      autoSync && !clickable && !disabledByAutoSync && "opacity-55",
      winningFlash && "ring-2 ring-white/90"
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Your Card</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={autoSync ? "default" : "outline"}
                size="icon"
                onClick={() => setAutoSync((v) => !v)}
                disabled={!joinedToBoard}
                aria-pressed={autoSync}
                aria-label="Toggle auto sync called numbers"
                title={joinedToBoard ? "Auto-sync called numbers" : "Join a connected board to enable auto-sync"}
                style={
                  autoSync
                    ? {
                        backgroundColor: letterColors.N,
                        borderColor: letterColors.N,
                        color: "#ffffff",
                      }
                    : undefined
                }
              >
                <Link2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  if (!rerollDisabled) setRerollConfirmOpen(true);
                }}
                disabled={rerollDisabled}
                aria-label="Re-roll card numbers"
                title={rerollDisabled ? "Re-roll disabled after first call" : "Re-roll card numbers"}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <table className="w-full table-fixed border-collapse rounded-lg overflow-hidden">
              <thead>
                <tr>
                  {LETTERS.map((letter) => (
                    <th
                      key={letter}
                      className="h-14 text-2xl font-black tracking-wide text-white"
                      style={{ backgroundColor: letterColors[letter] }}
                    >
                      {letter}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {card.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((cell, colIdx) => (
                      (() => {
                        const idx = rowIdx * 5 + colIdx;
                        const winningFlash = winnerFlashCells.has(idx);
                        const blank = isBlankCell(cell);
                        return (
                          <td
                            key={`${rowIdx}-${colIdx}`}
                            className={getCellClasses(cell, colIdx, rowIdx)}
                            style={{
                              backgroundColor: blank
                                ? "hsl(var(--muted))"
                                : (cell.isFree ? freeSpaceActive : cell.marked)
                                  ? letterColors[LETTERS[colIdx]]
                                  : "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              ...(winningFlash
                                ? {
                                    boxShadow: winnerFlashPhase
                                      ? "inset 0 0 0 3px rgba(255,255,255,0.95)"
                                      : "inset 0 0 0 3px rgba(255,255,255,0.25)",
                                    filter: winnerFlashPhase ? "brightness(1.35)" : "brightness(1)",
                                  }
                                : undefined),
                            }}
                            onClick={() => void handleCellClick(rowIdx, colIdx)}
                          >
                            {blank ? "" : cell.isFree ? "FREE" : cell.value}
                          </td>
                        );
                      })()
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Dialog open={rerollConfirmOpen} onOpenChange={setRerollConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-roll Card Numbers?</DialogTitle>
            <DialogDescription>
              Are you sure you would like to reroll your card numbers?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRerollConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setRerollConfirmOpen(false);
                void handleReroll();
              }}
            >
              Re-roll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={joinErrorOpen} onOpenChange={setJoinErrorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unable to Join Board</DialogTitle>
            <DialogDescription>{joinError ?? "Unable to join card session."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setJoinErrorOpen(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
