import {
  ALL_GAME_TYPES,
  GAME_TYPE_LABELS,
  GAME_TYPE_MIN_CALLS,
  isGameType,
  type GameType,
} from "@/lib/game-types.generated";

export type GameStyle = "bingo" | "housey";

/** HOUSEY prize / elimination types (5×5 sparse cards, 1–75 pool). */
export type HouseyGameType =
  | "battleship"
  | "four_corners"
  | "line"
  | "two_lines"
  | "full_house";

/** Any selectable game type across styles. */
export type AnyGameType = GameType | HouseyGameType;

export const GAME_STYLES: GameStyle[] = ["bingo", "housey"];

export const GAME_STYLE_LABELS: Record<GameStyle, string> = {
  bingo: "BINGO",
  housey: "HOUSEY",
};

export const HOUSEY_GAME_TYPES: HouseyGameType[] = [
  "battleship",
  "four_corners",
  "line",
  "two_lines",
  "full_house",
];

export const HOUSEY_GAME_TYPE_LABELS: Record<HouseyGameType, string> = {
  battleship: "Battleship",
  four_corners: "Four Corners",
  line: "Line",
  two_lines: "Two Lines",
  full_house: "Full House",
};

export const HOUSEY_GAME_TYPE_DESCRIPTIONS: Record<HouseyGameType, string> = {
  battleship: "Last card still afloat wins. A card sinks when all of its numbers are called.",
  four_corners: "All populated corner cells called; completing call must be a corner number.",
  line: "Any one horizontal row with all populated cells called.",
  two_lines: "Any two horizontal rows with all populated cells called.",
  full_house: "Every populated number on the card has been called.",
};

/** Approximate minima for enabling Winner manually; pattern wins also auto-alert. */
export const HOUSEY_GAME_TYPE_MIN_CALLS: Record<HouseyGameType, number> = {
  battleship: 10,
  four_corners: 1,
  line: 1,
  two_lines: 2,
  full_house: 10,
};

/** 1-indexed cells for steady LED / UI indicator (Battleship is animated in firmware). */
export const HOUSEY_DISPLAY_CELLS: Record<HouseyGameType, number[]> = {
  battleship: [], // chase 1→25 handled in firmware / UI timer
  four_corners: [1, 5, 21, 25],
  line: [11, 12, 13, 14, 15],
  two_lines: [6, 7, 8, 9, 10, 21, 22, 23, 24, 25],
  full_house: Array.from({ length: 25 }, (_, i) => i + 1),
};

export function isGameStyle(value: string): value is GameStyle {
  return value === "bingo" || value === "housey";
}

export function isHouseyGameType(value: string): value is HouseyGameType {
  return (HOUSEY_GAME_TYPES as string[]).includes(value);
}

export function isAnyGameType(value: string): value is AnyGameType {
  return isGameType(value) || isHouseyGameType(value);
}

export function defaultGameTypeForStyle(style: GameStyle): AnyGameType {
  return style === "housey" ? "battleship" : "cover_all";
}

export function gameTypesForStyle(style: GameStyle): readonly string[] {
  return style === "housey" ? HOUSEY_GAME_TYPES : ALL_GAME_TYPES;
}

export function isValidGameSelection(style: string, gameType: string): boolean {
  if (!isGameStyle(style)) return false;
  if (style === "bingo") return isGameType(gameType);
  return isHouseyGameType(gameType);
}

export function labelForGameType(style: GameStyle, gameType: string): string {
  if (style === "housey" && isHouseyGameType(gameType)) {
    return HOUSEY_GAME_TYPE_LABELS[gameType];
  }
  if (isGameType(gameType)) return GAME_TYPE_LABELS[gameType];
  return gameType;
}

export function minCallsForSelection(style: GameStyle, gameType: string): number {
  if (style === "housey" && isHouseyGameType(gameType)) {
    return HOUSEY_GAME_TYPE_MIN_CALLS[gameType];
  }
  if (isGameType(gameType)) return GAME_TYPE_MIN_CALLS[gameType];
  return 0;
}

export function nextGameTypeInStyle(style: GameStyle, current: string): string {
  const list = gameTypesForStyle(style);
  const idx = list.indexOf(current);
  if (idx < 0) return list[0]!;
  return list[(idx + 1) % list.length]!;
}

/** Sparse HOUSEY card: 10–12 populated cells, no FREE. */
export const HOUSEY_MIN_POPULATED = 10;
export const HOUSEY_MAX_POPULATED = 12;

export const HOUSEY_CORNER_INDICES = [0, 4, 20, 24] as const;
