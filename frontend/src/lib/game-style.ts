import {
  ALL_GAME_TYPES,
  GAME_TYPE_LABELS,
  GAME_TYPE_MIN_CALLS,
  isGameType,
  type GameType,
} from "@/lib/game-types.generated";

/** Alias of GameType (formerly spanned bingo + HOUSEY). */
export type AnyGameType = GameType;

export function labelForGameType(gameType: string): string {
  if (isGameType(gameType)) return GAME_TYPE_LABELS[gameType];
  return gameType;
}

export function minCallsForSelection(gameType: string): number {
  if (isGameType(gameType)) return GAME_TYPE_MIN_CALLS[gameType];
  return 0;
}

export function nextGameType(current: string): GameType {
  const idx = ALL_GAME_TYPES.indexOf(current as GameType);
  if (idx < 0) return ALL_GAME_TYPES[0]!;
  return ALL_GAME_TYPES[(idx + 1) % ALL_GAME_TYPES.length]!;
}
