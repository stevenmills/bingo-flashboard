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
  DEFAULT_LED_BOARD_SECTION_ORDER,
  LED_BOARD_SECTION_LABELS,
  type AppMode,
  type ColorMode,
  type Letter,
  type LedBoardSection,
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
  screensaverEnabled?: boolean;
  screensaverText?: string;
  screensaverSpeedMs?: number;
  ledLetterColors: LedLetterColors;
  ledBoardSectionOrder: LedBoardSection[];
  wifiSsid?: string;
  wifiConfigured?: boolean;
  wifiConnected?: boolean;
  wifiMode?: "sta" | "ap";
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
  screensaverEnabled = false,
  screensaverText = "BINGO",
  screensaverSpeedMs = 90,
  ledLetterColors,
  ledBoardSectionOrder,
  wifiSsid = "",
  wifiConfigured = false,
  wifiConnected = false,
  wifiMode = "ap",
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
  const [localScreensaverEnabled, setLocalScreensaverEnabled] = useState(screensaverEnabled);
  const [localScreensaverText, setLocalScreensaverText] = useState(screensaverText);
  const [localScreensaverSpeedMs, setLocalScreensaverSpeedMs] = useState(screensaverSpeedMs);
  const [isAdjustingScreensaverSpeed, setIsAdjustingScreensaverSpeed] = useState(false);
  const [isEditingScreensaverText, setIsEditingScreensaverText] = useState(false);
  const [localLedLetterColors, setLocalLedLetterColors] = useState<LedLetterColors>(ledLetterColors);
  const [localLedBoardSectionOrder, setLocalLedBoardSectionOrder] = useState<LedBoardSection[]>(
    ledBoardSectionOrder.length === 3 ? ledBoardSectionOrder : DEFAULT_LED_BOARD_SECTION_ORDER
  );
  const [localWifiSsid, setLocalWifiSsid] = useState(wifiSsid);
  const [localWifiPassword, setLocalWifiPassword] = useState("");
  const [wifiMessage, setWifiMessage] = useState<string | null>(null);
  const [currentBoardPin, setCurrentBoardPin] = useState("");
  const [nextBoardPin, setNextBoardPin] = useState("");
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [editingHexField, setEditingHexField] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdjustingBrightness) {
      setLocalBrightnessPercent(rawToPercent(brightness));
    }
    if (!isAdjustingLedVibrance) {
      setLocalLedVibrance(ledVibrance);
    }
    setLocalTheme(theme);
    setLocalColorMode(colorMode);
    if (editingHexField !== "static") {
      setLocalColor(staticColor);
    }
    if (editingHexField !== "header") {
      setLocalLedHeaderColor(ledHeaderColor);
    }
    if (editingHexField !== "gameType") {
      setLocalLedGameTypeColor(ledGameTypeColor);
    }
    setLocalScreensaverEnabled(screensaverEnabled);
    if (!isEditingScreensaverText) {
      setLocalScreensaverText(screensaverText);
    }
    if (!isAdjustingScreensaverSpeed) {
      setLocalScreensaverSpeedMs(screensaverSpeedMs);
    }
    setLocalLedLetterColors((prev) => {
      const next = { ...ledLetterColors };
      for (const letter of LETTERS) {
        if (editingHexField === `led-${letter}`) {
          next[letter] = prev[letter];
        }
      }
      return next;
    });
    setLocalLedBoardSectionOrder(
      ledBoardSectionOrder.length === 3 ? ledBoardSectionOrder : DEFAULT_LED_BOARD_SECTION_ORDER
    );
    setLocalWifiSsid(wifiSsid);
  }, [
    brightness,
    ledVibrance,
    theme,
    colorMode,
    staticColor,
    ledHeaderColor,
    ledGameTypeColor,
    screensaverEnabled,
    screensaverText,
    screensaverSpeedMs,
    ledLetterColors,
    ledBoardSectionOrder,
    wifiSsid,
    isAdjustingBrightness,
    isAdjustingLedVibrance,
    isAdjustingScreensaverSpeed,
    isEditingScreensaverText,
    editingHexField,
  ]);

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
    (letter: Letter) => (e: ChangeEvent<HTMLInputElement>) => {
      setLocalLedLetterColors((prev) => ({
        ...prev,
        [letter]: e.target.value,
      }));
    };

  const commitLedLetterColorHex = async (letter: Letter, value: string) => {
    if (!isValidHexColor(value)) {
      setLocalLedLetterColors((prev) => ({
        ...prev,
        [letter]: ledLetterColors[letter],
      }));
      setEditingHexField(null);
      return;
    }
    try {
      await updateLedLetterColor(letter, value);
    } catch (error) {
      handleBoardAuthFailure(error);
    } finally {
      setEditingHexField(null);
    }
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

  const handleColorHex = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalColor(e.target.value);
  };

  const commitColorHex = async (value: string) => {
    if (!isValidHexColor(value)) {
      setLocalColor(staticColor);
      setEditingHexField(null);
      return;
    }
    try {
      await api.setColor(value);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    } finally {
      setEditingHexField(null);
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

  const handleLedHeaderColorHex = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalLedHeaderColor(e.target.value);
  };

  const commitLedHeaderColorHex = async (value: string) => {
    if (!isValidHexColor(value)) {
      setLocalLedHeaderColor(ledHeaderColor);
      setEditingHexField(null);
      return;
    }
    try {
      await api.setLedHeaderColor(value);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    } finally {
      setEditingHexField(null);
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

  const handleLedGameTypeColorHex = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalLedGameTypeColor(e.target.value);
  };

  const commitLedGameTypeColorHex = async (value: string) => {
    if (!isValidHexColor(value)) {
      setLocalLedGameTypeColor(ledGameTypeColor);
      setEditingHexField(null);
      return;
    }
    try {
      await api.setLedGameTypeColor(value);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    } finally {
      setEditingHexField(null);
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

  const handleScreensaverToggle = async () => {
    const next = !localScreensaverEnabled;
    setLocalScreensaverEnabled(next);
    try {
      await api.setScreensaverEnabled(next);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
  };

  const handleScreensaverTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalScreensaverText(e.target.value);
  };

  const commitScreensaverText = async () => {
    try {
      await api.setScreensaverText(localScreensaverText);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
  };

  const handleScreensaverSpeed = (value: number[]) => {
    setIsAdjustingScreensaverSpeed(true);
    setLocalScreensaverSpeedMs(value[0]);
  };

  const handleScreensaverSpeedCommit = async (value: number[]) => {
    const next = value[0];
    setLocalScreensaverSpeedMs(next);
    try {
      await api.setScreensaverSpeed(next);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    } finally {
      setIsAdjustingScreensaverSpeed(false);
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

  const handleLedBoardSectionAtPosition = async (position: 0 | 1 | 2, section: LedBoardSection) => {
    const next = [...localLedBoardSectionOrder];
    const existingIdx = next.indexOf(section);
    if (existingIdx >= 0) {
      next[existingIdx] = next[position];
    }
    next[position] = section;
    setLocalLedBoardSectionOrder(next);
    try {
      await api.setLedBoardSectionOrder(next);
      onRefresh();
    } catch (error) {
      handleBoardAuthFailure(error);
    }
  };

  const handleWifiSave = async () => {
    setWifiMessage(null);
    try {
      const result = await api.setWifiCredentials(
        localWifiSsid,
        localWifiPassword.length > 0 ? localWifiPassword : undefined
      );
      setLocalWifiPassword("");
      setWifiMessage(
        result && typeof result === "object" && "restartRequired" in result
          ? "WiFi saved. Power-cycle the board to apply."
          : "WiFi saved."
      );
      onRefresh();
    } catch {
      setWifiMessage("Unable to save WiFi settings.");
    }
  };

  const handleWifiClear = async () => {
    setWifiMessage(null);
    setLocalWifiSsid("");
    setLocalWifiPassword("");
    try {
      await api.setWifiCredentials("");
      setWifiMessage("WiFi cleared. Power-cycle the board to use device AP mode.");
      onRefresh();
    } catch {
      setWifiMessage("Unable to clear WiFi settings.");
    }
  };

  const boardSectionPositions: Array<{ label: string; index: 0 | 1 | 2 }> = [
    { label: "Left", index: 0 },
    { label: "Center", index: 1 },
    { label: "Right", index: 2 },
  ];

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
                  onFocus={(e) => {
                    setEditingHexField("static");
                    focusWithLetterN(e, letterColors.N);
                  }}
                  onBlur={(e) => {
                    blurWithLetterN(e, letterColors.N);
                    void commitColorHex(e.target.value);
                  }}
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
                onFocus={(e) => {
                  setEditingHexField("header");
                  focusWithLetterN(e, letterColors.N);
                }}
                onBlur={(e) => {
                  blurWithLetterN(e, letterColors.N);
                  void commitLedHeaderColorHex(e.target.value);
                }}
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
                onFocus={(e) => {
                  setEditingHexField("gameType");
                  focusWithLetterN(e, letterColors.N);
                }}
                onBlur={(e) => {
                  blurWithLetterN(e, letterColors.N);
                  void commitLedGameTypeColorHex(e.target.value);
                }}
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
                      onFocus={(e) => {
                        setEditingHexField(`led-${letter}`);
                        focusWithLetterN(e, letterColors.N);
                      }}
                      onBlur={(e) => {
                        blurWithLetterN(e, letterColors.N);
                        void commitLedLetterColorHex(letter, e.target.value);
                      }}
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

          <div className="rounded-md border border-border p-4 space-y-4">
            <div>
              <Label className="block">LED Board Section Order</Label>
              <p className="text-xs text-muted-foreground mb-3">
                Choose the left-to-right order of the game type matrix, letter headers, and number board on the physical LEDs.
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                {boardSectionPositions.map(({ label, index }) => (
                  <div key={label}>
                    <Label className="mb-2 block text-xs text-muted-foreground">{label}</Label>
                    <Select
                      value={localLedBoardSectionOrder[index]}
                      onValueChange={(value) => void handleLedBoardSectionAtPosition(index, value as LedBoardSection)}
                    >
                      <SelectTrigger
                        className="focus:ring-0 focus:ring-offset-0"
                        style={{ borderColor: letterColors.N }}
                        onFocus={(e) => focusSelectWithLetterN(e, letterColors.N)}
                        onBlur={(e) => blurSelectWithLetterN(e, letterColors.N)}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(LED_BOARD_SECTION_LABELS) as LedBoardSection[]).map((section) => (
                          <SelectItem key={section} value={section}>
                            {LED_BOARD_SECTION_LABELS[section]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </div>

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

          <div className="rounded-md border border-border p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="block">Screensaver Mode</Label>
                <p className="text-xs text-muted-foreground">
                  Always overrides board LEDs and scrolls text on the full 21x5 matrix.
                </p>
              </div>
              <Button
                type="button"
                variant="default"
                onClick={handleScreensaverToggle}
                className="text-white"
                style={{
                  backgroundColor: localScreensaverEnabled ? letterColors.I : letterColors.N,
                  borderColor: localScreensaverEnabled ? letterColors.I : letterColors.N,
                }}
              >
                {localScreensaverEnabled ? "Disable Screensaver" : "Enable Screensaver"}
              </Button>
            </div>
            <div>
              <Label className="mb-2 block">Screensaver Text</Label>
              <Input
                value={localScreensaverText}
                onChange={handleScreensaverTextChange}
                onBlur={(e) => {
                  blurWithLetterN(e, letterColors.N);
                  setIsEditingScreensaverText(false);
                  void commitScreensaverText();
                }}
                maxLength={80}
                placeholder="BINGO NIGHT"
                style={{ borderColor: letterColors.N }}
                onFocus={(e) => {
                  setIsEditingScreensaverText(true);
                  focusWithLetterN(e, letterColors.N);
                }}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Scroll Speed</Label>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {localScreensaverSpeedMs} ms
                </span>
              </div>
              <Slider
                value={[localScreensaverSpeedMs]}
                min={20}
                max={500}
                step={5}
                onValueChange={handleScreensaverSpeed}
                onValueCommit={handleScreensaverSpeedCommit}
                accentColor={letterColors.N}
              />
            </div>
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
            WiFi
          </h3>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              On power-up, the board connects to this network when configured. If connection fails, it falls back to the
              {" "}
              <span className="font-medium">BINGO</span>
              {" "}
              access point. Use
              {" "}
              <span className="font-medium">http://bingo.local</span>
              {" "}
              in either mode.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <Input
                value={localWifiSsid}
                onChange={(e) => setLocalWifiSsid(e.target.value)}
                placeholder="WiFi network name (SSID)"
                disabled={!boardAuthGranted}
                maxLength={32}
                style={{ borderColor: letterColors.N }}
                onFocus={(e) => focusWithLetterN(e, letterColors.N)}
                onBlur={(e) => blurWithLetterN(e, letterColors.N)}
              />
              <Input
                type="password"
                value={localWifiPassword}
                onChange={(e) => setLocalWifiPassword(e.target.value)}
                placeholder={wifiConfigured ? "New password (optional)" : "WiFi password"}
                disabled={!boardAuthGranted}
                maxLength={64}
                style={{ borderColor: letterColors.N }}
                onFocus={(e) => focusWithLetterN(e, letterColors.N)}
                onBlur={(e) => blurWithLetterN(e, letterColors.N)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => void handleWifiSave()}
                disabled={!boardAuthGranted}
                className="text-white"
                style={{ backgroundColor: letterColors.N }}
              >
                Save WiFi
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleWifiClear()}
                disabled={!boardAuthGranted || !wifiConfigured}
              >
                Clear WiFi
              </Button>
              <span className="text-xs text-muted-foreground">
                Current mode:
                {" "}
                {wifiMode === "sta" && wifiConnected ? "Connected to saved WiFi" : "Device access point"}
              </span>
              {wifiMessage && <span className="text-xs text-muted-foreground">{wifiMessage}</span>}
            </div>
          </div>
        </div>
      )}

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
