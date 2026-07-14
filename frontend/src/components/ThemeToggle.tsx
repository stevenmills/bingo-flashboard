import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import type { AppMode } from "@/types";

type Props = {
  appMode?: AppMode | null;
};

export function ThemeToggle({ appMode }: Props) {
  const mode =
    appMode ??
    (typeof sessionStorage !== "undefined"
      ? (sessionStorage.getItem("bingo-app-mode") as AppMode | null)
      : null);
  const { theme, setTheme } = useTheme(mode);
  const isDark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent"
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
