export interface GameState {
  current: number;
  called: number[];
  remaining: number;
  boardSeed: number;
  gameType: GameType;
  callingStyle: CallingStyle;
  gameEstablished: boolean;
  winnerDeclared: boolean;
  manualWinnerDeclared?: boolean;
  winnerEventId?: number;
  winnerCount?: number;
  playerCount?: number;
  cardCount?: number;
  ledTestMode: boolean;
  boardAccessRequired?: boolean;
  boardAuthValid?: boolean;
  theme: number;
  brightness: number;
  colorMode: ColorMode;
  staticColor: string;
  patternIndex: number;
}

export type AppMode = "board" | "card";

export interface BoardAuthSession {
  token: string;
  ttlMs: number;
}

export interface CardJoinResponse {
  cardId: string;
  winner: boolean;
  winnerCount: number;
  winnerEventId?: number;
}

export interface CardStateResponse {
  cardId: string;
  winner: boolean;
  winnerCount: number;
  winnerEventId?: number;
  marks: boolean[];
}

export type GameType =
  | "traditional"
  | "four_corners"
  | "postage_stamp"
  | "cover_all"
  | "x"
  | "y"
  | "frame_outside"
  | "frame_inside"
  | "plus_sign"
  | "field_goal";
export type CallingStyle = "automatic" | "manual";
export type ColorMode = "theme" | "solid";

export const LETTERS = ["B", "I", "N", "G", "O"] as const;
export type Letter = (typeof LETTERS)[number];

export const LETTER_RANGES: Record<Letter, [number, number]> = {
  B: [1, 15],
  I: [16, 30],
  N: [31, 45],
  G: [46, 60],
  O: [61, 75],
};

export const GAME_TYPE_LABELS: Record<GameType, string> = {
  traditional: "Traditional",
  four_corners: "Four Corners",
  postage_stamp: "Postage Stamp",
  cover_all: "Cover All",
  x: "Letter X",
  y: "Letter Y",
  frame_outside: "Frame Outside",
  frame_inside: "Frame Inside",
  plus_sign: "Plus Sign",
  field_goal: "Field Goal",
};

export const GAME_TYPE_MIN_CALLS: Record<GameType, number> = {
  traditional: 4,
  four_corners: 4,
  postage_stamp: 4,
  cover_all: 25,
  x: 8,
  y: 5,
  frame_outside: 16,
  frame_inside: 8,
  plus_sign: 8,
  field_goal: 10,
};

export const GAME_TYPE_CELLS: Record<GameType, number[]> = {
  traditional: [11, 12, 13, 14, 15],
  four_corners: [1, 5, 21, 25],
  postage_stamp: [1, 2, 6, 7],
  cover_all: Array.from({ length: 25 }, (_, i) => i + 1),
  x: [1, 5, 7, 9, 13, 17, 19, 21, 25],
  y: [1, 5, 7, 9, 13, 18, 23],
  frame_outside: [1, 2, 3, 4, 5, 6, 10, 11, 15, 16, 20, 21, 22, 23, 24, 25],
  frame_inside: [7, 8, 9, 12, 14, 17, 18, 19],
  plus_sign: [3, 8, 11, 12, 13, 14, 15, 18, 23],
  field_goal: [1, 5, 6, 10, 11, 12, 13, 14, 15, 18, 23],
};

/** All possible winning orientations for Traditional bingo (5×5 grid, 1-indexed row-major) */
export const TRADITIONAL_PATTERNS: number[][] = [
  // Rows
  [1, 2, 3, 4, 5],
  [6, 7, 8, 9, 10],
  [11, 12, 13, 14, 15],
  [16, 17, 18, 19, 20],
  [21, 22, 23, 24, 25],
  // Columns
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],
  [5, 10, 15, 20, 25],
  // Diagonals
  [1, 7, 13, 19, 25],
  [5, 9, 13, 17, 21],
];

/** All possible winning orientations for Postage Stamp (2×2 in each corner) */
export const POSTAGE_STAMP_PATTERNS: number[][] = [
  [1, 2, 6, 7],       // Top-left
  [4, 5, 9, 10],      // Top-right
  [16, 17, 21, 22],   // Bottom-left
  [19, 20, 24, 25],   // Bottom-right
];

/** Map of game types that have cycling patterns */
export const CYCLING_PATTERNS: Partial<Record<GameType, number[][]>> = {
  traditional: TRADITIONAL_PATTERNS,
  postage_stamp: POSTAGE_STAMP_PATTERNS,
};

export const THEME_NAMES = [
  "Animated Rainbow",
  "Breathe",
  "Candy",
  "Cloud",
  "Color Wave",
  "Fire",
  "Forest",
  "Gold Shimmer",
  "Heat",
  "Heartbeat",
  "Ice",
  "Lava",
  "Northern Lights",
  "Ocean",
  "Party",
  "Rainbow",
  "Rainbow Stripe",
  "Retro Arcade",
  "Sparkle",
] as const;

export function numberToLetter(n: number): Letter {
  if (n >= 1 && n <= 15) return "B";
  if (n >= 16 && n <= 30) return "I";
  if (n >= 31 && n <= 45) return "N";
  if (n >= 46 && n <= 60) return "G";
  if (n >= 61 && n <= 75) return "O";
  return "B";
}

export const DEFAULT_STATE: GameState = {
  current: 0,
  called: [],
  remaining: 75,
  boardSeed: 1000,
  gameType: "traditional",
  callingStyle: "automatic",
  gameEstablished: false,
  winnerDeclared: false,
  manualWinnerDeclared: false,
  winnerEventId: 0,
  winnerCount: 0,
  playerCount: 0,
  cardCount: 0,
  ledTestMode: false,
  boardAccessRequired: true,
  boardAuthValid: false,
  theme: 0,
  brightness: 128,
  colorMode: "theme",
  staticColor: "#22c55e",
  patternIndex: 0,
};
