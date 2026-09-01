import {
  type GameType,
  type GameTypeCategoryId,
  type GameTypeDef,
  GAME_TYPE_CATEGORIES,
  GAME_TYPE_DEFS,
  GAME_TYPE_BY_ID,
  ALL_GAME_TYPES,
  GAME_TYPE_LABELS,
  GAME_TYPE_MIN_CALLS,
  GAME_TYPE_CELLS,
  CYCLING_PATTERNS,
  GAME_TYPE_REQUIRED_HITS,
  isGameType,
} from "@/lib/game-types.generated";
import {
  type AnyGameType,
  labelForGameType,
  minCallsForSelection,
  nextGameType,
} from "@/lib/game-style";

export type { GameType, GameTypeCategoryId, GameTypeDef, AnyGameType };

export {
  GAME_TYPE_CATEGORIES,
  GAME_TYPE_DEFS,
  GAME_TYPE_BY_ID,
  ALL_GAME_TYPES,
  GAME_TYPE_LABELS,
  GAME_TYPE_MIN_CALLS,
  GAME_TYPE_CELLS,
  CYCLING_PATTERNS,
  GAME_TYPE_REQUIRED_HITS,
  isGameType,
  labelForGameType,
  minCallsForSelection,
  nextGameType,
};

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
  screensaverEnabled?: boolean;
  screensaverActive?: boolean;
  screensaverType?: ScreensaverType;
  screensaverText?: string;
  screensaverSpeedMs?: number;
  screensaverColor?: string;
  autoCallingEnabled?: boolean;
  autoCallingHold?: boolean;
  autoCallingSeconds?: number;
  autoCallingRemainingMs?: number;
  theme: number;
  brightness: number;
  colorMode: ColorMode;
  staticColor: string;
  ledHeaderColor: string;
  ledGameTypeColor: string;
  ledLetterColors: LedLetterColors;
  /** Board-shared BINGO UI letter theme (Default / Rainbow / … / Custom) */
  uiColorTheme?: BingoUiThemeId;
  /** Custom UI letter colors (used when uiColorTheme is custom) */
  uiCustomColors?: LedLetterColors;
  /** When a letter column is fully called: on | off | number_theme */
  letterFullMode: LetterFullMode;
  /** Current-number beacon animation */
  currentNumberEffect: CurrentNumberEffect;
  currentNumberColor: string;
  /** Briefly show letter+number glyph banner on the number LED section after each call */
  calledNumberBanner?: boolean;
  /** Winner LED board-phase effect (same catalog as screensavers; default sparkle) */
  winnerEffect?: ScreensaverType;
  /** Outbound webhook URL configured (details board-auth only via /webhooks) */
  webhookConfigured?: boolean;
  /** MQTT broker+topic configured and enabled */
  mqttConfigured?: boolean;
  mqttConnected?: boolean;
  /** Board-shared HUD GIFs armed (header toggle) */
  gifModeEnabled?: boolean;
  /** GIF URL mapped for the current called number (display still gated by gifModeEnabled) */
  currentGifUrl?: string;
  wifiSsid?: string;
  wifiConfigured?: boolean;
  wifiConnected?: boolean;
  wifiMode?: "sta" | "ap";
  patternIndex: number;
  /** Battleship: cards still afloat */
  survivorCount?: number;
  /** Battleship: cards sunk */
  eliminatedCount?: number;
}

export interface OutboundEventFlags {
  numberCalled: boolean;
  numberUndone: boolean;
  winnerDeclared: boolean;
  winnerCleared: boolean;
  gameStarted: boolean;
  gameTypeChanged: boolean;
  callingStyleChanged: boolean;
}

export const DEFAULT_OUTBOUND_EVENT_FLAGS: OutboundEventFlags = {
  numberCalled: true,
  numberUndone: false,
  winnerDeclared: true,
  winnerCleared: false,
  gameStarted: false,
  gameTypeChanged: false,
  callingStyleChanged: false,
};

export interface WebhookSettings extends OutboundEventFlags {
  url: string;
  username: string;
  /** Omit on save to keep existing password. */
  password?: string;
  passwordSet?: boolean;
}

export interface MqttSettings extends OutboundEventFlags {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  /** Omit on save to keep existing password. */
  password?: string;
  passwordSet?: boolean;
  topic: string;
  useTls: boolean;
  connected?: boolean;
}

/** Sparse number → GIF URL map (keys "1"…"75"); board-auth only via /number-gifs. */
export interface NumberGifSettings {
  enabled: boolean;
  urls: Record<string, string>;
}

export type LetterFullMode = "on" | "off" | "number_theme";

export const LETTER_FULL_MODE_LABELS: Record<LetterFullMode, string> = {
  on: "LED on (header color)",
  off: "LED off",
  number_theme: "Number theme",
};

export type CurrentNumberEffect = "flash" | "pulse" | "strobe";

export const CURRENT_NUMBER_EFFECT_LABELS: Record<CurrentNumberEffect, string> = {
  flash: "Flash",
  pulse: "Pulse",
  strobe: "Strobe",
};

export type ScreensaverType =
  | "text"
  | "rainbow"
  | "solid"
  | "fire_matrix"
  | "pacifica"
  | "pride"
  | "twinkle_fox"
  | "cylon"
  | "noise_palette"
  | "sinelon"
  | "juggle"
  | "confetti"
  | "fire2012"
  | "sparkle";

export const SCREENSAVER_TYPE_LABELS: Record<ScreensaverType, string> = {
  text: "Scrolling Text",
  rainbow: "Animated Rainbow",
  solid: "Solid Color",
  fire_matrix: "Fire Matrix",
  pacifica: "Pacifica",
  pride: "Pride",
  twinkle_fox: "TwinkleFox",
  cylon: "Cylon Scanner",
  noise_palette: "Noise Palette",
  sinelon: "Sinelon",
  juggle: "Juggle",
  confetti: "Confetti",
  fire2012: "Fire 2012",
  sparkle: "Gold Sparkle",
};

export const SCREENSAVER_TYPE_DESCRIPTIONS: Record<ScreensaverType, string> = {
  text: "Always overrides board LEDs and scrolls text on the full 21x5 matrix.",
  rainbow: "Animated rainbow effect across the full 21x5 matrix.",
  solid: "Solid color fill across the full 21x5 matrix.",
  fire_matrix: "Perlin-noise fire rising across the full 21x5 matrix.",
  pacifica: "Gentle blue-green ocean waves across the full board.",
  pride: "Ever-changing flowing rainbow ribbons.",
  twinkle_fox: "Holiday-style twinkling lights with rotating palettes.",
  cylon: "Knight Rider-style column scanner bouncing left and right.",
  noise_palette: "Organic Perlin noise mapped through cycling color palettes.",
  sinelon: "A single colored comet weaving with fading trails.",
  juggle: "Multiple colored dots weaving in and out of sync.",
  confetti: "Random colored speckles that blink and fade.",
  fire2012: "Classic heat-cell fire simulation rising from the bottom.",
  sparkle: "Gold shimmer twinkles across every LED (classic winner sparkle).",
};

export type AppMode = "board" | "card" | "scan" | "hud";

export interface BoardAuthSession {
  token: string;
  ttlMs: number;
}

export interface CardJoinResponse {
  cardId: string;
  winner: boolean;
  winnerCount: number;
  winnerEventId?: number;
  marks?: boolean[];
}

export interface CardClaimResponse {
  cardId: string;
  winner: boolean;
  winnerCount: number;
  winnerEventId?: number;
  marks: boolean[];
  authentic?: boolean;
}

export interface CardStateResponse {
  cardId: string;
  winner: boolean;
  winnerCount: number;
  winnerEventId?: number;
  marks: boolean[];
}

export type CallingStyle = "automatic" | "manual";
export type ColorMode = "theme" | "solid" | "custom" | "ui";

export type BingoUiThemeId =
  | "default"
  | "rainbow"
  | "warm_sunset"
  | "cool_blue"
  | "high_contrast"
  | "custom";

export const LETTERS = ["B", "I", "N", "G", "O"] as const;
export type Letter = (typeof LETTERS)[number];
export type LedLetterColors = Record<Letter, string>;

export const DEFAULT_LED_LETTER_COLORS: LedLetterColors = {
  B: "#3b82f6",
  I: "#ef4444",
  N: "#10b981",
  G: "#f59e0b",
  O: "#a855f7",
};

export const LETTER_RANGES: Record<Letter, [number, number]> = {
  B: [1, 15],
  I: [16, 30],
  N: [31, 45],
  G: [46, 60],
  O: [61, 75],
};

/** @deprecated Prefer CYCLING_PATTERNS.traditional */
export const TRADITIONAL_PATTERNS = CYCLING_PATTERNS.traditional!;
/** @deprecated Prefer CYCLING_PATTERNS.postage_stamp */
export const POSTAGE_STAMP_PATTERNS = CYCLING_PATTERNS.postage_stamp!;

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
  gameType: "cover_all",
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
  screensaverEnabled: false,
  screensaverActive: false,
  screensaverType: "rainbow",
  screensaverText: "BINGO",
  screensaverSpeedMs: 230,
  screensaverColor: "#4e7a27",
  autoCallingEnabled: false,
  autoCallingHold: false,
  autoCallingSeconds: 10,
  autoCallingRemainingMs: 0,
  theme: 0,
  brightness: 255,
  colorMode: "theme",
  staticColor: "#00ff00",
  ledHeaderColor: "#ffd8a8",
  ledGameTypeColor: "#ffd8a8",
  ledLetterColors: DEFAULT_LED_LETTER_COLORS,
  uiColorTheme: "default",
  uiCustomColors: DEFAULT_LED_LETTER_COLORS,
  letterFullMode: "on",
  currentNumberEffect: "flash",
  currentNumberColor: "#ffffff",
  calledNumberBanner: false,
  winnerEffect: "sparkle",
  webhookConfigured: false,
  mqttConfigured: false,
  mqttConnected: false,
  gifModeEnabled: false,
  currentGifUrl: "",
  wifiSsid: "",
  wifiConfigured: false,
  wifiConnected: false,
  wifiMode: "ap",
  patternIndex: 0,
};
