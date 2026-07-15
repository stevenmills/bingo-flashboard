import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ALL_GAME_TYPES,
  GAME_TYPE_BY_ID,
  GAME_TYPE_CATEGORIES,
  GAME_TYPE_LABELS,
  type GameType,
  type GameTypeCategoryId,
} from "@/types";
import { rgbaFromHex, type LetterColors, DEFAULT_LETTER_COLORS } from "@/lib/bingo-ui-colors";
import { Search } from "lucide-react";

interface Props {
  value: GameType | "";
  onChange: (gameType: GameType) => void;
  letterColors?: LetterColors;
  /** Optional id prefix for radio/label uniqueness across multiple pickers */
  idPrefix?: string;
  className?: string;
  /** Compact height for dialogs */
  maxListHeightClass?: string;
}

function MiniPreview({ cells, accent }: { cells: number[]; accent: string }) {
  const set = new Set(cells);
  return (
    <div className="grid grid-cols-5 gap-px w-9 h-9 shrink-0" aria-hidden>
      {Array.from({ length: 25 }, (_, i) => {
        const on = set.has(i + 1);
        return (
          <div
            key={i}
            className={cn("rounded-[1px]", on ? "" : "bg-muted")}
            style={on ? { backgroundColor: accent } : undefined}
          />
        );
      })}
    </div>
  );
}

export function GameTypePicker({
  value,
  onChange,
  letterColors = DEFAULT_LETTER_COLORS,
  idPrefix = "gt",
  className,
  maxListHeightClass = "max-h-[min(50dvh,22rem)]",
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<GameTypeCategoryId | "all">("all");
  const accent = letterColors.N;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ALL_GAME_TYPES.filter((id) => {
      const def = GAME_TYPE_BY_ID[id];
      if (category !== "all" && def.category !== category) return false;
      if (!q) return true;
      return (
        def.label.toLowerCase().includes(q) ||
        def.description.toLowerCase().includes(q) ||
        def.id.includes(q)
      );
    });
  }, [query, category]);

  const selected = value ? GAME_TYPE_BY_ID[value] : null;

  return (
    <div className={cn("space-y-3", className)}>
      {selected && (
        <div className="flex items-start gap-3 rounded-lg border p-2.5" style={{ borderColor: rgbaFromHex(accent, 0.45) }}>
          <MiniPreview cells={selected.displayPatterns[0] ?? []} accent={rgbaFromHex(accent, 0.95)} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">{selected.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{selected.description}</p>
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search game types…"
          className="h-9 pl-8 text-sm"
          aria-label="Search game types"
        />
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
        <button
          type="button"
          onClick={() => setCategory("all")}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
            category === "all" ? "text-white" : "border-border text-muted-foreground"
          )}
          style={
            category === "all"
              ? { backgroundColor: accent, borderColor: accent }
              : undefined
          }
        >
          All
        </button>
        {GAME_TYPE_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              category === cat.id ? "text-white" : "border-border text-muted-foreground"
            )}
            style={
              category === cat.id
                ? { backgroundColor: accent, borderColor: accent }
                : undefined
            }
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className={cn("overflow-y-auto overscroll-contain rounded-lg border", maxListHeightClass)} role="listbox" aria-label="Game types">
        {filtered.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">No matching game types.</p>
        ) : (
          <div className="divide-y">
            {filtered.map((id) => {
              const def = GAME_TYPE_BY_ID[id];
              const selectedRow = value === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={selectedRow}
                  id={`${idPrefix}-${id}`}
                  onClick={() => onChange(id)}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-muted/60",
                    selectedRow && "bg-muted/80"
                  )}
                  style={
                    selectedRow
                      ? { boxShadow: `inset 3px 0 0 ${accent}` }
                      : undefined
                  }
                >
                  <MiniPreview cells={def.displayPatterns[0] ?? []} accent={rgbaFromHex(accent, selectedRow ? 0.95 : 0.7)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label htmlFor={`${idPrefix}-${id}`} className="cursor-pointer text-sm font-medium leading-tight">
                        {GAME_TYPE_LABELS[id]}
                      </Label>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {GAME_TYPE_CATEGORIES.find((c) => c.id === def.category)?.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{def.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {filtered.length} of {ALL_GAME_TYPES.length} types
      </p>
    </div>
  );
}
