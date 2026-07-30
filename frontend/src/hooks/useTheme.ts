import { useState, useEffect, useCallback } from "react";
import type { AppMode } from "@/types";

type Theme = "light" | "dark";

const LEGACY_THEME_KEY = "bingo-theme";
const BOARD_THEME_KEY = "bingo-theme-board";
const CARD_THEME_KEY = "bingo-theme-card";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function readModeTheme(mode: AppMode | null | undefined): Theme {
  if (mode === "card") {
    const saved = localStorage.getItem(CARD_THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return "dark";
  }
  // Board and Scan share board theme (operator device).
  if (mode === "board" || mode === "scan") {
    const saved = localStorage.getItem(BOARD_THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return "light";
  }
  const saved = localStorage.getItem(LEGACY_THEME_KEY);
  return saved === "dark" ? "dark" : "light";
}

function persistModeTheme(mode: AppMode | null | undefined, theme: Theme) {
  localStorage.setItem(LEGACY_THEME_KEY, theme);
  if (mode === "card") localStorage.setItem(CARD_THEME_KEY, theme);
  else if (mode === "board" || mode === "scan") localStorage.setItem(BOARD_THEME_KEY, theme);
}

export function useTheme(appMode?: AppMode | null) {
  const [theme, setThemeState] = useState<Theme>(() => readModeTheme(appMode));

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      persistModeTheme(appMode, t);
      applyTheme(t);
    },
    [appMode]
  );

  useEffect(() => {
    const next = readModeTheme(appMode);
    setThemeState(next);
    applyTheme(next);
  }, [appMode]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme };
}
