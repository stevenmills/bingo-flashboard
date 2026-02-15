import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link2, RefreshCw } from "lucide-react";
import { LETTERS, type GameState } from "@/types";
import type { LetterColors } from "@/lib/bingo-ui-colors";
import {
  CARD_STATE_STORAGE_VERSION,
  generateBingoCard,
  gridToStoredCardState,
  isCellClickableInManual,
  storedCardStateToGrid,
  type CardCell,
  type CardGrid,
  type StoredCardState,
} from "@/lib/card";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import confetti from "canvas-confetti";
import type { GameType } from "@/types";

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

function gameTypeUsesFreeSpace(gameType: GameType): boolean {
  return gameType === "traditional" || gameType === "cover_all" || gameType === "x" || gameType === "y";
}

function loadStoredCardState(): { card: CardGrid; autoSync: boolean } {
  try {
    const raw = localStorage.getItem(CARD_STATE_STORAGE_KEY);
    if (!raw) return { card: generateBingoCard(), autoSync: false };
    const parsed = JSON.parse(raw) as StoredCardState;
    if ((parsed.version ?? 1) !== CARD_STATE_STORAGE_VERSION) {
      return { card: generateBingoCard(), autoSync: false };
    }
    const restored = storedCardStateToGrid(parsed);
    if (!restored) return { card: generateBingoCard(), autoSync: false };
    return { card: restored, autoSync: Boolean(parsed.autoSync) };
  } catch {
    return { card: generateBingoCard(), autoSync: false };
  }
}

function loadUnjoinedSelections(): boolean[] | null {
  try {
    const raw = localStorage.getItem(CARD_UNJOINED_SELECTIONS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 25) return null;
    return parsed.map((value, idx) => (idx === 12 ? true : Boolean(value)));
  } catch {
    return null;
  }
}

function applySelectionsToCard(card: CardGrid, selections: boolean[]): CardGrid {
  return card.map((row, rowIdx) =>
    row.map((cell, colIdx) => {
      const idx = rowIdx * 5 + colIdx;
      if (cell.isFree) return { ...cell, marked: true };
      return { ...cell, marked: Boolean(selections[idx]) };
    })
  );
}

function loadInitialCardState(): { card: CardGrid; autoSync: boolean } {
  const stored = loadStoredCardState();
  const hasJoinedBoard = Boolean(localStorage.getItem("bingo-card-id"));
  if (hasJoinedBoard) return stored;
  const selections = loadUnjoinedSelections();
  if (!selections) {
    // Prevent stale joined-board coverage from leaking into unjoined card mode.
    const cleared = stored.card.map((row) =>
      row.map((cell) => ({
        ...cell,
        marked: cell.isFree,
      }))
    );
    return { card: cleared, autoSync: stored.autoSync };
  }
  return { card: applySelectionsToCard(stored.card, selections), autoSync: stored.autoSync };
}

function winningPatterns(card: CardGrid, gameType: GameType, calledSet: Set<number>): number[][] {
  const flat = card.flat();
  const isSatisfied = (idx: number): boolean => {
    const cell = flat[idx];
    if (!cell) return false;
    if (cell.isFree) return true;
    if (!cell.marked) return false;
    if (cell.value === null) return false;
    return calledSet.has(cell.value);
  };

  const findSatisfiedPatterns = (patterns: number[][]): number[][] =>
    patterns.filter((pattern) => pattern.every((idx) => isSatisfied(idx)));

  if (gameType === "four_corners") {
    return findSatisfiedPatterns([[0, 4, 20, 24]]);
  }
  if (gameType === "postage_stamp") {
    return findSatisfiedPatterns([
      [0, 1, 5, 6],
      [3, 4, 8, 9],
      [15, 16, 20, 21],
      [18, 19, 23, 24],
    ]);
  }
  if (gameType === "cover_all") {
    return [Array.from({ length: 25 }, (_, i) => i)];
  }
  if (gameType === "x") {
    return findSatisfiedPatterns([[0, 4, 6, 8, 12, 16, 18, 20, 24]]);
  }
  if (gameType === "y") {
    return findSatisfiedPatterns([[0, 4, 6, 8, 12, 17, 22]]);
  }
  if (gameType === "frame_outside") {
    return findSatisfiedPatterns([[0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24]]);
  }
  if (gameType === "frame_inside") {
    return findSatisfiedPatterns([[6, 7, 8, 11, 13, 16, 17, 18]]);
  }
  // traditional
  const patterns: number[][] = [];
  for (let r = 0; r < 5; r++) patterns.push([r * 5, r * 5 + 1, r * 5 + 2, r * 5 + 3, r * 5 + 4]);
  for (let c = 0; c < 5; c++) patterns.push([c, c + 5, c + 10, c + 15, c + 20]);
  patterns.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return findSatisfiedPatterns(patterns);
}

export function CardPage({ state, letterColors, connected }: Props) {
  const initialStoredState = useMemo(() => loadInitialCardState(), []);
  const [card, setCard] = useState<CardGrid>(initialStoredState.card);
  const [autoSync, setAutoSync] = useState<boolean>(initialStoredState.autoSync);
  const [cardId, setCardId] = useState<string | null>(localStorage.getItem("bingo-card-id"));
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
  const calledSet = useMemo(() => new Set(state.called), [state.called]);
  const freeSpaceActive = useMemo(() => gameTypeUsesFreeSpace(state.gameType), [state.gameType]);
  const joinedToBoard = Boolean(cardId);
  const rerollDisabled = state.called.length > 0;
  const captureWinningFlashCells = useCallback((grid: CardGrid) => {
    const satisfied = winningPatterns(grid, state.gameType, calledSet);
    if (satisfied.length === 0) {
      activeFlashPatternKeyRef.current = "";
      setWinnerFlashCells(new Set());
      return;
    }

    // Keep the current flash pattern stable while winner is active.
    if (activeFlashPatternKeyRef.current) {
      const stillActive = satisfied.some((pattern) => pattern.join("-") === activeFlashPatternKeyRef.current);
      if (stillActive) return;
    }

    // Prefer newly satisfied patterns so subsequent bingos flash the newest win.
    const nextPattern = satisfied.find((pattern) => !flashedPatternKeysRef.current.has(pattern.join("-")));
    if (!nextPattern) return;

    const nextKey = nextPattern.join("-");
    flashedPatternKeysRef.current.add(nextKey);
    activeFlashPatternKeyRef.current = nextKey;
    const filtered = nextPattern.filter((idx) => {
      const cell = grid.flat()[idx];
      if (!cell) return false;
      if (cell.isFree) return freeSpaceActive;
      return cell.value !== null && calledSet.has(cell.value);
    });
    setWinnerFlashCells(new Set<number>(filtered));
  }, [state.gameType, calledSet, freeSpaceActive]);

  const cardNumbers = useMemo(
    () =>
      card
        .flat()
        .map((cell) => (cell.isFree ? null : cell.value)),
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
    if (!joinedToBoard || !connected || !cardId) return;
    if (pendingMarksRef.current.size === 0) return;
    const entries = Array.from(pendingMarksRef.current.entries());
    pendingMarksRef.current.clear();
    entries.forEach(([idx, marked]) => {
      void api.markCardCell(cardId, idx, marked).catch(() => {
        pendingMarksRef.current.set(idx, marked);
      });
    });
  }, [joinedToBoard, connected, cardId]);

  useEffect(() => {
    const stored = gridToStoredCardState(card, autoSync);
    localStorage.setItem(CARD_STATE_STORAGE_KEY, JSON.stringify(stored));
  }, [card, autoSync]);

  useEffect(() => {
    latestCardRef.current = card;
  }, [card]);

  useEffect(() => {
    if (joinedToBoard) return;
    const selections = card.flat().map((cell, idx) => (idx === 12 ? true : Boolean(cell.marked)));
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
              row.map((cell, colIdx) => ({
                ...cell,
                marked: cell.isFree ? true : Boolean(cardState.marks[rowIdx * 5 + colIdx]),
              }))
            );
            return nextGrid;
          });
        }
        applyWinnerState(Boolean(cardState.winner), nextGrid ?? latestCardRef.current);
      } catch (e: unknown) {
        // If the card session is gone, fall back to local/unjoined mode.
        if (e instanceof Error && e.message.includes("404")) {
          setCardId(null);
          localStorage.removeItem("bingo-card-id");
          prevWinnerRef.current = false;
          setJoinError("Card session not found. Rejoin using the current board seed.");
        }
      }
    };
    // Run immediately so winner effects (flash/confetti) don't wait for the first interval tick.
    void pollCardState();
    const id = setInterval(() => {
      void pollCardState();
    }, 1500);
    return () => clearInterval(id);
  }, [cardId, connected, autoSync, state.current, applyWinnerState]);

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
            row.map((cell, colIdx) => ({
              ...cell,
              marked: cell.isFree ? true : Boolean(marks[rowIdx * 5 + colIdx]),
            }))
          );
          return nextGrid;
        });
      }
      applyWinnerState(Boolean(payload.winner), nextGrid ?? latestCardRef.current);
    };
    window.addEventListener("bingo:ws-message", onWsMessage as EventListener);
    return () => window.removeEventListener("bingo:ws-message", onWsMessage as EventListener);
  }, [cardId, autoSync, applyWinnerState]);

  const handleJoin = useCallback(async (seedInput: string) => {
    const normalizedSeed = seedInput.replace(/\D/g, "").slice(0, 4);
    if (normalizedSeed.length !== 4) {
      setJoinError("Enter a 4-digit board seed.");
      setJoinErrorOpen(true);
      return;
    }
    try {
      const joined = await api.joinCard(normalizedSeed, cardNumbers, cardId ?? undefined);
      setCardId(joined.cardId);
      localStorage.setItem("bingo-card-id", joined.cardId);
      pendingMarksRef.current.clear();
      setJoinError(null);
      applyWinnerState(Boolean(joined.winner), card);
    } catch (e: unknown) {
      if (!connected) {
        setJoinError("Board is unreachable. For local multi-window testing, run: npm run dev:shared-mock");
        setJoinErrorOpen(true);
        return;
      }
      if (e instanceof Error && e.message.includes("invalid board seed")) {
        setJoinError("Invalid board seed for this session. Ensure both windows are on the same shared dev server and refresh both tabs.");
        setJoinErrorOpen(true);
        return;
      }
      if (e instanceof Error && e.message.includes("401")) {
        setJoinError("Unable to join card session. Check board seed and try again.");
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
      setJoinError("Unable to join card session. Check seed format and try again.");
      setJoinErrorOpen(true);
    }
  }, [cardNumbers, cardId, connected, applyWinnerState, card]);

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
    const onJoinBoardSeed = (event: Event) => {
      const customEvent = event as CustomEvent<{ seed?: string }>;
      void handleJoin(customEvent.detail?.seed ?? "");
    };
    window.addEventListener("bingo:join-board-seed", onJoinBoardSeed as EventListener);
    return () => window.removeEventListener("bingo:join-board-seed", onJoinBoardSeed as EventListener);
  }, [handleJoin]);

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
    if (!autoSync) return;
    if (!joinedToBoard) return;
    setCard((prev) => {
      const changedMarks: Array<{ idx: number; marked: boolean }> = [];
      const next = prev.map((row, rowIdx) =>
        row.map((cell, colIdx) => {
          if (cell.isFree) return { ...cell, marked: true };
          if (cell.value === null) return cell;
          const marked = calledSet.has(cell.value);
          if (cell.marked !== marked) {
            changedMarks.push({ idx: rowIdx * 5 + colIdx, marked });
          }
          return { ...cell, marked, letter: cell.letter };
        })
      );
      if (joinedToBoard && cardId && changedMarks.length > 0) {
        changedMarks.forEach(({ idx, marked }) => {
          queueMarkUpdate(idx, marked);
        });
        flushPendingMarks();
      }
      return next;
    });
  }, [autoSync, calledSet, joinedToBoard, cardId, queueMarkUpdate, flushPendingMarks]);

  useEffect(() => {
    // When a joined board resets, immediately clear local marks to FREE-only.
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
    const next = generateBingoCard();
    flashedPatternKeysRef.current.clear();
    activeFlashPatternKeyRef.current = "";
    setCard(next);
    pendingMarksRef.current.clear();
    if (joinedToBoard && connected && cardId) {
      const numbers = next.flat().map((cell) => (cell.isFree ? null : cell.value));
      await api.joinCard(String(state.boardSeed), numbers, cardId);
    }
  };

  const handleCellClick = async (rowIdx: number, colIdx: number) => {
    setCard((prev) => {
      const next = prev.map((row) => row.map((cell) => ({ ...cell })));
      const cell = next[rowIdx][colIdx];
      const baseClickable = joinedToBoard ? isCellClickableInManual(cell, calledSet) : !cell.isFree;
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
    if (cell.isFree) {
      const freeMarked = freeSpaceActive;
      return cn(
        "h-20 sm:h-24 text-xl sm:text-2xl font-extrabold text-center align-middle select-none transition-colors cursor-default",
        freeMarked ? "text-white" : "text-foreground"
      );
    }
    const baseClickable = joinedToBoard ? isCellClickableInManual(cell, calledSet) : !cell.isFree;
    const disabledByAutoSync = autoSync && cell.marked;
    const clickable = baseClickable && !disabledByAutoSync;
    return cn(
      "h-20 sm:h-24 text-xl sm:text-2xl font-extrabold text-center align-middle select-none transition-colors",
      cell.marked ? "text-white" : "text-foreground",
      clickable ? "cursor-pointer" : "cursor-not-allowed",
      !clickable && !disabledByAutoSync && "opacity-55",
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
                        return (
                          <td
                            key={`${rowIdx}-${colIdx}`}
                            className={getCellClasses(cell, colIdx, rowIdx)}
                            style={{
                              backgroundColor: (cell.isFree ? freeSpaceActive : cell.marked)
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
                            {cell.isFree ? "FREE" : cell.value}
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
