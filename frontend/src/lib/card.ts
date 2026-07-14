import { LETTERS, LETTER_RANGES, type GameType, type Letter } from "@/types";

export interface CardCell {
  letter: Letter;
  value: number | null;
  isFree: boolean;
  marked: boolean;
}

export type CardGrid = CardCell[][];

export interface StoredCardState {
  version?: number;
  numbers: Array<number | null>;
  marks: boolean[];
  autoSync?: boolean;
}

export const CARD_STATE_STORAGE_VERSION = 2;

function pickUniqueRandom(min: number, max: number, count: number): number[] {
  const pool: number[] = [];
  for (let n = min; n <= max; n++) pool.push(n);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function generateBingoCard(): CardGrid {
  const columns = LETTERS.map((letter) => {
    const [min, max] = LETTER_RANGES[letter];
    return pickUniqueRandom(min, max, 5);
  });

  const grid: CardGrid = Array.from({ length: 5 }, (_, rowIdx) =>
    Array.from({ length: 5 }, (_, colIdx) => ({
      letter: LETTERS[colIdx],
      value: columns[colIdx][rowIdx],
      isFree: false,
      marked: false,
    }))
  );

  grid[2][2] = {
    letter: "N",
    value: null,
    isFree: true,
    marked: true,
  };

  return grid;
}

export function isCellClickableInManual(cell: CardCell, calledSet: Set<number>): boolean {
  if (cell.isFree || cell.value === null) return false;
  return calledSet.has(cell.value);
}

export function gridToStoredCardState(grid: CardGrid, autoSync = true): StoredCardState {
  const flat = grid.flat();
  return {
    version: CARD_STATE_STORAGE_VERSION,
    numbers: flat.map((cell) => (cell.isFree ? null : cell.value)),
    marks: flat.map((cell, idx) => (idx === 12 ? true : cell.marked)),
    autoSync,
  };
}

export function storedCardStateToGrid(stored: StoredCardState): CardGrid | null {
  if (!stored || !Array.isArray(stored.numbers) || !Array.isArray(stored.marks)) return null;
  if (stored.numbers.length !== 25 || stored.marks.length !== 25) return null;

  const grid: CardGrid = Array.from({ length: 5 }, (_, rowIdx) =>
    Array.from({ length: 5 }, (_, colIdx) => {
      const idx = rowIdx * 5 + colIdx;
      const isFree = idx === 12;
      return {
        letter: LETTERS[colIdx],
        value: isFree ? null : stored.numbers[idx],
        isFree,
        marked: isFree ? true : Boolean(stored.marks[idx]),
      };
    })
  );
  return grid;
}

export function gameTypeUsesFreeSpace(gameType: GameType): boolean {
  return (
    gameType === "traditional" ||
    gameType === "cover_all" ||
    gameType === "x" ||
    gameType === "y" ||
    gameType === "plus_sign" ||
    gameType === "field_goal"
  );
}

export function winningPatterns(card: CardGrid, gameType: GameType, calledSet: Set<number>): number[][] {
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
    return findSatisfiedPatterns([Array.from({ length: 25 }, (_, i) => i)]);
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
  if (gameType === "plus_sign") {
    return findSatisfiedPatterns([[2, 7, 10, 11, 12, 13, 14, 17, 22]]);
  }
  if (gameType === "field_goal") {
    return findSatisfiedPatterns([[0, 4, 5, 9, 10, 11, 12, 13, 14, 17, 22]]);
  }
  const patterns: number[][] = [];
  for (let r = 0; r < 5; r++) patterns.push([r * 5, r * 5 + 1, r * 5 + 2, r * 5 + 3, r * 5 + 4]);
  for (let c = 0; c < 5; c++) patterns.push([c, c + 5, c + 10, c + 15, c + 20]);
  patterns.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return findSatisfiedPatterns(patterns);
}

export function gridHasWinningPattern(card: CardGrid, gameType: GameType, calledSet: Set<number>): boolean {
  return winningPatterns(card, gameType, calledSet).length > 0;
}

export function buildAutoSyncedGrid(
  card: CardGrid,
  calledSet: Set<number>
): { grid: CardGrid; changed: boolean; marks: boolean[] } {
  let changed = false;
  const grid = card.map((row, rowIdx) =>
    row.map((cell, colIdx) => {
      const idx = rowIdx * 5 + colIdx;
      if (cell.isFree) {
        if (!cell.marked) changed = true;
        return { ...cell, marked: true };
      }
      if (cell.value === null) return cell;
      const marked = calledSet.has(cell.value);
      if (cell.marked !== marked) changed = true;
      return { ...cell, marked };
    })
  );
  const marks = grid.flat().map((cell, idx) => (idx === 12 ? true : cell.marked));
  return { grid, changed, marks };
}
