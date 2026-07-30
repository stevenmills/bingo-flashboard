import {
  GAME_TYPE_CELLS,
  CYCLING_PATTERNS,
  type AnyGameType,
  isGameType,
} from "@/types";
import { useEffect, useState } from "react";

/** Matches firmware PATTERN_CYCLE_MS — one display step for cycling game types. */
const PATTERN_CYCLE_MS = 1500;

/**
 * Returns the active cells for a game type indicator.
 * Cycling types advance via patternIndex (synced with LED output).
 * Battleship loops 1→25 at PATTERN_CYCLE_MS per cell.
 */
export function useGameTypeCells(
  gameType: AnyGameType,
  patternIndex: number
): number[] {
  const [battleshipCell, setBattleshipCell] = useState(0);

  useEffect(() => {
    if (gameType !== "battleship") {
      setBattleshipCell(0);
      return;
    }
    // Loop cell 1 → 25 at standard pattern speed (matches firmware).
    setBattleshipCell(1);
    let cell = 1;
    const id = window.setInterval(() => {
      cell = cell >= 25 ? 1 : cell + 1;
      setBattleshipCell(cell);
    }, PATTERN_CYCLE_MS);
    return () => window.clearInterval(id);
  }, [gameType]);

  if (gameType === "battleship") {
    return battleshipCell > 0 ? [battleshipCell] : [];
  }

  if (!isGameType(gameType)) return [];
  const patterns = CYCLING_PATTERNS[gameType];
  if (patterns && patterns.length > 0) {
    return patterns[patternIndex % patterns.length]!;
  }
  return GAME_TYPE_CELLS[gameType] ?? [];
}
