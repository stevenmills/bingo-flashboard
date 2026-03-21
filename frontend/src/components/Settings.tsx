import { useEffect, useState, type ChangeEvent, type FocusEvent } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/api";
import {
  THEME_NAMES,
  LETTERS,
  DEFAULT_LED_LETTER_COLORS,
  type AppMode,
  type ColorMode,
  type Letter,
  type LedLetterColors,
} from "@/types";
import {
  BINGO_UI_THEME_LABELS,
  BINGO_UI_THEME_ORDER,
  isValidHexColor,
  rgbaFromHex,
  type BingoUiThemeId,
  type LetterColors,
} from "@/lib/bingo-ui-colors";

const STATIC_VALUE = "static";
const CUSTOM_LETTERS_VALUE = "custom_letters";
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
  ledVibrance: number;
  theme: number;
  colorMode: ColorMode;
  staticColor: string;
  ledHeaderColor: string;
  ledGameTypeColor: string;
  ledLetterColors: LedLetterColors;
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
  ledVibrance,
  theme,
  colorMode,
  staticColor,
  ledHeaderColor,
  ledGameTypeColor,
  ledLetterColors,
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
  const [isAdjustingBrightness, setIsAdjustingBrightness] = useState(false);
  const [localLedVibrance, setLocalLedVibrance] = useState(ledVibrance);
  const [isAdjustingLedVibrance, setIsAdjustingLedVibrance] = useState(false);
  const [localTheme, setLocalTheme] = useState(theme);
  const [localColorMode, setLocalColorMode] = useState<ColorMode>(colorMode);
  const [localColor, setLocalColor] = useState(staticColor);
  const [localLedHeaderColor, setLocalLedHeaderColor] = useState(ledHeaderColor);
  const [localLedGameTypeColor, setLocalLedGameTypeColor] = useState(ledGameTypeColor);
  const [localLedLetterColors, setLocalLedLetterColors] = useState<LedLetterColors>(ledLetterColors);
  const [currentBoardPin, setCurrentBoardPin] = useState("");
  const [nextBoardPin, setNextBoardPin] = useState("");
  const [pinMessage, setPinMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdjustingBrightness) {
      setLocalBrightnessPercent(rawToPercent(brightness));
    }
    if (!isAdjustingLedVibrance) {
      setLocalLedVibrance(ledVibrance);
    }
    setLocalTheme(theme);
    setLocalColorMode(colorMode);
    setLocalColor(staticColor);
    setLocalLedHeaderColor(ledHeaderColor);
    setLocalLedGameTypeColor(ledGameTypeColor);
    setLocalLedLetterColors(ledLetterColors);
  }, [brightness, ledVibrance, theme, colorMode, staticColor, ledHeaderColor, ledGameTypeColor, ledLetterColors, isAdjustingBrightness, isAdjustingLedVibrance]);

  // The select value: "0"–"7" for palettes, "static" for solid color
  const selectValue = localColorMode === "solid"
    ? STATIC_VALUE
    : localColorMode === "custom"
      ? CUSTOM_LETTERS_VALUE
      : String(localTheme);

  const handleBoardAuthFailure = (error: unknown) => {
    if (error instanceof Error && error.message.includes("401")) {
      window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
    }
  };

  const handleThemeChange = async (value: string) => {
    try {
      if (value === STATIC_VALUE) {
        setLocalColorMode("solid");
        await api.setColor(localColor);
      } else if (value === CUSTOM_LETTERS_VALUE) {
        setLocalColorMode("custom");
        await api.setLedLetterColors(localLedLetterColors);
      } else {
        const nextTheme = parseInt(value, 10);
        setLocalColorMode("theme");
        setLocalTheme(nextTheme);
        await api.setTheme(nextTheme);
      }
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
  };

  const updateLedLetterColor = async (letter: Letter, colorValue: string) => {
    const normalized = colorValue.startsWith("#") ? colorValue : `#${colorValue}`;
    const next = {
      ...localLedLetterColors,
      [letter]: normalized,
    };
    setLocalLedLetterColors(next);
    try {
      await api.setLedLetterColors(next);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
  };

  const handleLedCustomColorPicker =
    (letter: Letter) => async (e: ChangeEvent<HTMLInputElement>) => {
      await updateLedLetterColor(letter, e.target.value);
    };

  const handleLedCustomColorHex =
    (letter: Letter) => async (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      if (!isValidHexColor(next)) return;
      await updateLedLetterColor(letter, next);
    };

  const handleResetLedLetterColors = async () => {
    setLocalLedLetterColors(DEFAULT_LED_LETTER_COLORS);
    try {
      await api.setLedLetterColors(DEFAULT_LED_LETTER_COLORS);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
  };

  const handleBrightness = (value: number[]) => {
    const percent = value[0];
    setIsAdjustingBrightness(true);
    setLocalBrightnessPercent(percent);
  };

  const handleBrightnessCommit = async (value: number[]) => {
    const percent = value[0];
    setLocalBrightnessPercent(percent);
    try {
      await api.setBrightness(percentToRaw(percent));
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    } finally {
      setIsAdjustingBrightness(false);
    }
  };

  const handleLedVibrance = (value: number[]) => {
    const next = value[0];
    setIsAdjustingLedVibrance(true);
    setLocalLedVibrance(next);
  };

  const handleLedVibranceCommit = async (value: number[]) => {
    const next = value[0];
    setLocalLedVibrance(next);
    try {
      await api.setLedVibrance(next);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    } finally {
      setIsAdjustingLedVibrance(false);
    }
  };

  const handleColorPicker = async (e: ChangeEvent<HTMLInputElement>) => {
    setLocalColor(e.target.value);
    try {
      await api.setColor(e.target.value);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
  };

  const handleColorHex = async (e: ChangeEvent<HTMLInputElement>) => {
    setLocalColor(e.target.value);
    if (/^#?[0-9a-fA-F]{6}$/.test(e.target.value.replace("#", ""))) {
      try {
        await api.setColor(e.target.value);
        onRefresh();
      } catch (error) {
        handleBoardAuthFailure(error);
      }
    }
  };

  const handleLedHeaderColorPicker = async (e: ChangeEvent<HTMLInputElement>) => {
    setLocalLedHeaderColor(e.target.value);
    try {
      await api.setLedHeaderColor(e.target.value);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
  };

  const handleLedHeaderColorHex = async (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setLocalLedHeaderColor(next);
    if (!isValidHexColor(next)) return;
    try {
      await api.setLedHeaderColor(next);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
  };

  const handleLedGameTypeColorPicker = async (e: ChangeEvent<HTMLInputElement>) => {
    setLocalLedGameTypeColor(e.target.value);
    try {
      await api.setLedGameTypeColor(e.target.value);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
  };

  const handleLedGameTypeColorHex = async (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setLocalLedGameTypeColor(next);
    if (!isValidHexColor(next)) return;
    try {
      await api.setLedGameTypeColor(next);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
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
    try {
      await api.setLedTestMode(!ledTestMode);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
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
              onValueCommit={handleBrightnessCommit}
              accentColor={letterColors.N}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>LED Vibrance</Label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {localLedVibrance}%
              </span>
            </div>
            <Slider
              value={[localLedVibrance]}
              min={0}
              max={100}
              step={1}
              onValueChange={handleLedVibrance}
              onValueCommit={handleLedVibranceCommit}
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
                <SelectItem value={CUSTOM_LETTERS_VALUE}>Custom BINGO Letters</SelectItem>
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

          <div>
            <Label className="mb-2 block">BINGO Header LED Color</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={localLedHeaderColor.startsWith("#") ? localLedHeaderColor : `#${localLedHeaderColor}`}
                onChange={handleLedHeaderColorPicker}
                className="h-10 w-12 rounded-lg border border-input cursor-pointer p-0.5"
              />
              <Input
                value={localLedHeaderColor}
                onChange={handleLedHeaderColorHex}
                maxLength={7}
                className="w-28"
                placeholder="#ff0000"
                style={{ borderColor: letterColors.N }}
                onFocus={(e) => focusWithLetterN(e, letterColors.N)}
                onBlur={(e) => blurWithLetterN(e, letterColors.N)}
              />
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Game Type Indicator LED Color</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={localLedGameTypeColor.startsWith("#") ? localLedGameTypeColor : `#${localLedGameTypeColor}`}
                onChange={handleLedGameTypeColorPicker}
                className="h-10 w-12 rounded-lg border border-input cursor-pointer p-0.5"
              />
              <Input
                value={localLedGameTypeColor}
                onChange={handleLedGameTypeColorHex}
                maxLength={7}
                className="w-28"
                placeholder="#ffd8a8"
                style={{ borderColor: letterColors.N }}
                onFocus={(e) => focusWithLetterN(e, letterColors.N)}
                onBlur={(e) => blurWithLetterN(e, letterColors.N)}
              />
            </div>
          </div>

          {localColorMode === "custom" && (
            <div>
              <Label className="mb-3 block">LED letter colors (B/I/N/G/O)</Label>
              <div className="grid sm:grid-cols-2 gap-3">
                {LETTERS.map((letter) => (
                  <div key={letter} className="flex items-center gap-3">
                    <span className="w-5 text-sm font-semibold text-muted-foreground">{letter}</span>
                    <input
                      type="color"
                      value={localLedLetterColors[letter]}
                      onChange={handleLedCustomColorPicker(letter)}
                      className="h-10 w-12 rounded-lg border border-input cursor-pointer p-0.5"
                    />
                    <Input
                      value={localLedLetterColors[letter]}
                      onChange={handleLedCustomColorHex(letter)}
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
              <div className="mt-3">
                <Button type="button" variant="outline" onClick={() => void handleResetLedLetterColors()}>
                  Reset LED colors to defaults
                </Button>
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
              variant="default"
              onClick={handleLedTestToggle}
              className="text-white"
              style={{
                backgroundColor: ledTestMode ? letterColors.I : letterColors.N,
                borderColor: ledTestMode ? letterColors.I : letterColors.N,
              }}
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
