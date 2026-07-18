import { GAME_TYPE_BY_ID, LETTERS, LETTER_RANGES, type GameType, type Letter } from "@/types";
import {
  type GameStyle,
  type HouseyGameType,
  HOUSEY_CORNER_INDICES,
  HOUSEY_MAX_POPULATED,
  HOUSEY_MIN_POPULATED,
  isHouseyGameType,
} from "@/lib/game-style";

export interface CardCell {
  letter: Letter;
  value: number | null;
  /** Legacy BINGO FREE center (always marked). */
  isFree: boolean;
  /** HOUSEY empty cell (never a win requirement). */
  isBlank?: boolean;
  marked: boolean;
}

export type CardGrid = CardCell[][];

export interface StoredCardState {
  version?: number;
  /** bingo | housey — missing → bingo (legacy). */
  gameStyle?: GameStyle;
  numbers: Array<number | null>;
  marks: boolean[];
  autoSync?: boolean;
}

export const CARD_STATE_STORAGE_VERSION = 3;

function pickUniqueRandom(min: number, max: number, count: number): number[] {
  const pool: number[] = [];
  for (let n = min; n <= max; n++) pool.push(n);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
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
      isBlank: false,
      marked: false,
    }))
  );

  grid[2][2] = {
    letter: "N",
    value: null,
    isFree: true,
    isBlank: false,
    marked: true,
  };

  return grid;
}

/** Sparse 5×5 HOUSEY card: 10–12 column-valid numbers, no FREE. */
export function generateHouseyCard(): CardGrid {
  const count =
    HOUSEY_MIN_POPULATED +
    Math.floor(Math.random() * (HOUSEY_MAX_POPULATED - HOUSEY_MIN_POPULATED + 1));
  const positions = Array.from({ length: 25 }, (_, i) => i);
  shuffleInPlace(positions);
  const chosen = new Set(positions.slice(0, count));

  const usedByCol: number[][] = [[], [], [], [], []];
  const values = new Array<number | null>(25).fill(null);

  const ordered = Array.from(chosen);
  shuffleInPlace(ordered);
  for (const idx of ordered) {
    const col = idx % 5;
    const letter = LETTERS[col];
    const [min, max] = LETTER_RANGES[letter];
    const pick = pickUniqueRandom(min, max, 15).find((n) => !usedByCol[col].includes(n));
    if (pick == null) continue;
    usedByCol[col].push(pick);
    values[idx] = pick;
  }

  // Ensure we still have enough populated cells if column collisions trimmed some.
  let populated = values.filter((v) => v != null).length;
  if (populated < HOUSEY_MIN_POPULATED) {
    for (let idx = 0; idx < 25 && populated < HOUSEY_MIN_POPULATED; idx++) {
      if (values[idx] != null) continue;
      const col = idx % 5;
      const letter = LETTERS[col];
      const [min, max] = LETTER_RANGES[letter];
      const pick = pickUniqueRandom(min, max, 15).find((n) => !usedByCol[col].includes(n));
      if (pick == null) continue;
      usedByCol[col].push(pick);
      values[idx] = pick;
      populated++;
    }
  }

  return Array.from({ length: 5 }, (_, rowIdx) =>
    Array.from({ length: 5 }, (_, colIdx) => {
      const idx = rowIdx * 5 + colIdx;
      const value = values[idx];
      return {
        letter: LETTERS[colIdx],
        value,
        isFree: false,
        isBlank: value == null,
        marked: false,
      };
    })
  );
}

export function isCellClickableInManual(cell: CardCell, calledSet: Set<number>): boolean {
  if (cell.isFree || cell.isBlank || cell.value === null) return false;
  return calledSet.has(cell.value);
}

export function gridToStoredCardState(
  grid: CardGrid,
  autoSync = true,
  gameStyle: GameStyle = "bingo"
): StoredCardState {
  const flat = grid.flat();
  return {
    version: CARD_STATE_STORAGE_VERSION,
    gameStyle,
    numbers: flat.map((cell) => (cell.isFree || cell.isBlank ? null : cell.value)),
    marks: flat.map((cell) => Boolean(cell.marked)),
    autoSync,
  };
}

export function storedCardStateToGrid(stored: StoredCardState): CardGrid | null {
  if (!stored || !Array.isArray(stored.numbers) || !Array.isArray(stored.marks)) return null;
  if (stored.numbers.length !== 25 || stored.marks.length !== 25) return null;

  const style: GameStyle = stored.gameStyle === "housey" ? "housey" : "bingo";

  if (style === "housey") {
    return Array.from({ length: 5 }, (_, rowIdx) =>
      Array.from({ length: 5 }, (_, colIdx) => {
        const idx = rowIdx * 5 + colIdx;
        const value = stored.numbers[idx];
        const isBlank = value == null;
        return {
          letter: LETTERS[colIdx],
          value: isBlank ? null : value,
          isFree: false,
          isBlank,
          marked: Boolean(stored.marks[idx]),
        };
      })
    );
  }

  const grid: CardGrid = Array.from({ length: 5 }, (_, rowIdx) =>
    Array.from({ length: 5 }, (_, colIdx) => {
      const idx = rowIdx * 5 + colIdx;
      const isFree = idx === 12;
      return {
        letter: LETTERS[colIdx],
        value: isFree ? null : stored.numbers[idx],
        isFree,
        isBlank: false,
        marked: isFree ? true : Boolean(stored.marks[idx]),
      };
    })
  );
  return grid;
}

export function gameTypeUsesFreeSpace(gameType: GameType): boolean {
  return GAME_TYPE_BY_ID[gameType]?.usesFreeSpace ?? false;
}

export function requiredPatternsForGameType(gameType: GameType): number {
  return GAME_TYPE_BY_ID[gameType]?.requiredPatterns ?? 1;
}

export function winningPatterns(card: CardGrid, gameType: GameType, calledSet: Set<number>): number[][] {
  const flat = card.flat();
  const isSatisfied = (idx: number): boolean => {
    const cell = flat[idx];
    if (!cell) return false;
    if (cell.isFree) return true;
    if (cell.isBlank || cell.value === null) return false;
    if (!cell.marked) return false;
    return calledSet.has(cell.value);
  };

  const def = GAME_TYPE_BY_ID[gameType];
  if (!def) return [];

  if (def.coveredThreshold > 0) {
    const covered: number[] = [];
    for (let i = 0; i < 25; i++) if (isSatisfied(i)) covered.push(i);
    return covered.length >= def.coveredThreshold ? [covered] : [];
  }

  const patterns0 = def.winPatterns.map((pattern) => pattern.map((cell1) => cell1 - 1));
  return patterns0.filter((pattern) => pattern.every((idx) => isSatisfied(idx)));
}

export function gridHasWinningPattern(card: CardGrid, gameType: GameType, calledSet: Set<number>): boolean {
  return winningPatterns(card, gameType, calledSet).length >= requiredPatternsForGameType(gameType);
}

function rowPopulatedComplete(flat: CardCell[], row: number, calledSet: Set<number>): boolean {
  let populated = 0;
  for (let c = 0; c < 5; c++) {
    const cell = flat[row * 5 + c]!;
    if (cell.isBlank || cell.value === null) continue;
    populated++;
    if (!calledSet.has(cell.value)) return false;
  }
  return populated > 0;
}

/** Local HOUSEY pattern cells (0-indexed) for flash UI. */
export function houseyWinningFlashCells(
  card: CardGrid,
  houseyType: HouseyGameType,
  calledSet: Set<number>,
  current?: number
): number[] {
  const flat = card.flat();

  const allPopulatedCalled = (): boolean => {
    let n = 0;
    for (const cell of flat) {
      if (cell.isBlank || cell.value === null) continue;
      n++;
      if (!calledSet.has(cell.value)) return false;
    }
    return n > 0;
  };

  if (houseyType === "battleship" || houseyType === "full_house") {
    if (!allPopulatedCalled()) return [];
    if (current != null && current > 0) {
      const onCard = flat.some((c) => c.value === current);
      if (!onCard) return [];
    }
    return flat
      .map((cell, idx) => (cell.value != null && !cell.isBlank ? idx : -1))
      .filter((idx) => idx >= 0);
  }

  if (houseyType === "four_corners") {
    const corners = HOUSEY_CORNER_INDICES.filter((idx) => {
      const cell = flat[idx]!;
      return cell.value != null && !cell.isBlank;
    });
    if (corners.length === 0) return [];
    if (!corners.every((idx) => calledSet.has(flat[idx]!.value!))) return [];
    if (current != null && current > 0 && !corners.some((idx) => flat[idx]!.value === current)) {
      return [];
    }
    return [...corners];
  }

  if (houseyType === "line") {
    for (let r = 0; r < 5; r++) {
      if (!rowPopulatedComplete(flat, r, calledSet)) continue;
      const completed: number[] = [];
      for (let c = 0; c < 5; c++) {
        const idx = r * 5 + c;
        if (flat[idx]!.value != null && !flat[idx]!.isBlank) completed.push(idx);
      }
      if (current != null && current > 0) {
        const rowHasCurrent = completed.some((idx) => flat[idx]!.value === current);
        if (!rowHasCurrent) continue;
      }
      return completed;
    }
    return [];
  }

  if (houseyType === "two_lines") {
    const completeRows: number[] = [];
    for (let r = 0; r < 5; r++) {
      if (rowPopulatedComplete(flat, r, calledSet)) completeRows.push(r);
    }
    if (completeRows.length < 2) return [];
    const use = completeRows.slice(0, 2);
    const cells: number[] = [];
    for (const r of use) {
      for (let c = 0; c < 5; c++) {
        const idx = r * 5 + c;
        if (flat[idx]!.value != null && !flat[idx]!.isBlank) cells.push(idx);
      }
    }
    if (current != null && current > 0 && !cells.some((idx) => flat[idx]!.value === current)) {
      return [];
    }
    return cells;
  }

  return [];
}

export function gridHasHouseyWinningPattern(
  card: CardGrid,
  houseyType: HouseyGameType,
  calledSet: Set<number>,
  current?: number
): boolean {
  return houseyWinningFlashCells(card, houseyType, calledSet, current).length > 0;
}

export function buildAutoSyncedGrid(
  card: CardGrid,
  calledSet: Set<number>
): { grid: CardGrid; changed: boolean; marks: boolean[] } {
  let changed = false;
  const grid = card.map((row) =>
    row.map((cell) => {
      if (cell.isFree) {
        if (!cell.marked) changed = true;
        return { ...cell, marked: true };
      }
      if (cell.isBlank || cell.value === null) {
        if (cell.marked) changed = true;
        return { ...cell, marked: false };
      }
      const marked = calledSet.has(cell.value);
      if (cell.marked !== marked) changed = true;
      return { ...cell, marked };
    })
  );
  const marks = grid.flat().map((cell) => Boolean(cell.marked));
  return { grid, changed, marks };
}
