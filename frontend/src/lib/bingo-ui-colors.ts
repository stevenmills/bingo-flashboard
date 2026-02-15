import type { Letter } from "@/types";

export type BingoUiThemeId =
  | "default"
  | "rainbow"
  | "warm_sunset"
  | "cool_blue"
  | "high_contrast"
  | "custom";

export type LetterColors = Record<Letter, string>;

export const BINGO_UI_COLORS_STORAGE_KEY = "bingo-ui-colors";

// Default matches the app's current canonical B/I/N/G/O colors.
export const DEFAULT_LETTER_COLORS: LetterColors = {
  B: "#3b82f6",
  I: "#ef4444",
  N: "#10b981",
  G: "#f59e0b",
  O: "#a855f7",
};

const RAINBOW_LETTER_COLORS: LetterColors = {
  B: "#ef4444",
  I: "#f59e0b",
  N: "#eab308",
  G: "#22c55e",
  O: "#3b82f6",
};

const WARM_SUNSET_LETTER_COLORS: LetterColors = {
  B: "#dc2626",
  I: "#ea580c",
  N: "#f97316",
  G: "#f59e0b",
  O: "#db2777",
};

const COOL_BLUE_LETTER_COLORS: LetterColors = {
  B: "#2563eb",
  I: "#0ea5e9",
  N: "#06b6d4",
  G: "#14b8a6",
  O: "#6366f1",
};

const HIGH_CONTRAST_LETTER_COLORS: LetterColors = {
  B: "#1d4ed8",
  I: "#b91c1c",
  N: "#15803d",
  G: "#b45309",
  O: "#7e22ce",
};

export const BINGO_UI_THEME_LABELS: Record<BingoUiThemeId, string> = {
  default: "Default",
  rainbow: "Rainbow",
  warm_sunset: "Warm Sunset",
  cool_blue: "Cool Blue",
  high_contrast: "High Contrast",
  custom: "Custom",
};

export const BINGO_UI_THEME_ORDER: BingoUiThemeId[] = [
  "default",
  "rainbow",
  "warm_sunset",
  "cool_blue",
  "high_contrast",
  "custom",
];

export const BINGO_UI_THEME_PRESETS: Record<Exclude<BingoUiThemeId, "custom">, LetterColors> = {
  default: DEFAULT_LETTER_COLORS,
  rainbow: RAINBOW_LETTER_COLORS,
  warm_sunset: WARM_SUNSET_LETTER_COLORS,
  cool_blue: COOL_BLUE_LETTER_COLORS,
  high_contrast: HIGH_CONTRAST_LETTER_COLORS,
};

export function isBingoUiThemeId(value: string): value is BingoUiThemeId {
  return value in BINGO_UI_THEME_LABELS;
}

export function normalizeHexColor(value: string): string {
  const withHash = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : "#000000";
}

export function isValidHexColor(value: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(value);
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const safe = normalizeHexColor(hex);
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

export function mixHex(hex: string, targetHex: string, amount: number): string {
  const c1 = normalizeHexColor(hex);
  const c2 = normalizeHexColor(targetHex);
  const t = Math.max(0, Math.min(1, amount));

  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);

  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
