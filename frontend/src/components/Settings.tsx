import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { api } from "@/api";
import { isBoardAuthHttpError } from "@/lib/board-auth";
import { CALLER_EXAMPLE_CLIP, CALLER_VOICES, callerClipUrl, type CallerVoiceId } from "@/lib/caller-voices";
import type { RefreshOptions } from "@/hooks/useGameState";
import {
  THEME_NAMES,
  LETTERS,
  DEFAULT_LED_LETTER_COLORS,
  SCREENSAVER_TYPE_DESCRIPTIONS,
  SCREENSAVER_TYPE_LABELS,
  LETTER_FULL_MODE_LABELS,
  CURRENT_NUMBER_EFFECT_LABELS,
  type ScreensaverType,
  type AppMode,
  type ColorMode,
  type Letter,
  type LetterFullMode,
  type CurrentNumberEffect,
  type LedLetterColors,
  type GameStyle,
} from "@/types";
import {
  BINGO_UI_THEME_LABELS,
  BINGO_UI_THEME_ORDER,
  isValidHexColor,
  rgbaFromHex,
  type BingoUiThemeId,
  type LetterColors,
} from "@/lib/bingo-ui-colors";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import { GAME_STYLES, GAME_STYLE_LABELS } from "@/lib/game-style";
import { Check, Copy, FileStack, Lightbulb, Lock, MonitorPlay, Palette, Play, Power, RefreshCw, Square, Volume2, Webhook, Wifi, X } from "lucide-react";
import { buildCardClaimUrl, generateSignedPrintableCards } from "@/lib/bingo-card-codec";

const STATIC_VALUE = "static";
const CUSTOM_LETTERS_VALUE = "custom_letters";
const MAX_BRIGHTNESS = 255;

type SettingsTabId = "leds" | "screensaver" | "ui" | "caller" | "cards" | "wifi" | "webhooks" | "access";

function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function SettingsGroup({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-4 rounded-xl border border-border/80 bg-muted/20 p-4",
        className
      )}
    >
      {(title || description) && (
        <div className="shrink-0">
          {title ? <Label className="text-sm font-medium">{title}</Label> : null}
          {description ? (
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
          ) : null}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col justify-evenly gap-4">{children}</div>
    </div>
  );
}

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
  letterFullMode?: LetterFullMode;
  currentNumberEffect?: CurrentNumberEffect;
  currentNumberColor?: string;
  calledNumberBanner?: boolean;
  winnerEffect?: ScreensaverType;
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
  callerSpeechRate?: number;
  onCallerSpeechRateChange?: (rate: number) => void;
  callerVoice?: CallerVoiceId;
  onCallerVoiceChange?: (voice: CallerVoiceId) => void;
  onClose?: () => void;
  onRefresh: (options?: RefreshOptions) => void;
  /** Board game style — used as the default for printable card packs. */
  gameStyle?: GameStyle;
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
  letterFullMode = "on",
  currentNumberEffect = "flash",
  currentNumberColor = "#ffffff",
  calledNumberBanner = false,
  winnerEffect = "sparkle",
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
  callerSpeechRate = 0.85,
  onCallerSpeechRateChange,
  callerVoice = "Female1",
  onCallerVoiceChange,
  onClose,
  onRefresh,
  gameStyle = "bingo",
}: Props) {
  const [localBrightnessPercent, setLocalBrightnessPercent] = useState(rawToPercent(brightness));
  const [localLedVibrance, setLocalLedVibrance] = useState(ledVibrance);
  const [localCallerSpeechRate, setLocalCallerSpeechRate] = useState(callerSpeechRate);
  const [localCallerVoice, setLocalCallerVoice] = useState<CallerVoiceId>(callerVoice);
  const [callerExamplePlaying, setCallerExamplePlaying] = useState(false);
  const callerExampleAudioRef = useRef<HTMLAudioElement | null>(null);
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
  const [screensaverSaving, setScreensaverSaving] = useState(false);
  const screensaverSavingRef = useRef(false);
  const [isEditingScreensaverText, setIsEditingScreensaverText] = useState(false);
  const [localLedLetterColors, setLocalLedLetterColors] = useState<LedLetterColors>(ledLetterColors);
  const [localLetterFullMode, setLocalLetterFullMode] = useState<LetterFullMode>(letterFullMode);
  const [localCurrentNumberEffect, setLocalCurrentNumberEffect] =
    useState<CurrentNumberEffect>(currentNumberEffect);
  const [localCurrentNumberColor, setLocalCurrentNumberColor] = useState(currentNumberColor);
  const [localCalledNumberBanner, setLocalCalledNumberBanner] = useState(calledNumberBanner);
  const [localWinnerEffect, setLocalWinnerEffect] = useState<ScreensaverType>(winnerEffect);
  const [localWebhookNumberUrl, setLocalWebhookNumberUrl] = useState("");
  const [localWebhookBingoUrl, setLocalWebhookBingoUrl] = useState("");
  const [webhooksLoaded, setWebhooksLoaded] = useState(false);
  const [webhooksMessage, setWebhooksMessage] = useState<string | null>(null);
  const [localWifiSsid, setLocalWifiSsid] = useState(wifiSsid);
  const [localWifiPassword, setLocalWifiPassword] = useState("");
  const [wifiMessage, setWifiMessage] = useState<string | null>(null);
  const [wifiNetworks, setWifiNetworks] = useState<
    Array<{ ssid: string; rssi: number; secure: boolean }>
  >([]);
  const [wifiScanBusy, setWifiScanBusy] = useState(false);
  const [cardCountDraft, setCardCountDraft] = useState("4");
  const [cardPackStyle, setCardPackStyle] = useState<GameStyle>(gameStyle);
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardsMessage, setCardsMessage] = useState<string | null>(null);
  const [cardShareLinks, setCardShareLinks] = useState<Array<{ label: string; url: string }> | null>(null);
  const [cardCopyKey, setCardCopyKey] = useState<string | null>(null);
  const [currentBoardPin, setCurrentBoardPin] = useState("");
  const [nextBoardPin, setNextBoardPin] = useState("");
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const [editingHexField, setEditingHexField] = useState<string | null>(null);
  const [localUiCustomColors, setLocalUiCustomColors] = useState(uiCustomColors);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>(
    settingsMode === "board" ? "leds" : "ui"
  );
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
    letterFullMode,
    currentNumberEffect,
    currentNumberColor,
    calledNumberBanner,
    winnerEffect,
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
    letterFullMode,
    currentNumberEffect,
    currentNumberColor,
    calledNumberBanner,
    winnerEffect,
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
    setLocalLetterFullMode(s.letterFullMode ?? "on");
    setLocalCurrentNumberEffect(s.currentNumberEffect ?? "flash");
    setLocalCurrentNumberColor(s.currentNumberColor ?? "#ffffff");
    setLocalCalledNumberBanner(Boolean(s.calledNumberBanner));
    setLocalWinnerEffect(s.winnerEffect ?? "sparkle");
    setLocalWifiSsid(s.wifiSsid ?? "");
    setLocalWifiPassword("");
    setWebhooksLoaded(false);
    setWebhooksMessage(null);
    setLocalUiCustomColors(uiCustomColors);
    setLocalCallerSpeechRate(callerSpeechRate);
    setLocalCallerVoice(callerVoice);
    wasSettingsOpenRef.current = true;
  }, [settingsOpen, uiCustomColors, callerSpeechRate, callerVoice]);

  const stopCallerExample = () => {
    const audio = callerExampleAudioRef.current;
    if (audio) {
      try {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch {
        // Ignore.
      }
    }
    setCallerExamplePlaying(false);
  };

  const playCallerExample = () => {
    stopCallerExample();
    if (typeof Audio === "undefined") return;
    const audio = callerExampleAudioRef.current ?? new Audio();
    callerExampleAudioRef.current = audio;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    try {
      audio.playbackRate = localCallerSpeechRate;
      audio.volume = 1;
    } catch {
      // Ignore unsupported rate.
    }
    audio.src = callerClipUrl(localCallerVoice, CALLER_EXAMPLE_CLIP);
    setCallerExamplePlaying(true);
    audio.onended = () => setCallerExamplePlaying(false);
    audio.onerror = () => setCallerExamplePlaying(false);
    void audio.play().catch(() => setCallerExamplePlaying(false));
  };

  useEffect(() => {
    if (!settingsOpen) stopCallerExample();
  }, [settingsOpen]);

  useEffect(() => {
    stopCallerExample();
  }, [localCallerVoice]);

  useEffect(() => {
    const audio = callerExampleAudioRef.current;
    if (!audio || !callerExamplePlaying) return;
    try {
      audio.playbackRate = localCallerSpeechRate;
    } catch {
      // Ignore.
    }
  }, [callerExamplePlaying, localCallerSpeechRate]);

  useEffect(() => {
    return () => stopCallerExample();
  }, []);

  // The select value: "0"–"7" for palettes, "static" for solid color
  const selectValue = localColorMode === "solid"
    ? STATIC_VALUE
    : localColorMode === "custom"
      ? CUSTOM_LETTERS_VALUE
      : String(localTheme);

  const handleBoardAuthFailure = (error: unknown) => {
    if (isBoardAuthHttpError(error)) {
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
    if (screensaverSavingRef.current) return;
    const next = !localScreensaverEnabled;
    screensaverSavingRef.current = true;
    setScreensaverSaving(true);
    setLocalScreensaverEnabled(next);

    const applyResult = (state?: { screensaverEnabled?: boolean }) => {
      if (typeof state?.screensaverEnabled === "boolean") {
        setLocalScreensaverEnabled(state.screensaverEnabled);
      }
      onRefresh({ force: true });
    };

    const attempt = () => api.setScreensaverEnabled(next);

    void attempt()
      .then(applyResult)
      .catch(async (error: unknown) => {
        if (isBoardAuthHttpError(error)) {
          try {
            await api.refreshBoardAuth();
            applyResult(await attempt());
            return;
          } catch (retryError: unknown) {
            setLocalScreensaverEnabled(!next);
            handleBoardAuthFailure(retryError);
            return;
          }
        }
        setLocalScreensaverEnabled(!next);
        handleBoardAuthFailure(error);
      })
      .finally(() => {
        screensaverSavingRef.current = false;
        setScreensaverSaving(false);
      });
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

  const screensaverDescription = SCREENSAVER_TYPE_DESCRIPTIONS[localScreensaverType];

  const screensaverSpeedLabel =
    localScreensaverType === "text" ? "Scroll Speed" : "Animation Speed";

  const boardTabs = useMemo(() => {
    const tabs: Array<{ id: SettingsTabId; label: string; icon: ReactNode }> = [
      { id: "leds", label: "LEDs", icon: <Lightbulb className="h-3.5 w-3.5" /> },
      { id: "screensaver", label: "Screensaver", icon: <MonitorPlay className="h-3.5 w-3.5" /> },
      { id: "ui", label: "UI Colors", icon: <Palette className="h-3.5 w-3.5" /> },
    ];
    if (onCallerSpeechRateChange || onCallerVoiceChange) {
      tabs.push({ id: "caller", label: "Caller", icon: <Volume2 className="h-3.5 w-3.5" /> });
    }
    tabs.push(
      { id: "cards", label: "Cards", icon: <FileStack className="h-3.5 w-3.5" /> },
      { id: "wifi", label: "WiFi", icon: <Wifi className="h-3.5 w-3.5" /> },
      { id: "webhooks", label: "Webhooks", icon: <Webhook className="h-3.5 w-3.5" /> },
      { id: "access", label: "Access", icon: <Lock className="h-3.5 w-3.5" /> }
    );
    return tabs;
  }, [onCallerSpeechRateChange, onCallerVoiceChange]);

  const parseCardCount = () => {
    const parsed = Number.parseInt(cardCountDraft, 10);
    const count = Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 4;
    setCardCountDraft(String(count));
    return count;
  };

  const copyCardText = async (text: string, key: string) => {
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      setCardsMessage("Unable to copy. Try selecting the link manually.");
      return;
    }
    setCardsMessage(null);
    setCardCopyKey(key);
    window.setTimeout(() => {
      setCardCopyKey((prev) => (prev === key ? null : prev));
    }, 1600);
  };

  const handleGenerateBingoCards = async () => {
    const count = parseCardCount();
    setCardsBusy(true);
    setCardsMessage(null);
    try {
      const { deviceId } = await api.getDeviceId();
      const cards = await generateSignedPrintableCards(count, deviceId, cardPackStyle);
      const { buildBingoCardsPdf, downloadBlob } = await import("@/lib/bingo-cards-pdf");
      const blob = await buildBingoCardsPdf(cards, "http://bingo.local");
      const sheets = Math.ceil(cards.length / 4);
      const prefix = cardPackStyle === "housey" ? "housey-cards" : "bingo-cards";
      downloadBlob(blob, `${prefix}-${cards.length}.pdf`);
      setCardsMessage(
        `Downloaded ${cards.length} unique authenticated ${cardPackStyle.toUpperCase()} card${cards.length === 1 ? "" : "s"} across ${sheets} sheet${sheets === 1 ? "" : "s"} (4 per page).`
      );
    } catch (e: unknown) {
      if (isBoardAuthHttpError(e)) {
        window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
        setCardsMessage("Board auth required to generate signed cards.");
      } else {
        setCardsMessage("Unable to generate PDF. Try again.");
      }
    } finally {
      setCardsBusy(false);
    }
  };

  const handleGenerateCardLinks = async () => {
    const count = parseCardCount();
    setCardsBusy(true);
    setCardsMessage(null);
    try {
      const { deviceId } = await api.getDeviceId();
      const cards = await generateSignedPrintableCards(count, deviceId, cardPackStyle);
      setCardShareLinks(
        cards.map((card, i) => ({
          label: `Card ${i + 1}`,
          url: buildCardClaimUrl(card.numbers, "http://bingo.local", card.sig, cardPackStyle),
        }))
      );
      setCardsMessage(
        `Ready: ${count} unique authenticated ${cardPackStyle.toUpperCase()} link${count === 1 ? "" : "s"}. Copy one or copy all to text people.`
      );
    } catch (e: unknown) {
      if (isBoardAuthHttpError(e)) {
        window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
        setCardsMessage("Board auth required to generate signed links.");
      } else {
        setCardsMessage("Unable to generate links. Try again.");
      }
    } finally {
      setCardsBusy(false);
    }
  };

  useEffect(() => {
    setCardPackStyle(gameStyle);
  }, [gameStyle]);

  useEffect(() => {
    if (settingsTab === "webhooks") loadWebhooks();
  }, [settingsTab, boardAuthGranted]);

  useEffect(() => {
    if (settingsMode !== "board") {
      setSettingsTab("ui");
      return;
    }
    setSettingsTab((prev) => {
      if (prev === "caller" && !onCallerSpeechRateChange && !onCallerVoiceChange) return "leds";
      if (boardTabs.some((tab) => tab.id === prev)) return prev;
      return "leds";
    });
  }, [settingsMode, onCallerSpeechRateChange, onCallerVoiceChange, boardTabs]);

  const handleLetterFullMode = (mode: LetterFullMode) => {
    if (mode === localLetterFullMode) return;
    const previous = localLetterFullMode;
    setLocalLetterFullMode(mode);
    persistSetting(() => api.setLetterFullMode(mode), (error) => {
      setLocalLetterFullMode(previous);
      handleBoardAuthFailure(error);
    });
  };

  const handleCurrentNumberEffect = (effect: CurrentNumberEffect) => {
    if (effect === localCurrentNumberEffect) return;
    const previous = localCurrentNumberEffect;
    setLocalCurrentNumberEffect(effect);
    persistSetting(() => api.setCurrentNumberEffect(effect), (error) => {
      setLocalCurrentNumberEffect(previous);
      handleBoardAuthFailure(error);
    });
  };

  const handleCurrentNumberColor = (value: string) => {
    setLocalCurrentNumberColor(value);
    persistSetting(() => api.setCurrentNumberColor(value));
  };

  const handleCurrentNumberColorHexCommit = (value: string) => {
    if (!isValidHexColor(value)) {
      setLocalCurrentNumberColor(serverStateRef.current.currentNumberColor ?? "#ffffff");
      setEditingHexField(null);
      return;
    }
    const normalized = value.startsWith("#") ? value : `#${value}`;
    setLocalCurrentNumberColor(normalized);
    setEditingHexField(null);
    persistSetting(() => api.setCurrentNumberColor(normalized));
  };

  const handleCalledNumberBannerToggle = () => {
    const next = !localCalledNumberBanner;
    setLocalCalledNumberBanner(next);
    persistSetting(() => api.setCalledNumberBanner(next), (error) => {
      setLocalCalledNumberBanner(!next);
      handleBoardAuthFailure(error);
    });
  };

  const handleWinnerEffectChange = (value: ScreensaverType) => {
    if (value === localWinnerEffect) return;
    const previous = localWinnerEffect;
    setLocalWinnerEffect(value);
    persistSetting(() => api.setWinnerEffect(value), (error) => {
      setLocalWinnerEffect(previous);
      handleBoardAuthFailure(error);
    });
  };

  const loadWebhooks = () => {
    if (!boardAuthGranted || webhooksLoaded) return;
    void api
      .getWebhooks()
      .then((settings) => {
        setLocalWebhookNumberUrl(settings.numberCalledUrl ?? "");
        setLocalWebhookBingoUrl(settings.bingoUrl ?? "");
        setWebhooksLoaded(true);
      })
      .catch((error: unknown) => {
        handleBoardAuthFailure(error);
        setWebhooksMessage("Unable to load webhook settings.");
      });
  };

  const handleWebhooksSave = () => {
    setWebhooksMessage(null);
    void api
      .setWebhooks({
        numberCalledUrl: localWebhookNumberUrl.trim(),
        bingoUrl: localWebhookBingoUrl.trim(),
      })
      .then(() => {
        setWebhooksMessage("Webhooks saved.");
        onRefresh({ force: true });
      })
      .catch((error: unknown) => {
        handleBoardAuthFailure(error);
        setWebhooksMessage("Unable to save webhooks.");
      });
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

  const handleBoardRestart = () => {
    if (!boardAuthGranted || restartBusy) return;
    const ok = window.confirm(
      "Restart the bingo board now? The page will disconnect briefly while it reboots."
    );
    if (!ok) return;
    setRestartMessage(null);
    setRestartBusy(true);
    void api
      .restartBoard()
      .then(() => {
        setRestartMessage("Restarting… reconnect when the board comes back.");
      })
      .catch(() => {
        setRestartBusy(false);
        setRestartMessage("Unable to restart the board.");
      });
  };

  const handleWifiSave = () => {
    setWifiMessage(null);
    const ssid = localWifiSsid.trim();
    if (ssid.length > 0 && !wifiConfigured && localWifiPassword.length === 0) {
      setWifiMessage("Enter the WiFi password to save a new network.");
      return;
    }
    void api
      .setWifiCredentials(ssid, localWifiPassword.length > 0 ? localWifiPassword : undefined)
      .then((result) => {
        setLocalWifiPassword("");
        setWifiMessage(
          result && typeof result === "object" && "restartRequired" in result
            ? "WiFi saved. Power-cycle the board to apply."
            : "WiFi saved."
        );
      })
      .catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error ?? "");
        if (msg.includes("500") || /nvs/i.test(msg)) {
          setWifiMessage("Unable to save WiFi to flash (NVS). Try again after a power-cycle.");
        } else {
          setWifiMessage("Unable to save WiFi settings.");
        }
      });
  };

  const handleWifiScan = () => {
    if (!boardAuthGranted || wifiScanBusy) return;
    setWifiScanBusy(true);
    setWifiMessage(null);
    void api
      .scanWifiNetworks()
      .then((result) => {
        const networks = result.networks ?? [];
        setWifiNetworks(networks);
        if (networks.length === 0) {
          setWifiMessage("No networks found. Move closer to the router and scan again.");
        } else {
          setWifiMessage(`Found ${networks.length} network${networks.length === 1 ? "" : "s"}.`);
        }
        if (!localWifiSsid && networks[0]) {
          setLocalWifiSsid(networks[0].ssid);
        }
      })
      .catch((error: unknown) => {
        if (isBoardAuthHttpError(error)) {
          window.dispatchEvent(new CustomEvent("bingo:board-auth-invalid"));
        }
        setWifiMessage("Unable to scan for WiFi networks.");
      })
      .finally(() => setWifiScanBusy(false));
  };

  useEffect(() => {
    if (!settingsOpen || settingsMode !== "board") return;
    if (settingsTab !== "wifi") return;
    if (!boardAuthGranted) return;
    if (wifiNetworks.length > 0 || wifiScanBusy) return;
    handleWifiScan();
    // Auto-scan once when opening the WiFi tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, settingsMode, settingsTab, boardAuthGranted]);

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

  return (
    <div className="space-y-4">
      {onClose ? (
        <div className="hidden md:flex items-center justify-between gap-3 border-b border-border/70 pb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
            <p className="text-sm text-muted-foreground">Choose a section, then adjust options on the right.</p>
          </div>
          <button
            type="button"
            className="h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center justify-center transition-colors"
            aria-label="Close settings"
            title="Close settings"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : null}
      {settingsMode === "board" ? (
        <Tabs
          value={settingsTab}
          onValueChange={(value) => setSettingsTab(value as SettingsTabId)}
          className="w-full md:flex md:items-start md:gap-6"
        >
          <TabsList
            className={cn(
              "h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1.5",
              // Mobile: sticky horizontal strip
              "sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/70",
              // Desktop: fixed-width vertical sidebar
              "md:sticky md:top-16 md:w-48 md:shrink-0 md:flex-col md:items-stretch md:overflow-visible md:self-start"
            )}
          >
            {boardTabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  "shrink-0 gap-1.5 px-3 py-2 data-[state=active]:shadow-sm",
                  "md:w-full md:justify-start"
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="min-w-0 flex-1 pt-3 md:pt-0">
          <TabsContent value="leds" className="mt-0 outline-none">
            <SettingsPanel
              title="Board LEDs"
              description="Brightness, themes, and how LEDs look during a game."
            >
              <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
              <SettingsGroup title="Brightness & vibrance">
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
              </SettingsGroup>

              <SettingsGroup title="Theme & colors">
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

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="mb-2 block">BINGO Header LED</Label>
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
                        placeholder="#ffd8a8"
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
                    <Label className="mb-2 block">Game Type LED</Label>
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
              </SettingsGroup>

              <SettingsGroup
                title="Completed letter LED"
                description="When all 15 numbers for a letter are called. Partial columns still use the header color."
              >
                <Select
                  value={localLetterFullMode}
                  onValueChange={(value) => void handleLetterFullMode(value as LetterFullMode)}
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
                    {(Object.keys(LETTER_FULL_MODE_LABELS) as LetterFullMode[]).map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {LETTER_FULL_MODE_LABELS[mode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsGroup>

              <SettingsGroup
                title="Called number banner"
                description="When a number is called, briefly show letter + digits centered across the number and game-type LEDs using the number theme color, then return to the normal board."
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="block">Called Number Banner</Label>
                    <p className="text-xs text-muted-foreground">Shows for 3 seconds after each call.</p>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    onClick={handleCalledNumberBannerToggle}
                    className="shrink-0 text-white"
                    style={{
                      backgroundColor: localCalledNumberBanner ? letterColors.I : letterColors.N,
                      borderColor: localCalledNumberBanner ? letterColors.I : letterColors.N,
                    }}
                  >
                    {localCalledNumberBanner ? "Disable" : "Enable"}
                  </Button>
                </div>
              </SettingsGroup>

              <SettingsGroup
                title="Winner effect"
                description="Full-board LED effect used when a bingo is declared (before the WINNER scroll). Same catalog as screensavers."
              >
                <Select
                  value={localWinnerEffect}
                  onValueChange={(value) => handleWinnerEffectChange(value as ScreensaverType)}
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
                    {Object.entries(SCREENSAVER_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {SCREENSAVER_TYPE_DESCRIPTIONS[localWinnerEffect]}
                </p>
              </SettingsGroup>

              <SettingsGroup
                title="Current number highlight"
                description="Style and color for the most recently called number."
              >
                <Select
                  value={localCurrentNumberEffect}
                  onValueChange={(value) => void handleCurrentNumberEffect(value as CurrentNumberEffect)}
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
                    {(Object.keys(CURRENT_NUMBER_EFFECT_LABELS) as CurrentNumberEffect[]).map((effect) => (
                      <SelectItem key={effect} value={effect}>
                        {CURRENT_NUMBER_EFFECT_LABELS[effect]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div>
                  <Label className="mb-2 block">Color</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={localCurrentNumberColor}
                      onChange={(e) => handleCurrentNumberColor(e.target.value)}
                      className="h-10 w-14 cursor-pointer rounded border border-border bg-transparent p-1"
                      aria-label="Current number color"
                    />
                    <Input
                      value={
                        editingHexField === "currentNumberColor"
                          ? localCurrentNumberColor
                          : localCurrentNumberColor.toUpperCase()
                      }
                      onFocus={() => setEditingHexField("currentNumberColor")}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setLocalCurrentNumberColor(e.target.value)
                      }
                      onBlur={(e) => handleCurrentNumberColorHexCommit(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="font-mono uppercase"
                      style={{ borderColor: letterColors.N }}
                    />
                  </div>
                </div>
              </SettingsGroup>

              <SettingsGroup title="Diagnostics" className="lg:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="block">LED board test</Label>
                    <p className="text-xs text-muted-foreground">
                      Cycles letters (red), numbers (green), game type (blue), then all three together.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    onClick={handleLedTestToggle}
                    className="shrink-0 text-white"
                    style={{
                      backgroundColor: ledTestMode ? letterColors.I : letterColors.N,
                      borderColor: ledTestMode ? letterColors.I : letterColors.N,
                    }}
                  >
                    {ledTestMode ? "Disable" : "Enable"}
                  </Button>
                </div>
              </SettingsGroup>
              </div>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="screensaver" className="mt-0 outline-none">
            <SettingsPanel
              title="Screensaver"
              description="Idle display when the board is not being used for a game."
            >
              <SettingsGroup>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="block">Screensaver mode</Label>
                    <p className="text-xs text-muted-foreground">{screensaverDescription}</p>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    onClick={handleScreensaverToggle}
                    disabled={screensaverSaving}
                    className="shrink-0 text-white"
                    style={{
                      backgroundColor: localScreensaverEnabled ? letterColors.I : letterColors.N,
                      borderColor: localScreensaverEnabled ? letterColors.I : letterColors.N,
                      opacity: screensaverSaving ? 0.7 : 1,
                    }}
                  >
                    {screensaverSaving
                      ? "Saving..."
                      : localScreensaverEnabled
                        ? "Disable"
                        : "Enable"}
                  </Button>
                </div>
                <div>
                  <Label className="mb-2 block">Type</Label>
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
                    <Label className="mb-2 block">Text</Label>
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
                    <Label className="mb-2 block">Color</Label>
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
              </SettingsGroup>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="ui" className="mt-0 outline-none">
            <SettingsPanel
              title="BINGO UI colors"
              description="Colors used in the web interface only — not the physical LED strip."
            >
              <SettingsGroup>
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
              </SettingsGroup>
            </SettingsPanel>
          </TabsContent>

          {(onCallerSpeechRateChange || onCallerVoiceChange) && (
            <TabsContent value="caller" className="mt-0 outline-none">
              <SettingsPanel
                title="Number caller"
                description="Playback settings for pre-recorded call-outs."
              >
                <SettingsGroup>
                  {onCallerVoiceChange && (
                    <div>
                      <Label className="mb-2 block">Voice</Label>
                      <div className="flex items-stretch gap-2">
                        <Select
                          value={localCallerVoice}
                          onValueChange={(value) => {
                            const next = value as CallerVoiceId;
                            setLocalCallerVoice(next);
                            onCallerVoiceChange(next);
                          }}
                        >
                          <SelectTrigger
                            className="min-w-0 flex-1 focus:ring-0 focus:ring-offset-0"
                            style={{ borderColor: letterColors.N }}
                            onFocus={(e) => focusSelectWithLetterN(e, letterColors.N)}
                            onBlur={(e) => blurSelectWithLetterN(e, letterColors.N)}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CALLER_VOICES.map((voice) => (
                              <SelectItem key={voice.id} value={voice.id}>
                                {voice.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0 gap-1.5 px-3"
                          style={{ borderColor: letterColors.N }}
                          aria-label={
                            callerExamplePlaying ? "Stop voice example" : "Play voice example"
                          }
                          aria-pressed={callerExamplePlaying}
                          onClick={() => {
                            if (callerExamplePlaying) stopCallerExample();
                            else playCallerExample();
                          }}
                        >
                          {callerExamplePlaying ? (
                            <Square className="h-3.5 w-3.5 fill-current" />
                          ) : (
                            <Play className="h-3.5 w-3.5 fill-current" />
                          )}
                          Example
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                        Chooses which pre-recorded voice pack plays for number call-outs. Use
                        Example to hear a short host intro in the selected voice.
                      </p>
                    </div>
                  )}
                  {onCallerSpeechRateChange && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label>Speech rate</Label>
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {localCallerSpeechRate.toFixed(2)}×
                        </span>
                      </div>
                      <Slider
                        value={[localCallerSpeechRate]}
                        min={0.6}
                        max={1.2}
                        step={0.05}
                        onValueChange={(value) => setLocalCallerSpeechRate(value[0])}
                        onValueCommit={(value) => onCallerSpeechRateChange(value[0])}
                      />
                      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                        Lower is slower. Tap the header speaker icon once on phone to enable sound
                        (required for Bluetooth).
                      </p>
                    </div>
                  )}
                </SettingsGroup>
              </SettingsPanel>
            </TabsContent>
          )}

          <TabsContent value="cards" className="mt-0 outline-none">
            <SettingsPanel
              title="Printable cards"
              description="Create printable PDFs or shareable bingo.local links. Each card is uniquely fingerprinted and signed with this board’s device ID so authenticated scans can verify authenticity."
            >
              <SettingsGroup>
                <div>
                  <Label className="mb-2 block">Card style</Label>
                  <RadioGroup
                    value={cardPackStyle}
                    onValueChange={(value) => setCardPackStyle(value as GameStyle)}
                    className="grid grid-cols-2 gap-2"
                  >
                    {GAME_STYLES.map((style) => (
                      <Label
                        key={style}
                        htmlFor={`card-pack-${style}`}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer text-sm transition-colors",
                          cardPackStyle === style ? "" : "border-border"
                        )}
                        style={
                          cardPackStyle === style
                            ? {
                                borderColor: letterColors.N,
                                backgroundColor: rgbaFromHex(letterColors.N, 0.12),
                              }
                            : undefined
                        }
                      >
                        <RadioGroupItem
                          value={style}
                          id={`card-pack-${style}`}
                          className="focus-visible:ring-0 focus-visible:ring-offset-0"
                          style={{ borderColor: letterColors.N, color: letterColors.N }}
                        />
                        {GAME_STYLE_LABELS[style]}
                      </Label>
                    ))}
                  </RadioGroup>
                </div>
                <div>
                  <Label className="mb-2 block">How many cards?</Label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={cardCountDraft}
                    onChange={(e) => setCardCountDraft(e.target.value)}
                    className="max-w-[10rem]"
                    style={{ borderColor: letterColors.N }}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {(() => {
                      const n = Math.max(1, Math.min(200, Number.parseInt(cardCountDraft, 10) || 1));
                      const sheets = Math.ceil(n / 4);
                      return `${n} card${n === 1 ? "" : "s"} → ${sheets} PDF sheet${sheets === 1 ? "" : "s"} (4 per page), or ${n} share link${n === 1 ? "" : "s"}.`;
                    })()}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs text-muted-foreground space-y-1.5">
                  <p>
                    Generating{" "}
                    <span className="font-medium text-foreground">{cardPackStyle.toUpperCase()}</span> packs
                    {cardPackStyle !== gameStyle ? (
                      <>
                        {" "}
                        (board is currently{" "}
                        <span className="font-medium text-foreground">{gameStyle.toUpperCase()}</span>)
                      </>
                    ) : null}
                    . BINGO: center FREE cell is a QR. HOUSEY: sparse 10–12 numbers with the QR in an open cell.
                    Scan with a phone camera to open the card (no board PIN).
                  </p>
                  <p>Print on letter paper. Leave the QR unobstructed when marking or cutting cards.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    disabled={cardsBusy}
                    onClick={() => void handleGenerateBingoCards()}
                    className="text-white"
                    style={{ backgroundColor: letterColors.N }}
                  >
                    {cardsBusy ? "Generating…" : "Download PDF"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={cardsBusy}
                    onClick={() => void handleGenerateCardLinks()}
                  >
                    Generate links
                  </Button>
                  {cardsMessage && <span className="text-xs text-muted-foreground">{cardsMessage}</span>}
                </div>

                {cardShareLinks && cardShareLinks.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label className="text-sm">Shareable card links</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() =>
                          void copyCardText(
                            cardShareLinks.map((row) => row.url).join("\n"),
                            "all"
                          )
                        }
                      >
                        {cardCopyKey === "all" ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {cardCopyKey === "all" ? "Copied all" : "Copy all"}
                      </Button>
                    </div>
                    <ul className="max-h-[22rem] overflow-y-auto rounded-lg border border-border/70 divide-y divide-border/60 bg-background/50">
                      {cardShareLinks.map((row, idx) => {
                        const key = `row-${idx}`;
                        const copied = cardCopyKey === key;
                        return (
                          <li
                            key={key}
                            className="flex items-center gap-2 px-3 py-2 text-sm"
                          >
                            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                              {row.label}
                            </span>
                            <code className="min-w-0 flex-1 truncate text-xs text-foreground/90">
                              {row.url}
                            </code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 shrink-0 gap-1 px-2"
                              onClick={() => void copyCardText(row.url, key)}
                              aria-label={`Copy ${row.label} link`}
                            >
                              {copied ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              <span className="text-xs">{copied ? "Copied" : "Copy"}</span>
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </SettingsGroup>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="wifi" className="mt-0 outline-none">
            <SettingsPanel
              title="WiFi"
              description="Scan for nearby networks, save one to join on power-up, or leave unset to use the BINGO access point. Open http://bingo.local in either mode."
            >
              <SettingsGroup>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
                    <Label className="block">Network</Label>
                    <div className="flex items-stretch gap-2">
                      <Select
                        value={localWifiSsid || undefined}
                        onValueChange={(value) => setLocalWifiSsid(value)}
                        disabled={!boardAuthGranted || wifiScanBusy}
                      >
                        <SelectTrigger
                          className="min-w-0 flex-1 focus:ring-0 focus:ring-offset-0"
                          style={{ borderColor: letterColors.N }}
                          onFocus={(e) => focusSelectWithLetterN(e, letterColors.N)}
                          onBlur={(e) => blurSelectWithLetterN(e, letterColors.N)}
                        >
                          <SelectValue
                            placeholder={
                              wifiScanBusy
                                ? "Scanning…"
                                : wifiNetworks.length > 0 || localWifiSsid
                                  ? "Select a network"
                                  : "Scan for nearby networks"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {localWifiSsid &&
                            !wifiNetworks.some((n) => n.ssid === localWifiSsid) && (
                              <SelectItem value={localWifiSsid}>
                                {localWifiSsid} (saved)
                              </SelectItem>
                            )}
                          {wifiNetworks.map((network) => (
                            <SelectItem key={network.ssid} value={network.ssid}>
                              {network.ssid}
                              {network.secure ? "" : " (open)"} · {network.rssi} dBm
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0 gap-1.5 px-3"
                        style={{ borderColor: letterColors.N }}
                        disabled={!boardAuthGranted || wifiScanBusy}
                        onClick={handleWifiScan}
                      >
                        <RefreshCw
                          className={cn("h-3.5 w-3.5", wifiScanBusy && "animate-spin")}
                        />
                        {wifiScanBusy ? "Scanning…" : "Scan"}
                      </Button>
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="mb-2 block">Password</Label>
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
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    onClick={() => void handleWifiSave()}
                    disabled={!boardAuthGranted || !localWifiSsid.trim()}
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
                </div>
                <p className="text-xs text-muted-foreground">
                  Current mode:{" "}
                  {wifiMode === "sta" && wifiConnected ? "Connected to saved WiFi" : "Device access point"}
                </p>
                {wifiMessage && <p className="text-xs text-muted-foreground">{wifiMessage}</p>}
              </SettingsGroup>
            </SettingsPanel>
          </TabsContent>

          <TabsContent
            value="webhooks"
            className="mt-0 outline-none"
            onFocusCapture={loadWebhooks}
          >
            <SettingsPanel
              title="Webhooks"
              description="POST JSON to these URLs when events happen on the board. Requires home WiFi (STA) — the BINGO access point has no internet route."
            >
              <SettingsGroup>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Number called URL</Label>
                    <Input
                      value={localWebhookNumberUrl}
                      onChange={(e) => setLocalWebhookNumberUrl(e.target.value)}
                      placeholder="https://example.com/hooks/bingo-call"
                      disabled={!boardAuthGranted}
                      maxLength={256}
                      style={{ borderColor: letterColors.N }}
                      onFocus={(e) => {
                        loadWebhooks();
                        focusWithLetterN(e, letterColors.N);
                      }}
                      onBlur={(e) => blurWithLetterN(e, letterColors.N)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Body: {"{"} event, number, letter, calledCount, gameType {"}"}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Bingo identified URL</Label>
                    <Input
                      value={localWebhookBingoUrl}
                      onChange={(e) => setLocalWebhookBingoUrl(e.target.value)}
                      placeholder="https://example.com/hooks/bingo-win"
                      disabled={!boardAuthGranted}
                      maxLength={256}
                      style={{ borderColor: letterColors.N }}
                      onFocus={(e) => {
                        loadWebhooks();
                        focusWithLetterN(e, letterColors.N);
                      }}
                      onBlur={(e) => blurWithLetterN(e, letterColors.N)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Body: {"{"} event, winnerCount, winnerEventId, gameType, number {"}"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={handleWebhooksSave}
                    disabled={!boardAuthGranted}
                    className="text-white"
                    style={{ backgroundColor: letterColors.N }}
                  >
                    Save webhooks
                  </Button>
                  {webhooksMessage && (
                    <p className="text-xs text-muted-foreground">{webhooksMessage}</p>
                  )}
                  {wifiMode !== "sta" || !wifiConnected ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Board is on the BINGO access point — configure WiFi so outbound webhooks can reach the internet.
                    </p>
                  ) : null}
                </div>
              </SettingsGroup>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="access" className="mt-0 outline-none">
            <SettingsPanel
              title="Board access"
              description="Change the PIN that unlocks board controls on this device."
            >
              <SettingsGroup>
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
                <div className="flex flex-wrap items-center gap-3">
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
              </SettingsGroup>
              <SettingsGroup
                title="Restart"
                description="Soft-reboot the ESP32 (same as a power cycle for firmware and WiFi). The web UI will reconnect after the board comes back."
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-1.5"
                    onClick={handleBoardRestart}
                    disabled={!boardAuthGranted || restartBusy}
                  >
                    <Power className="h-3.5 w-3.5" />
                    {restartBusy ? "Restarting…" : "Restart board"}
                  </Button>
                  {restartMessage && (
                    <span className="text-xs text-muted-foreground">{restartMessage}</span>
                  )}
                </div>
              </SettingsGroup>
            </SettingsPanel>
          </TabsContent>
          </div>
        </Tabs>
      ) : (
        <SettingsPanel
          title="BINGO UI colors"
          description="Colors used in the web interface only."
        >
          <SettingsGroup>
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
          </SettingsGroup>
        </SettingsPanel>
      )}
    </div>
  );
}
