import { useEffect, useState, type ChangeEvent, type FocusEvent } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/api";
import { THEME_NAMES, type AppMode, type ColorMode } from "@/types";
import { LETTERS } from "@/types";
import {
  BINGO_UI_THEME_LABELS,
  BINGO_UI_THEME_ORDER,
  isValidHexColor,
  rgbaFromHex,
  type BingoUiThemeId,
  type LetterColors,
} from "@/lib/bingo-ui-colors";

const STATIC_VALUE = "static";
const MAX_BRIGHTNESS = 255;

function rawToPercent(raw: number): number {
  return Math.round((raw / MAX_BRIGHTNESS) * 100);
}

function percentToRaw(percent: number): number {
  return Math.round((percent / 100) * MAX_BRIGHTNESS);
}

function focusWithLetterN(e: FocusEvent<HTMLInputElement>, color: string) {
  e.currentTarget.style.borderColor = color;
  e.currentTarget.style.boxShadow = `0 0 0 2px ${rgbaFromHex(color, 0.35)}`;
}

function blurWithLetterN(e: FocusEvent<HTMLInputElement>, color: string) {
  e.currentTarget.style.borderColor = color;
  e.currentTarget.style.boxShadow = "";
}

function focusSelectWithLetterN(e: FocusEvent<HTMLButtonElement>, color: string) {
  e.currentTarget.style.borderColor = color;
  e.currentTarget.style.boxShadow = `0 0 0 2px ${rgbaFromHex(color, 0.35)}`;
}

function blurSelectWithLetterN(e: FocusEvent<HTMLButtonElement>, color: string) {
  e.currentTarget.style.borderColor = color;
  e.currentTarget.style.boxShadow = "";
}

interface Props {
  settingsMode: AppMode;
  brightness: number;
  theme: number;
  colorMode: ColorMode;
  staticColor: string;
  ledTestMode: boolean;
  boardAuthGranted: boolean;
  uiColorTheme: BingoUiThemeId;
  uiCustomColors: LetterColors;
  letterColors: LetterColors;
  onUiColorThemeChange: (theme: BingoUiThemeId) => void;
  onUiCustomColorChange: (letter: (typeof LETTERS)[number], color: string) => void;
  onRefresh: () => void;
}

export function Settings({
  settingsMode,
  brightness,
  theme,
  colorMode,
  staticColor,
  ledTestMode,
  boardAuthGranted,
  uiColorTheme,
  uiCustomColors,
  letterColors,
  onUiColorThemeChange,
  onUiCustomColorChange,
  onRefresh,
}: Props) {
  const [localBrightnessPercent, setLocalBrightnessPercent] = useState(rawToPercent(brightness));
  const [localTheme, setLocalTheme] = useState(theme);
  const [localColorMode, setLocalColorMode] = useState<ColorMode>(colorMode);
  const [localColor, setLocalColor] = useState(staticColor);
  const [currentBoardPin, setCurrentBoardPin] = useState("");
  const [nextBoardPin, setNextBoardPin] = useState("");
  const [pinMessage, setPinMessage] = useState<string | null>(null);

  useEffect(() => {
    setLocalBrightnessPercent(rawToPercent(brightness));
    setLocalTheme(theme);
    setLocalColorMode(colorMode);
    setLocalColor(staticColor);
  }, [brightness, theme, colorMode, staticColor]);

  // The select value: "0"–"7" for palettes, "static" for solid color
  const selectValue = localColorMode === "solid" ? STATIC_VALUE : String(localTheme);

  const handleThemeChange = async (value: string) => {
    if (value === STATIC_VALUE) {
      setLocalColorMode("solid");
      await api.setColor(localColor);
      onRefresh();
    } else {
      const nextTheme = parseInt(value, 10);
      setLocalColorMode("theme");
      setLocalTheme(nextTheme);
      await api.setTheme(nextTheme);
      onRefresh();
    }
  };

  const handleBrightness = async (value: number[]) => {
    const percent = value[0];
    setLocalBrightnessPercent(percent);
    await api.setBrightness(percentToRaw(percent));
    onRefresh();
  };

  const handleColorPicker = async (e: ChangeEvent<HTMLInputElement>) => {
    setLocalColor(e.target.value);
    await api.setColor(e.target.value);
    onRefresh();
  };

  const handleColorHex = async (e: ChangeEvent<HTMLInputElement>) => {
    setLocalColor(e.target.value);
    if (/^#?[0-9a-fA-F]{6}$/.test(e.target.value.replace("#", ""))) {
      await api.setColor(e.target.value);
      onRefresh();
    }
  };

  const handleUiThemeChange = (value: string) => {
    onUiColorThemeChange(value as BingoUiThemeId);
  };

  const handleUiCustomColorPicker =
    (letter: (typeof LETTERS)[number]) => (e: ChangeEvent<HTMLInputElement>) => {
      onUiCustomColorChange(letter, e.target.value);
    };

  const handleUiCustomColorHex =
    (letter: (typeof LETTERS)[number]) => (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      if (isValidHexColor(next)) {
        onUiCustomColorChange(letter, next);
      }
    };

  const handleLedTestToggle = async () => {
    await api.setLedTestMode(!ledTestMode);
    onRefresh();
  };

  const handleBoardPinChange = async () => {
    setPinMessage(null);
    try {
      await api.changeBoardPin(currentBoardPin, nextBoardPin);
      setCurrentBoardPin("");
      setNextBoardPin("");
      setPinMessage("Board PIN updated.");
    } catch {
      setPinMessage("Unable to update PIN.");
    }
  };

  return (
    <div className="space-y-6">
      {/* LEDs sub-section */}
      {settingsMode === "board" && (
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">LEDs</h3>
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Brightness</Label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {localBrightnessPercent}%
              </span>
            </div>
            <Slider
              value={[localBrightnessPercent]}
              min={0}
              max={100}
              step={1}
              onValueChange={handleBrightness}
              accentColor={letterColors.N}
            />
          </div>

          <div>
            <Label className="mb-2 block">Theme</Label>
            <Select value={selectValue} onValueChange={handleThemeChange}>
              <SelectTrigger
                className="focus:ring-0 focus:ring-offset-0"
                style={{ borderColor: letterColors.N }}
                onFocus={(e) => focusSelectWithLetterN(e, letterColors.N)}
                onBlur={(e) => blurSelectWithLetterN(e, letterColors.N)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_NAMES.map((name, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {name}
                  </SelectItem>
                ))}
                <SelectItem value={STATIC_VALUE}>Static</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Color picker — only visible when Static is selected */}
          {localColorMode === "solid" && (
            <div>
              <Label className="mb-2 block">Color</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={localColor.startsWith("#") ? localColor : `#${localColor}`}
                  onChange={handleColorPicker}
                  className="h-10 w-12 rounded-lg border border-input cursor-pointer p-0.5"
                />
                <Input
                  value={localColor}
                  onChange={handleColorHex}
                  maxLength={7}
                  className="w-28"
                  placeholder={letterColors.N}
                  style={{ borderColor: letterColors.N }}
                  onFocus={(e) => focusWithLetterN(e, letterColors.N)}
                  onBlur={(e) => blurWithLetterN(e, letterColors.N)}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="block">LED Board Test</Label>
              <p className="text-xs text-muted-foreground">
                Runs a repeating one-by-one LED verification sequence.
              </p>
            </div>
            <Button
              type="button"
              variant={ledTestMode ? "destructive" : "default"}
              onClick={handleLedTestToggle}
              className={ledTestMode ? undefined : "text-white"}
              style={ledTestMode ? undefined : { backgroundColor: letterColors.N }}
            >
              {ledTestMode ? "Disable LED Board Test" : "Enable LED Board Test"}
            </Button>
          </div>
        </div>
      </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          BINGO UI Colors
        </h3>
        <div className="space-y-5">
          <div>
            <Label className="mb-2 block">Theme</Label>
            <Select value={uiColorTheme} onValueChange={handleUiThemeChange}>
              <SelectTrigger
                className="focus:ring-0 focus:ring-offset-0"
                style={{ borderColor: letterColors.N }}
                onFocus={(e) => focusSelectWithLetterN(e, letterColors.N)}
                onBlur={(e) => blurSelectWithLetterN(e, letterColors.N)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BINGO_UI_THEME_ORDER.map((themeId) => (
                  <SelectItem key={themeId} value={themeId}>
                    {BINGO_UI_THEME_LABELS[themeId]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {uiColorTheme === "custom" && (
            <div>
              <Label className="mb-3 block">Custom letter colors</Label>
              <div className="grid sm:grid-cols-2 gap-3">
                {LETTERS.map((letter) => (
                  <div key={letter} className="flex items-center gap-3">
                    <span className="w-5 text-sm font-semibold text-muted-foreground">{letter}</span>
                    <input
                      type="color"
                      value={uiCustomColors[letter]}
                      onChange={handleUiCustomColorPicker(letter)}
                      className="h-10 w-12 rounded-lg border border-input cursor-pointer p-0.5"
                    />
                    <Input
                      value={uiCustomColors[letter]}
                      onChange={handleUiCustomColorHex(letter)}
                      maxLength={7}
                      className="w-28"
                      placeholder="#3b82f6"
                      style={{ borderColor: letterColors.N }}
                      onFocus={(e) => focusWithLetterN(e, letterColors.N)}
                      onBlur={(e) => blurWithLetterN(e, letterColors.N)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {settingsMode === "board" && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Board Access
          </h3>
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Input
                type="password"
                value={currentBoardPin}
                onChange={(e) => setCurrentBoardPin(e.target.value)}
                placeholder="Current PIN"
                disabled={!boardAuthGranted}
                style={{ borderColor: letterColors.N }}
                onFocus={(e) => focusWithLetterN(e, letterColors.N)}
                onBlur={(e) => blurWithLetterN(e, letterColors.N)}
              />
              <Input
                type="password"
                value={nextBoardPin}
                onChange={(e) => setNextBoardPin(e.target.value)}
                placeholder="New PIN"
                disabled={!boardAuthGranted}
                style={{ borderColor: letterColors.N }}
                onFocus={(e) => focusWithLetterN(e, letterColors.N)}
                onBlur={(e) => blurWithLetterN(e, letterColors.N)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={handleBoardPinChange}
                disabled={!boardAuthGranted || currentBoardPin.length < 1 || nextBoardPin.length < 4}
                className="text-white"
                style={{ backgroundColor: letterColors.N }}
              >
                Update Board PIN
              </Button>
              {pinMessage && <span className="text-xs text-muted-foreground">{pinMessage}</span>}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
