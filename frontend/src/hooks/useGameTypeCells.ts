import { GAME_TYPE_CELLS, CYCLING_PATTERNS, type GameType } from "@/types";

/**
 * Returns the active cells for a game type indicator.
 * For game types with cycling patterns (traditional, postage_stamp),
 * uses the patternIndex from the API state (synced with LED output).
 * For other types, returns the static pattern.
 */
export function useGameTypeCells(gameType: GameType, patternIndex: number): number[] {
  const patterns = CYCLING_PATTERNS[gameType];
  const ensureLetterYFree = (cells: number[]) => {
    if (gameType !== "y") return cells;
    return cells.includes(13) ? cells : [...cells, 13];
  };
  if (patterns) {
    return ensureLetterYFree(patterns[patternIndex % patterns.length]);
  }

  return ensureLetterYFree(GAME_TYPE_CELLS[gameType]);
}
