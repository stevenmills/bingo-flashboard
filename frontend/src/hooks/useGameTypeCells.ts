import {
  GAME_TYPE_CELLS,
  CYCLING_PATTERNS,
  type AnyGameType,
  type GameStyle,
  HOUSEY_DISPLAY_CELLS,
  isHouseyGameType,
  isGameType,
} from "@/types";
import { useEffect, useState } from "react";

/**
 * Returns the active cells for a game type indicator.
 * Cycling types advance via patternIndex (synced with LED output).
 * HOUSEY Battleship briefly chases 1→25 on the client while firmware does the same.
 */
export function useGameTypeCells(
  gameType: AnyGameType,
  patternIndex: number,
  gameStyle: GameStyle = "bingo"
): number[] {
  const [battleshipCell, setBattleshipCell] = useState(0);

  useEffect(() => {
    if (gameStyle !== "housey" || gameType !== "battleship") {
      setBattleshipCell(0);
      return;
    }
    setBattleshipCell(1);
    const started = Date.now();
    const id = window.setInterval(() => {
      const ms = Date.now() - started;
      if (ms >= 1200) {
        setBattleshipCell(0);
        window.clearInterval(id);
        return;
      }
      setBattleshipCell(Math.min(25, Math.floor((ms * 25) / 1200) + 1));
    }, 40);
    return () => window.clearInterval(id);
  }, [gameStyle, gameType]);

  if (gameStyle === "housey" && isHouseyGameType(gameType)) {
    if (gameType === "battleship") {
      return battleshipCell > 0 ? [battleshipCell] : [];
    }
    return HOUSEY_DISPLAY_CELLS[gameType];
  }

  if (!isGameType(gameType)) return [];
  const patterns = CYCLING_PATTERNS[gameType];
  if (patterns && patterns.length > 0) {
    return patterns[patternIndex % patterns.length]!;
  }
  return GAME_TYPE_CELLS[gameType] ?? [];
}
