import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from "react";
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
  SCREENSAVER_TYPE_LABELS,
  type ScreensaverType,
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

function normalizeLedBoardSectionOrder(order?: LedBoardSection[]): LedBoardSection[] {
  return order?.length === 3 ? order : DEFAULT_LED_BOARD_SECTION_ORDER;
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
  settingsOpen?: boolean;
  brightness: number;
  ledVibrance: number;
  theme: number;
  colorMode: ColorMode;
  staticColor: string;
  ledHeaderColor: string;
  ledGameTypeColor: string;
  screensaverEnabled?: boolean;
  screensaverType?: ScreensaverType;
  screensaverText?: string;
  screensaverSpeedMs?: number;
  screensaverColor?: string;
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
  settingsOpen = true,
  brightness,
  ledVibrance,
  theme,
  colorMode,
  staticColor,
  ledHeaderColor,
  ledGameTypeColor,
  screensaverEnabled = false,
  screensaverType = "text",
  screensaverText = "BINGO",
  screensaverSpeedMs = 90,
  screensaverColor = "#00ff00",
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
  const [localLedVibrance, setLocalLedVibrance] = useState(ledVibrance);
  const [localTheme, setLocalTheme] = useState(theme);
  const [localColorMode, setLocalColorMode] = useState<ColorMode>(colorMode);
  const [localColor, setLocalColor] = useState(staticColor);
  const [localLedHeaderColor, setLocalLedHeaderColor] = useState(ledHeaderColor);
  const [localLedGameTypeColor, setLocalLedGameTypeColor] = useState(ledGameTypeColor);
  const [localScreensaverEnabled, setLocalScreensaverEnabled] = useState(screensaverEnabled);
  const [localScreensaverType, setLocalScreensaverType] = useState<ScreensaverType>(screensaverType);
  const [localScreensaverText, setLocalScreensaverText] = useState(screensaverText);
  const [localScreensaverSpeedMs, setLocalScreensaverSpeedMs] = useState(screensaverSpeedMs);
  const [localScreensaverColor, setLocalScreensaverColor] = useState(screensaverColor);
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
  const [localUiCustomColors, setLocalUiCustomColors] = useState(uiCustomColors);
  const wasSettingsOpenRef = useRef(settingsOpen);
  const serverStateRef = useRef({
    brightness,
    ledVibrance,
    theme,
    colorMode,
    staticColor,
    ledHeaderColor,
    ledGameTypeColor,
    screensaverEnabled,
    screensaverType,
    screensaverText,
    screensaverSpeedMs,
    screensaverColor,
    ledLetterColors,
    ledBoardSectionOrder,
    wifiSsid,
  });

  serverStateRef.current = {
    brightness,
    ledVibrance,
    theme,
    colorMode,
    staticColor,
    ledHeaderColor,
    ledGameTypeColor,
    screensaverEnabled,
    screensaverType,
    screensaverText,
    screensaverSpeedMs,
    screensaverColor,
    ledLetterColors,
    ledBoardSectionOrder,
    wifiSsid,
  };

  useEffect(() => {
    if (!settingsOpen) {
      wasSettingsOpenRef.current = false;
      setEditingHexField(null);
      setIsEditingScreensaverText(false);
      return;
    }
    if (wasSettingsOpenRef.current) return;

    const s = serverStateRef.current;
    setLocalBrightnessPercent(rawToPercent(s.brightness));
    setLocalLedVibrance(s.ledVibrance);
    setLocalTheme(s.theme);
    setLocalColorMode(s.colorMode);
    setLocalColor(s.staticColor);
    setLocalLedHeaderColor(s.ledHeaderColor);
    setLocalLedGameTypeColor(s.ledGameTypeColor);
    setLocalScreensaverEnabled(s.screensaverEnabled ?? false);
    setLocalScreensaverType(s.screensaverType ?? "text");
    setLocalScreensaverText(s.screensaverText ?? "BINGO");
    setLocalScreensaverSpeedMs(s.screensaverSpeedMs ?? 90);
    setLocalScreensaverColor(s.screensaverColor ?? "#00ff00");
    setLocalLedLetterColors(s.ledLetterColors);
    setLocalLedBoardSectionOrder(normalizeLedBoardSectionOrder(s.ledBoardSectionOrder));
    setLocalWifiSsid(s.wifiSsid ?? "");
    setLocalWifiPassword("");
    setLocalUiCustomColors(uiCustomColors);
    wasSettingsOpenRef.current = true;
  }, [settingsOpen, uiCustomColors]);

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

  const persistSetting = (fn: () => Promise<unknown>, onError?: (error: unknown) => void) => {
    void fn().catch((error) => {
      if (onError) onError(error);
      else handleBoardAuthFailure(error);
    });
  };

  const handleThemeChange = (value: string) => {
    if (value === STATIC_VALUE) {
      setLocalColorMode("solid");
      persistSetting(() => api.setColor(localColor));
      return;
    }
    if (value === CUSTOM_LETTERS_VALUE) {
      setLocalColorMode("custom");
      persistSetting(() => api.setLedLetterColors(localLedLetterColors));
      return;
    }
    const nextTheme = parseInt(value, 10);
    setLocalColorMode("theme");
    setLocalTheme(nextTheme);
    persistSetting(() => api.setTheme(nextTheme));
  };

  const updateLedLetterColor = (letter: Letter, colorValue: string) => {
    const normalized = colorValue.startsWith("#") ? colorValue : `#${colorValue}`;
    const next = {
      ...localLedLetterColors,
      [letter]: normalized,
    };
    setLocalLedLetterColors(next);
    persistSetting(() => api.setLedLetterColors(next));
  };

  const handleLedCustomColorPicker =
    (letter: Letter) => (e: ChangeEvent<HTMLInputElement>) => {
      void updateLedLetterColor(letter, e.target.value);
    };

  const handleLedCustomColorHex =
    (letter: Letter) => (e: ChangeEvent<HTMLInputElement>) => {
      setLocalLedLetterColors((prev) => ({
        ...prev,
        [letter]: e.target.value,
      }));
    };

  const commitLedLetterColorHex = (letter: Letter, value: string) => {
    if (!isValidHexColor(value)) {
      setLocalLedLetterColors((prev) => ({
        ...prev,
        [letter]: ledLetterColors[letter],
      }));
      setEditingHexField(null);
      return;
    }
    updateLedLetterColor(letter, value);
    setEditingHexField(null);
  };

  const handleResetLedLetterColors = () => {
    setLocalLedLetterColors(DEFAULT_LED_LETTER_COLORS);
    persistSetting(() => api.setLedLetterColors(DEFAULT_LED_LETTER_COLORS));
  };

  const handleBrightness = (value: number[]) => {
    setLocalBrightnessPercent(value[0]);
  };

  const handleBrightnessCommit = (value: number[]) => {
    const percent = value[0];
    setLocalBrightnessPercent(percent);
    persistSetting(() => api.setBrightness(percentToRaw(percent)));
  };

  const handleLedVibrance = (value: number[]) => {
    setLocalLedVibrance(value[0]);
  };

  const handleLedVibranceCommit = (value: number[]) => {
    const next = value[0];
    setLocalLedVibrance(next);
    persistSetting(() => api.setLedVibrance(next));
  };

  const handleColorPicker = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalColor(e.target.value);
    persistSetting(() => api.setColor(e.target.value));
  };

  const handleColorHex = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalColor(e.target.value);
  };

  const commitColorHex = (value: string) => {
    if (!isValidHexColor(value)) {
      setLocalColor(staticColor);
      setEditingHexField(null);
      return;
    }
    setLocalColor(value);
    persistSetting(() => api.setColor(value));
    setEditingHexField(null);
  };

  const handleLedHeaderColorPicker = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalLedHeaderColor(e.target.value);
    persistSetting(() => api.setLedHeaderColor(e.target.value));
  };

  const handleLedHeaderColorHex = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalLedHeaderColor(e.target.value);
  };

  const commitLedHeaderColorHex = (value: string) => {
    if (!isValidHexColor(value)) {
      setLocalLedHeaderColor(ledHeaderColor);
      setEditingHexField(null);
      return;
    }
    setLocalLedHeaderColor(value);
    persistSetting(() => api.setLedHeaderColor(value));
    setEditingHexField(null);
  };

  const handleLedGameTypeColorPicker = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalLedGameTypeColor(e.target.value);
    persistSetting(() => api.setLedGameTypeColor(e.target.value));
  };

  const handleLedGameTypeColorHex = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalLedGameTypeColor(e.target.value);
  };

  const commitLedGameTypeColorHex = (value: string) => {
    if (!isValidHexColor(value)) {
      setLocalLedGameTypeColor(ledGameTypeColor);
      setEditingHexField(null);
      return;
    }
    setLocalLedGameTypeColor(value);
    persistSetting(() => api.setLedGameTypeColor(value));
    setEditingHexField(null);
  };

  const handleUiThemeChange = (value: string) => {
    onUiColorThemeChange(value as BingoUiThemeId);
  };

  const handleUiCustomColorPicker =
    (letter: (typeof LETTERS)[number]) => (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setLocalUiCustomColors((prev) => ({ ...prev, [letter]: next }));
      onUiCustomColorChange(letter, next);
    };

  const handleUiCustomColorHex =
    (letter: (typeof LETTERS)[number]) => (e: ChangeEvent<HTMLInputElement>) => {
      setLocalUiCustomColors((prev) => ({ ...prev, [letter]: e.target.value }));
    };

  const commitUiCustomColorHex = (letter: (typeof LETTERS)[number], value: string) => {
    if (!isValidHexColor(value)) {
      setLocalUiCustomColors((prev) => ({ ...prev, [letter]: uiCustomColors[letter] }));
      setEditingHexField(null);
      return;
    }
    onUiCustomColorChange(letter, value);
    setEditingHexField(null);
  };

  const handleLedTestToggle = () => {
    persistSetting(() => api.setLedTestMode(!ledTestMode));
  };

  const handleScreensaverToggle = () => {
    const next = !localScreensaverEnabled;
    setLocalScreensaverEnabled(next);
    persistSetting(() => api.setScreensaverEnabled(next));
  };

  const handleScreensaverTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalScreensaverText(e.target.value);
  };

  const commitScreensaverText = () => {
    persistSetting(() => api.setScreensaverText(localScreensaverText));
  };

  const handleScreensaverSpeed = (value: number[]) => {
    setLocalScreensaverSpeedMs(value[0]);
  };

  const handleScreensaverSpeedCommit = (value: number[]) => {
    const next = value[0];
    setLocalScreensaverSpeedMs(next);
    persistSetting(() => api.setScreensaverSpeed(next));
  };

  const handleScreensaverTypeChange = (value: ScreensaverType) => {
    const previous = localScreensaverType;
    setLocalScreensaverType(value);
    persistSetting(() => api.setScreensaverType(value), (error) => {
      setLocalScreensaverType(previous);
      handleBoardAuthFailure(error);
    });
  };

  const handleScreensaverColorPicker = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalScreensaverColor(e.target.value);
    persistSetting(() => api.setScreensaverColor(e.target.value));
  };

  const handleScreensaverColorHex = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalScreensaverColor(e.target.value);
  };

  const commitScreensaverColorHex = (value: string) => {
    if (!isValidHexColor(value)) {
      setLocalScreensaverColor(screensaverColor);
      setEditingHexField(null);
      return;
    }
    const normalized = value.startsWith("#") ? value : `#${value}`;
    setLocalScreensaverColor(normalized);
    setEditingHexField(null);
    persistSetting(() => api.setScreensaverColor(normalized));
  };

  const screensaverDescription =
    localScreensaverType === "text"
      ? "Always overrides board LEDs and scrolls text on the full 21x5 matrix."
      : localScreensaverType === "rainbow"
        ? "Animated rainbow effect across the full 21x5 matrix."
        : "Solid color fill across the full 21x5 matrix.";

  const screensaverSpeedLabel =
    localScreensaverType === "text" ? "Scroll Speed" : "Animation Speed";

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

  const handleLedBoardSectionAtPosition = (position: 0 | 1 | 2, section: LedBoardSection) => {
    if (localLedBoardSectionOrder[position] === section) return;

    const previous = localLedBoardSectionOrder;
    const next = [...previous];
    const existingIdx = next.indexOf(section);
    if (existingIdx >= 0) {
      next[existingIdx] = next[position];
    }
    next[position] = section;

    setLocalLedBoardSectionOrder(next);
    persistSetting(() => api.setLedBoardSectionOrder(next), (error) => {
      setLocalLedBoardSectionOrder(previous);
      handleBoardAuthFailure(error);
    });
  };

  const handleWifiSave = () => {
    setWifiMessage(null);
    void api
      .setWifiCredentials(localWifiSsid, localWifiPassword.length > 0 ? localWifiPassword : undefined)
      .then((result) => {
        setLocalWifiPassword("");
        setWifiMessage(
          result && typeof result === "object" && "restartRequired" in result
            ? "WiFi saved. Power-cycle the board to apply."
            : "WiFi saved."
        );
      })
      .catch(() => {
        setWifiMessage("Unable to save WiFi settings.");
      });
  };

  const handleWifiClear = () => {
    setWifiMessage(null);
    setLocalWifiSsid("");
    setLocalWifiPassword("");
    void api
      .setWifiCredentials("")
      .then(() => {
        setWifiMessage("WiFi cleared. Power-cycle the board to use device AP mode.");
      })
      .catch(() => {
        setWifiMessage("Unable to clear WiFi settings.");
      });
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
                  {screensaverDescription}
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
              <Label className="mb-2 block">Screensaver Type</Label>
              <Select value={localScreensaverType} onValueChange={handleScreensaverTypeChange}>
                <SelectTrigger
                  className="w-full"
                  style={{ borderColor: letterColors.N }}
                  onFocus={(e) => focusSelectWithLetterN(e, letterColors.N)}
                  onBlur={(e) => blurSelectWithLetterN(e, letterColors.N)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(SCREENSAVER_TYPE_LABELS) as [ScreensaverType, string][]).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            {localScreensaverType === "text" && (
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
            )}
            {localScreensaverType === "solid" && (
            <div>
              <Label className="mb-2 block">Screensaver Color</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={localScreensaverColor.startsWith("#") ? localScreensaverColor : `#${localScreensaverColor}`}
                  onChange={handleScreensaverColorPicker}
                  className="h-10 w-12 rounded-lg border border-input cursor-pointer p-0.5"
                />
                <Input
                  value={localScreensaverColor}
                  onChange={handleScreensaverColorHex}
                  maxLength={7}
                  className="w-28"
                  placeholder="#00ff00"
                  style={{ borderColor: letterColors.N }}
                  onFocus={(e) => {
                    setEditingHexField("screensaver");
                    focusWithLetterN(e, letterColors.N);
                  }}
                  onBlur={(e) => {
                    blurWithLetterN(e, letterColors.N);
                    void commitScreensaverColorHex(e.target.value);
                  }}
                />
              </div>
            </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>{screensaverSpeedLabel}</Label>
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
                      value={localUiCustomColors[letter]}
                      onChange={handleUiCustomColorPicker(letter)}
                      className="h-10 w-12 rounded-lg border border-input cursor-pointer p-0.5"
                    />
                    <Input
                      value={localUiCustomColors[letter]}
                      onChange={handleUiCustomColorHex(letter)}
                      maxLength={7}
                      className="w-28"
                      placeholder="#3b82f6"
                      style={{ borderColor: letterColors.N }}
                      onFocus={(e) => {
                        setEditingHexField(`ui-${letter}`);
                        focusWithLetterN(e, letterColors.N);
                      }}
                      onBlur={(e) => {
                        blurWithLetterN(e, letterColors.N);
                        commitUiCustomColorHex(letter, e.target.value);
                      }}
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
