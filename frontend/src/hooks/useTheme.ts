import { useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("bingo-theme") as Theme | null;
    return saved === "dark" ? "dark" : "light";
  });

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem("bingo-theme", t);
    applyTheme(t);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme };
}
