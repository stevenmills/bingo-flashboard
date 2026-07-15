import { GAME_TYPE_CELLS, CYCLING_PATTERNS, type GameType } from "@/types";

/**
 * Returns the active cells for a game type indicator.
 * Cycling types advance via patternIndex (synced with LED output).
 */
export function useGameTypeCells(gameType: GameType, patternIndex: number): number[] {
  const patterns = CYCLING_PATTERNS[gameType];
  if (patterns && patterns.length > 0) {
    return patterns[patternIndex % patterns.length];
  }
  return GAME_TYPE_CELLS[gameType] ?? [];
}
