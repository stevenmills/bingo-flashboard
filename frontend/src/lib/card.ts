import { LETTERS, LETTER_RANGES, type Letter } from "@/types";

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

export function gridToStoredCardState(grid: CardGrid, autoSync = false): StoredCardState {
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
