import { GAME_TYPE_BY_ID, LETTERS, LETTER_RANGES, type GameType, type Letter } from "@/types";

export interface CardCell {
  letter: Letter;
  value: number | null;
  /** FREE center (always marked). */
  isFree: boolean;
  /** Unfilled preselected slot — shows dauber circle; not a win requirement. */
  isBlank?: boolean;
  marked: boolean;
}

export type CardGrid = CardCell[][];

export interface StoredCardState {
  version?: number;
  numbers: Array<number | null>;
  marks: boolean[];
  autoSync?: boolean;
}

export const CARD_STATE_STORAGE_VERSION = 4;

export const CARD_FILL_MIN = 1;
export const CARD_FILL_MAX = 25;
export const CARD_FILL_DEFAULT = 25;

export const CARD_FILL_MIN_STORAGE_KEY = "bingo-card-fill-min";
export const CARD_FILL_MAX_STORAGE_KEY = "bingo-card-fill-max";

/**
 * Uniform int in [0, maxExclusive). Uses crypto.getRandomValues with rejection
 * sampling so there is no modulo bias (unlike a raw Math.random() multiply).
 */
function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error("maxExclusive must be > 0");
  if (maxExclusive === 1) return 0;
  const max = 0x1_0000_0000;
  const limit = max - (max % maxExclusive);
  const buf = new Uint32Array(1);
  const cryptoObj = typeof globalThis.crypto?.getRandomValues === "function" ? globalThis.crypto : null;
  for (;;) {
    if (cryptoObj) {
      cryptoObj.getRandomValues(buf);
    } else {
      buf[0] = Math.floor(Math.random() * max) >>> 0;
    }
    const x = buf[0]!;
    if (x < limit) return x % maxExclusive;
  }
}

/** Fisher–Yates shuffle (uniform). */
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/** Uniform sample of `count` distinct values from [min, max], in random order. */
function pickUniqueRandom(min: number, max: number, count: number): number[] {
  const pool: number[] = [];
  for (let n = min; n <= max; n++) pool.push(n);
  if (count > pool.length) throw new Error(`pickUniqueRandom: count ${count} > pool ${pool.length}`);
  shuffleInPlace(pool);
  return pool.slice(0, count);
}

export function clampCardFill(n: number): number {
  if (!Number.isFinite(n)) return CARD_FILL_DEFAULT;
  return Math.min(CARD_FILL_MAX, Math.max(CARD_FILL_MIN, Math.round(n)));
}

/** Keep min ≤ max; when raising min above max bump max; when lowering max below min lower min. */
export function normalizeCardFillRange(minIn: number, maxIn: number): { min: number; max: number } {
  let min = clampCardFill(minIn);
  let max = clampCardFill(maxIn);
  if (min > max) max = min;
  return { min, max };
}

export function readCardFillRange(): { min: number; max: number } {
  if (typeof window === "undefined") return { min: CARD_FILL_DEFAULT, max: CARD_FILL_DEFAULT };
  const minStr = localStorage.getItem(CARD_FILL_MIN_STORAGE_KEY);
  const maxStr = localStorage.getItem(CARD_FILL_MAX_STORAGE_KEY);
  const minRaw = minStr == null || minStr === "" ? NaN : Number(minStr);
  const maxRaw = maxStr == null || maxStr === "" ? NaN : Number(maxStr);
  return normalizeCardFillRange(
    Number.isFinite(minRaw) ? minRaw : CARD_FILL_DEFAULT,
    Number.isFinite(maxRaw) ? maxRaw : CARD_FILL_DEFAULT
  );
}

export function writeCardFillRange(minIn: number, maxIn: number): { min: number; max: number } {
  const range = normalizeCardFillRange(minIn, maxIn);
  if (typeof window !== "undefined") {
    localStorage.setItem(CARD_FILL_MIN_STORAGE_KEY, String(range.min));
    localStorage.setItem(CARD_FILL_MAX_STORAGE_KEY, String(range.max));
  }
  return range;
}

function emptyGrid(): CardGrid {
  return Array.from({ length: 5 }, (_, rowIdx) =>
    Array.from({ length: 5 }, (_, colIdx) => ({
      letter: LETTERS[colIdx]!,
      value: null as number | null,
      isFree: false,
      isBlank: true,
      marked: false,
    }))
  );
}

/**
 * Standard 5×5 bingo card. `minFilled`/`maxFilled` = total preselected spaces including FREE (1–25).
 * Defaults 25/25 match a classic full card.
 */
export function generateBingoCard(opts?: { minFilled?: number; maxFilled?: number }): CardGrid {
  const { min, max } = normalizeCardFillRange(
    opts?.minFilled ?? CARD_FILL_DEFAULT,
    opts?.maxFilled ?? opts?.minFilled ?? CARD_FILL_DEFAULT
  );
  const filled = min + randomInt(max - min + 1);

  // Full classic card path (identical to historical generateBingoCard).
  if (filled === 25) {
    const grid: CardGrid = Array.from({ length: 5 }, (_, rowIdx) =>
      Array.from({ length: 5 }, (_, colIdx) => ({
        letter: LETTERS[colIdx]!,
        value: null as number | null,
        isFree: false,
        isBlank: false,
        marked: false,
      }))
    );

    for (let colIdx = 0; colIdx < 5; colIdx++) {
      const letter = LETTERS[colIdx]!;
      const [lo, hi] = LETTER_RANGES[letter];
      const isN = letter === "N";
      const nums = pickUniqueRandom(lo, hi, isN ? 4 : 5);
      const rows = isN ? [0, 1, 3, 4] : [0, 1, 2, 3, 4];
      shuffleInPlace(rows);
      for (let i = 0; i < nums.length; i++) {
        const cell = grid[rows[i]!]![colIdx]!;
        cell.value = nums[i]!;
        cell.isBlank = false;
      }
    }

    grid[2]![2] = {
      letter: "N",
      value: null,
      isFree: true,
      isBlank: false,
      marked: true,
    };
    return grid;
  }

  // Sparse: FREE always counts as 1 filled space; pick filled-1 other cells.
  const grid = emptyGrid();
  grid[2]![2] = {
    letter: "N",
    value: null,
    isFree: true,
    isBlank: false,
    marked: true,
  };

  const numberSlots = filled - 1; // FREE already placed
  if (numberSlots <= 0) return grid;

  const candidates: number[] = [];
  for (let i = 0; i < 25; i++) {
    if (i === 12) continue;
    candidates.push(i);
  }
  shuffleInPlace(candidates);
  const chosen = candidates.slice(0, numberSlots);

  // Group by column for uniqueness within letter range.
  const byCol: number[][] = [[], [], [], [], []];
  for (const idx of chosen) {
    byCol[idx % 5]!.push(Math.floor(idx / 5));
  }

  for (let col = 0; col < 5; col++) {
    const rows = byCol[col]!;
    if (rows.length === 0) continue;
    const letter = LETTERS[col]!;
    const [lo, hi] = LETTER_RANGES[letter];
    const nums = pickUniqueRandom(lo, hi, rows.length);
    for (let i = 0; i < rows.length; i++) {
      const cell = grid[rows[i]!]![col]!;
      cell.value = nums[i]!;
      cell.isBlank = false;
      cell.isFree = false;
      cell.marked = false;
    }
  }

  return grid;
}

export function isCellClickableInManual(cell: CardCell, calledSet: Set<number>): boolean {
  if (cell.isFree || cell.isBlank || cell.value === null) return false;
  return calledSet.has(cell.value);
}

export function gridToStoredCardState(grid: CardGrid, autoSync = true): StoredCardState {
  const flat = grid.flat();
  return {
    version: CARD_STATE_STORAGE_VERSION,
    numbers: flat.map((cell) => (cell.isFree || cell.isBlank ? null : cell.value)),
    marks: flat.map((cell) => Boolean(cell.marked)),
    autoSync,
  };
}

export function storedCardStateToGrid(stored: StoredCardState): CardGrid | null {
  if (!stored || !Array.isArray(stored.numbers) || !Array.isArray(stored.marks)) return null;
  if (stored.numbers.length !== 25 || stored.marks.length !== 25) return null;

  return Array.from({ length: 5 }, (_, rowIdx) =>
    Array.from({ length: 5 }, (_, colIdx) => {
      const idx = rowIdx * 5 + colIdx;
      const isFree = idx === 12;
      const value = stored.numbers[idx];
      const isBlank = !isFree && value == null;
      return {
        letter: LETTERS[colIdx],
        value: isFree || isBlank ? null : value,
        isFree,
        isBlank,
        marked: isFree ? true : Boolean(stored.marks[idx]),
      };
    })
  );
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
    // Blank (unfilled) cells do not block pattern wins.
    if (cell.isBlank || cell.value === null) return true;
    if (!cell.marked) return false;
    return calledSet.has(cell.value);
  };

  const def = GAME_TYPE_BY_ID[gameType];
  if (!def || def.elimination) return [];

  if (def.coveredThreshold > 0) {
    const covered: number[] = [];
    for (let i = 0; i < 25; i++) {
      const cell = flat[i]!;
      if (cell.isBlank) continue;
      if (isSatisfied(i)) covered.push(i);
    }
    // Count only non-blank cells toward threshold when sparse.
    const needed = Math.min(def.coveredThreshold, flat.filter((c) => !c.isBlank).length);
    return covered.length >= needed ? [covered] : [];
  }

  const patterns0 = def.winPatterns.map((pattern) => pattern.map((cell1) => cell1 - 1));
  return patterns0.filter((pattern) => pattern.every((idx) => isSatisfied(idx)));
}

export function gridHasWinningPattern(card: CardGrid, gameType: GameType, calledSet: Set<number>): boolean {
  return winningPatterns(card, gameType, calledSet).length >= requiredPatternsForGameType(gameType);
}

/** All populated numbers called (Battleship sink / local flash). */
export function cardAllPopulatedCalled(card: CardGrid, calledSet: Set<number>): boolean {
  let n = 0;
  for (const cell of card.flat()) {
    if (cell.isFree || cell.isBlank || cell.value == null) continue;
    n++;
    if (!calledSet.has(cell.value)) return false;
  }
  return n > 0;
}

/** Battleship scan: still afloat when any populated number has not been called. */
export function cardHasUncalledPopulated(
  numbers: ReadonlyArray<number | null | undefined>,
  calledSet: Set<number>
): boolean {
  for (const n of numbers) {
    if (typeof n !== "number" || n < 1 || n > 75) continue;
    if (!calledSet.has(n)) return true;
  }
  return false;
}

export function battleshipSunkFlashCells(card: CardGrid, calledSet: Set<number>, current?: number): number[] {
  if (!cardAllPopulatedCalled(card, calledSet)) return [];
  const flat = card.flat();
  if (current != null && current > 0 && !flat.some((c) => c.value === current)) return [];
  return flat.map((cell, idx) => (cell.value != null && !cell.isBlank && !cell.isFree ? idx : -1)).filter((idx) => idx >= 0);
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
