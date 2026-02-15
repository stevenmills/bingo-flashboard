import { useEffect, useMemo, useState } from "react";
import type { Letter } from "@/types";
import {
  BINGO_UI_COLORS_STORAGE_KEY,
  BINGO_UI_THEME_PRESETS,
  DEFAULT_LETTER_COLORS,
  isBingoUiThemeId,
  normalizeHexColor,
  type BingoUiThemeId,
  type LetterColors,
} from "@/lib/bingo-ui-colors";

interface StoredBingoUiColors {
  activeTheme: BingoUiThemeId;
  customColors: LetterColors;
}

interface BingoUiColorsState {
  activeTheme: BingoUiThemeId;
  customColors: LetterColors;
  effectiveColors: LetterColors;
  setActiveTheme: (theme: BingoUiThemeId) => void;
  setCustomColor: (letter: Letter, hex: string) => void;
}

const FALLBACK_STATE: StoredBingoUiColors = {
  activeTheme: "default",
  customColors: DEFAULT_LETTER_COLORS,
};

function parseStoredValue(raw: string | null): StoredBingoUiColors {
  if (!raw) return FALLBACK_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredBingoUiColors>;
    const activeTheme =
      typeof parsed.activeTheme === "string" && isBingoUiThemeId(parsed.activeTheme)
        ? parsed.activeTheme
        : FALLBACK_STATE.activeTheme;
    const customSource = (parsed.customColors ?? parsed) as Record<string, unknown>;
    const pick = (upper: keyof LetterColors, lower: string) => {
      const direct = customSource[upper];
      if (typeof direct === "string") return direct;
      const legacy = customSource[lower];
      if (typeof legacy === "string") return legacy;
      return DEFAULT_LETTER_COLORS[upper];
    };
    const customColors: LetterColors = {
      B: normalizeHexColor(String(pick("B", "b"))),
      I: normalizeHexColor(String(pick("I", "i"))),
      N: normalizeHexColor(String(pick("N", "n"))),
      G: normalizeHexColor(String(pick("G", "g"))),
      O: normalizeHexColor(String(pick("O", "o"))),
    };
    return { activeTheme, customColors };
  } catch {
    return FALLBACK_STATE;
  }
}

export function useBingoUiColors(): BingoUiColorsState {
  const [state, setState] = useState<StoredBingoUiColors>(() => {
    if (typeof window === "undefined") return FALLBACK_STATE;
    return parseStoredValue(localStorage.getItem(BINGO_UI_COLORS_STORAGE_KEY));
  });

  useEffect(() => {
    localStorage.setItem(BINGO_UI_COLORS_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const effectiveColors = useMemo<LetterColors>(() => {
    if (state.activeTheme === "custom") return state.customColors;
    return BINGO_UI_THEME_PRESETS[state.activeTheme];
  }, [state.activeTheme, state.customColors]);

  const setActiveTheme = (theme: BingoUiThemeId) => {
    setState((prev) => ({ ...prev, activeTheme: theme }));
  };

  const setCustomColor = (letter: Letter, hex: string) => {
    setState((prev) => ({
      ...prev,
      customColors: {
        ...prev.customColors,
        [letter]: normalizeHexColor(hex),
      },
    }));
  };

  return {
    activeTheme: state.activeTheme,
    customColors: state.customColors,
    effectiveColors,
    setActiveTheme,
    setCustomColor,
  };
}
