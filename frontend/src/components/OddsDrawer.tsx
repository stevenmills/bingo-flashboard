import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { GAME_TYPE_LABELS, type GameType } from "@/types";
import { buildOddsRows, formatProbability, type MonteCarloConfig } from "@/lib/odds";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DEFAULT_CONFIG: MonteCarloConfig = {
  opponents: 20,
  cardsPerOpponent: 1,
  trials: 5000,
};

const LIMITS = {
  opponents: { min: 0, max: 500 },
  cardsPerOpponent: { min: 1, max: 50 },
  trials: { min: 500, max: 50000 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameType: GameType;
  remaining: number;
  allowGameTypeSelect?: boolean;
  onGameTypeChange?: (gameType: GameType) => void;
}

const GAME_TYPES: GameType[] = [
  "traditional",
  "four_corners",
  "postage_stamp",
  "cover_all",
  "x",
  "y",
  "frame_outside",
  "frame_inside",
  "plus_sign",
  "field_goal",
];

export function OddsDrawer({
  open,
  onOpenChange,
  gameType,
  remaining,
  allowGameTypeSelect = false,
  onGameTypeChange,
}: Props) {
  const [config, setConfig] = useState<MonteCarloConfig>(DEFAULT_CONFIG);
  const rows = useMemo(() => {
    if (!open) return [];
    return buildOddsRows(gameType, remaining, config);
  }, [open, gameType, remaining, config]);

  const updateConfig = (key: keyof MonteCarloConfig, rawValue: string) => {
    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isNaN(parsed)) return;
    if (key === "opponents") {
      setConfig((prev) => ({
        ...prev,
        opponents: clamp(parsed, LIMITS.opponents.min, LIMITS.opponents.max),
      }));
      return;
    }
    if (key === "cardsPerOpponent") {
      setConfig((prev) => ({
        ...prev,
        cardsPerOpponent: clamp(parsed, LIMITS.cardsPerOpponent.min, LIMITS.cardsPerOpponent.max),
      }));
      return;
    }
    setConfig((prev) => ({
      ...prev,
      trials: clamp(parsed, LIMITS.trials.min, LIMITS.trials.max),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-auto right-0 top-0 h-full w-full max-w-sm translate-x-0 translate-y-0 grid-rows-[auto,minmax(0,1fr)] content-start rounded-none border-l data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-top-[0%] data-[state=open]:slide-in-from-top-[0%]">
        <DialogHeader>
          <DialogTitle>Odds</DialogTitle>
          <DialogDescription>
            {GAME_TYPE_LABELS[gameType]} • {remaining} numbers remaining
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-2 overflow-y-auto">
          <div className="rounded-md border p-3 space-y-3">
            <p className="text-xs text-muted-foreground">Estimated with Monte Carlo simulation.</p>
            {allowGameTypeSelect && (
              <div className="space-y-1">
                <Label htmlFor="odds-game-type" className="text-xs">
                  Game type
                </Label>
                <Select value={gameType} onValueChange={(value) => onGameTypeChange?.(value as GameType)}>
                  <SelectTrigger id="odds-game-type" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GAME_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {GAME_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="odds-opponents" className="text-xs">
                  Opponents
                </Label>
                <Input
                  id="odds-opponents"
                  type="number"
                  min={LIMITS.opponents.min}
                  max={LIMITS.opponents.max}
                  step={1}
                  value={config.opponents}
                  onChange={(e) => updateConfig("opponents", e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="odds-cards" className="text-xs">
                  Cards/opp
                </Label>
                <Input
                  id="odds-cards"
                  type="number"
                  min={LIMITS.cardsPerOpponent.min}
                  max={LIMITS.cardsPerOpponent.max}
                  step={1}
                  value={config.cardsPerOpponent}
                  onChange={(e) => updateConfig("cardsPerOpponent", e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="odds-trials" className="text-xs">
                  Trials
                </Label>
                <Input
                  id="odds-trials"
                  type="number"
                  min={LIMITS.trials.min}
                  max={LIMITS.trials.max}
                  step={500}
                  value={config.trials}
                  onChange={(e) => updateConfig("trials", e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>
          {remaining <= 0 && (
            <p className="text-xs text-muted-foreground">
              No numbers remaining. The simulation uses 100% only for already-complete states.
            </p>
          )}
          {rows.map((row) => (
            <div key={row.covered} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="text-sm">
                <span className="font-semibold">{row.covered} covered</span>
                <span className="text-muted-foreground"> • needs {row.needed}</span>
              </div>
              <span className="text-sm font-semibold tabular-nums">{formatProbability(row.probability)}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
