import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api";
import {
  callerClipUrl,
  callerVoiceCachePrefix,
  callerVoicePackUrl,
  type CallerVoiceId,
  readCallerVoice,
  writeCallerVoice,
} from "@/lib/caller-voices";
import { LETTERS, LETTER_RANGES, numberToLetter, type Letter } from "@/types";

const STORAGE_KEY = "bingo-caller-speech";
const JOKES_STORAGE_KEY = "bingo-caller-jokes";
export const CALLER_SPEECH_RATE_KEY = "bingo-caller-speech-rate";
export const DEFAULT_CALLER_SPEECH_RATE = 1.0;
export const MIN_CALLER_SPEECH_RATE = 0.7;
export const MAX_CALLER_SPEECH_RATE = 1.5;

/** Pause after the number call-out before playing a joke clip. */
const JOKE_AFTER_NUMBER_PAUSE_MS = 450;
/** Short beat after the number/joke before a column-complete prompt. */
const COLUMN_PROMPT_PAUSE_MS = 350;

/**
 * ESP32 HTTP is single-flight. Prefer one pack.bin download (numbers + jokes + utils)
 * over dozens of SPIFFS hits. Individual warm remains a fallback when pack.bin is missing.
 */
const PREFETCH_BATCH_DESKTOP = 2;
const PREFETCH_BATCH_MOBILE = 1;
const PREFETCH_BATCH_GAP_DESKTOP_MS = 30;
const PREFETCH_BATCH_GAP_MOBILE_MS = 50;

/** Keep iOS/Android media session alive so timer-driven auto-call clips can play. */
const AUDIO_KEEPALIVE_MS = 12000;

/** Full volume for call-out clips — keepalive briefly dips to near-silent and must restore here. */
const CALLER_PLAYBACK_VOLUME = 1;

/** Tiny silent WAV — used as a media-session keepalive after gesture unlock. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function readInitialSpeechOn(): boolean {
  if (typeof window === "undefined") return true;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return true;
  return raw === "true";
}

export function clampCallerSpeechRate(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CALLER_SPEECH_RATE;
  return Math.min(MAX_CALLER_SPEECH_RATE, Math.max(MIN_CALLER_SPEECH_RATE, value));
}

export function readCallerSpeechRate(): number {
  if (typeof window === "undefined") return DEFAULT_CALLER_SPEECH_RATE;
  const raw = localStorage.getItem(CALLER_SPEECH_RATE_KEY);
  if (raw === null) return DEFAULT_CALLER_SPEECH_RATE;
  return clampCallerSpeechRate(Number.parseFloat(raw));
}

export function writeCallerSpeechRate(rate: number): number {
  const clamped = clampCallerSpeechRate(rate);
  localStorage.setItem(CALLER_SPEECH_RATE_KEY, String(clamped));
  return clamped;
}

function numberClipUrl(voiceId: CallerVoiceId, n: number): string {
  const letter = numberToLetter(n);
  return callerClipUrl(voiceId, `${letter}-${n}`);
}

function jokeClipUrl(voiceId: CallerVoiceId, n: number): string | null {
  if (n < 1 || n > 75) return null;
  const letter = numberToLetter(n);
  return callerClipUrl(voiceId, `joke-${letter}-${n}`);
}

function columnPromptClipUrl(
  voiceId: CallerVoiceId,
  kind: "no-more" | "all-called",
  letter: Letter
): string {
  return callerClipUrl(voiceId, `${kind}-${letter}`);
}

function isLetterColumnComplete(letter: Letter, calledSet: Set<number>): boolean {
  const [lo, hi] = LETTER_RANGES[letter];
  for (let n = lo; n <= hi; n++) {
    if (!calledSet.has(n)) return false;
  }
  return true;
}

/** Letters whose columns are newly complete after `added` joined the called set. */
function lettersNewlyCompleted(calledBefore: Set<number>, added: number): Letter[] {
  const letter = numberToLetter(added);
  if (isLetterColumnComplete(letter, calledBefore)) return [];
  const after = new Set(calledBefore);
  after.add(added);
  return isLetterColumnComplete(letter, after) ? [letter] : [];
}

/**
 * Column-exhausted caller line:
 * - Normal board: "No more Bees!" (letter lights when column fills)
 * - Battleship sink board: "All the Bees have been called!" (numbers taken away until none left)
 */
function columnCompletePromptKind(gameType: string): "no-more" | "all-called" {
  return gameType === "battleship" ? "all-called" : "no-more";
}

function isJokeClipBasename(name: string): boolean {
  const base = name.endsWith(".mp3") ? name.slice(0, -4) : name;
  return base.startsWith("joke-");
}

function isJokeClipUrl(url: string): boolean {
  return /\/joke-[A-Z]-\d+\.mp3$/i.test(url) || url.endsWith("/jokes-on.mp3");
}

/** SPIFFS often serves MP3s as application/octet-stream — Safari won't play those blobs. */
function asCallerAudioBlob(blob: Blob): Blob {
  if (blob.type === "audio/mpeg" || blob.type === "audio/mp3") return blob;
  return new Blob([blob], { type: "audio/mpeg" });
}

const PACK_MAGIC = "BNGPCK01";

/** Parse scripts/build-caller-voice-packs.mjs output into basename → Blob. */
function parseCallerVoicePack(buffer: ArrayBuffer): Map<string, Blob> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== PACK_MAGIC) throw new Error("invalid voice pack magic");
  const count = view.getUint16(8, true);
  let offset = 10;
  const out = new Map<string, Blob>();
  for (let i = 0; i < count; i++) {
    if (offset >= bytes.length) throw new Error("voice pack truncated");
    const nameLen = view.getUint8(offset);
    offset += 1;
    const name = String.fromCharCode(...bytes.subarray(offset, offset + nameLen));
    offset += nameLen;
    const size = view.getUint32(offset, true);
    offset += 4;
    const slice = bytes.subarray(offset, offset + size);
    offset += size;
    out.set(name, new Blob([slice], { type: "audio/mpeg" }));
  }
  return out;
}

/** Prefer HTML Audio on phones — Web Audio suspends/fails after async SPIFFS fetch. */
function isLikelyMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  // iPadOS Desktop mode still has touch.
  return navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua);
}

type AudioContextType = AudioContext;

interface UseCallerSpeechOptions {
  /** Live caller client (board or HUD) — announces called numbers. */
  active: boolean;
  /**
   * When true, this tab arms firmware auto-call audio hold / wait-audio.
   * Board operator only — HUD spectators play locally without gating the draw.
   */
  syncBoardAudioHold?: boolean;
  /** Full call order — newest number is at the end. */
  called: number[];
  /** Current game type — Battleship uses the sink-board column prompt. */
  gameType: string;
  winnerDeclared: boolean;
  hydrated: boolean;
  /** When true, auto-call timer waits for call-out audio to finish. */
  autoCallingEnabled: boolean;
}

interface UseCallerSpeechState {
  speechOn: boolean;
  jokesOn: boolean;
  /** True after a user gesture has unlocked audio playback (required on iOS). */
  speechUnlocked: boolean;
  speechSupported: boolean;
  speechRate: number;
  callerVoice: CallerVoiceId;
  /** Read whether call-out audio is currently holding the auto-call timer (ref-based). */
  isAudioHoldActive: () => boolean;
  /** Start loading a number clip (e.g. on pointer-down before tap completes). */
  prefetchNumberClip: (n: number) => void;
  /** Play call-out immediately on manual tap — do not wait for server round-trip. */
  announceNumberNow: (n: number) => void;
  setSpeechRate: (rate: number) => void;
  setCallerVoice: (voice: CallerVoiceId) => void;
  /** Call from a click/tap handler only. */
  toggleSpeech: () => void;
  toggleJokes: () => void;
  setSpeechOn: (on: boolean) => void;
}

export function useCallerSpeech(options: UseCallerSpeechOptions): UseCallerSpeechState {
  const {
    active,
    syncBoardAudioHold = true,
    called,
    gameType,
    winnerDeclared,
    hydrated,
    autoCallingEnabled,
  } = options;
  const [speechOn, setSpeechOnState] = useState<boolean>(() => readInitialSpeechOn());
  // Always start off for the page session.
  const [jokesOn, setJokesOnState] = useState(false);
  const [speechUnlocked, setSpeechUnlocked] = useState(false);
  const [speechRate, setSpeechRateState] = useState<number>(() => readCallerSpeechRate());
  const [callerVoice, setCallerVoiceState] = useState<CallerVoiceId>(() => readCallerVoice());
  const [speechSupported] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      (typeof Audio !== "undefined" ||
        window.AudioContext != null ||
        (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext != null)
  );

  const callerVoiceRef = useRef(callerVoice);
  callerVoiceRef.current = callerVoice;
  const speechRateRef = useRef(speechRate);
  speechRateRef.current = speechRate;
  const baselineReadyRef = useRef(false);
  const spokenNumbersRef = useRef<Set<number>>(new Set());
  const prevWinnerDeclaredRef = useRef(false);
  const prevUnlockedRef = useRef(false);
  const speechOnRef = useRef(speechOn);
  const jokesOnRef = useRef(jokesOn);
  const speechUnlockedRef = useRef(speechUnlocked);
  const calledRef = useRef(called);
  const gameTypeRef = useRef(gameType);
  const autoCallingEnabledRef = useRef(autoCallingEnabled);
  /** Bumps to cancel in-flight number→joke sequences when a newer call arrives. */
  const playGenerationRef = useRef(0);
  /** Manual taps announce before WS/state — skip duplicate from effect. */
  const manualAnnounceRef = useRef<Set<number>>(new Set());
  const audioHoldActiveRef = useRef(false);
  /** True while this client is (or was) the board caller that may arm firmware wait-audio/hold. */
  const activeRef = useRef(active);
  const mayNotifyBoardAudioRef = useRef(false);
  /** Pause HTTP warm while a call-out is loading/playing so mobile WiFi hits SPIFFS first. */
  const playbackBusyRef = useRef(false);
  /** Bingo clip deferred until the in-flight number(+joke) finishes. */
  const pendingBingoRef = useRef(false);
  const httpCacheWarmedRef = useRef<Set<string>>(new Set());
  /** Prefetched clip bodies — discarded when the user switches away from a voice. */
  const clipBlobCacheRef = useRef<Map<string, Blob>>(new Map());
  /** Object URL for the clip currently assigned to the shared audio element. */
  const activeObjectUrlRef = useRef<string | null>(null);
  /** Parsed pack.bin entries kept so jokes can be cached later without re-fetching. */
  const voicePackEntriesRef = useRef<Map<CallerVoiceId, Map<string, Blob>>>(new Map());
  /** Voices whose pack.bin has been downloaded (numbers may already be in clip cache). */
  const voicePackLoadedRef = useRef<Set<CallerVoiceId>>(new Set());
  /** Voices whose joke-* clips from the pack are currently in clipBlobCacheRef. */
  const voiceJokesCachedRef = useRef<Set<CallerVoiceId>>(new Set());
  const voicePackInflightRef = useRef<Map<CallerVoiceId, Promise<boolean>>>(new Map());
  /** Bumps cancel in-flight voice pack / per-clip prefetch queues. */
  const voicePrefetchGenRef = useRef(0);
  const mobileRef = useRef(false);

  const audioContextRef = useRef<AudioContextType | null>(null);
  /** Single HTMLAudioElement created during unlock — reusing it keeps mobile autoplay privileges. */
  const sharedAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeHtmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const prevCalledLenRef = useRef(0);
  const markUnlockLostRef = useRef<() => void>(() => undefined);

  const newestCalled = called.length > 0 ? called[called.length - 1] : 0;
  const calledSignature = useMemo(
    () => `${called.length}:${newestCalled}`,
    [called.length, newestCalled]
  );

  useEffect(() => {
    mobileRef.current = isLikelyMobile();
  }, []);

  useEffect(() => {
    speechOnRef.current = speechOn;
  }, [speechOn]);

  useEffect(() => {
    jokesOnRef.current = jokesOn;
  }, [jokesOn]);

  useEffect(() => {
    speechUnlockedRef.current = speechUnlocked;
  }, [speechUnlocked]);

  useEffect(() => {
    calledRef.current = called;
  }, [called]);

  useEffect(() => {
    gameTypeRef.current = gameType;
  }, [gameType]);

  useEffect(() => {
    autoCallingEnabledRef.current = autoCallingEnabled;
  }, [autoCallingEnabled]);

  useEffect(() => {
    activeRef.current = active;
    // Only the board operator tab may arm/clear firmware wait-audio + hold.
    if (active && syncBoardAudioHold) mayNotifyBoardAudioRef.current = true;
  }, [active, syncBoardAudioHold]);

  const notifyBoardWaitForAudio = useCallback((enabled: boolean) => {
    // Card / inactive clients must never arm or clear board wait-audio.
    if (!mayNotifyBoardAudioRef.current) return;
    void api.setAutoCallingWaitForAudio(enabled).catch(() => undefined);
  }, []);

  const notifyBoardAutoCallingHold = useCallback((hold: boolean) => {
    if (!mayNotifyBoardAudioRef.current) return;
    void api.setAutoCallingHold(hold).catch(() => undefined);
  }, []);

  const releaseAutoCallingHold = useCallback((force = false) => {
    if (!audioHoldActiveRef.current) {
      // Still nudge firmware when forced so deferred winner mode can flush.
      if (force) notifyBoardAutoCallingHold(false);
      return;
    }
    audioHoldActiveRef.current = false;
    // Always release so firmware can flush deferred winner mode after the call finishes.
    notifyBoardAutoCallingHold(false);
  }, [notifyBoardAutoCallingHold]);

  const isAudioHoldActive = useCallback(() => audioHoldActiveRef.current, []);

  const ensureSharedAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof Audio === "undefined") return null;
    if (!sharedAudioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      // iOS requires playsInline or timed/auto clips get blocked as fullscreen media.
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("webkit-playsinline", "true");
      (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      sharedAudioRef.current = audio;
    }
    return sharedAudioRef.current;
  }, []);

  /** Soft stop — pause + clear handlers, but do not destroy the unlocked media element. */
  const revokeActiveObjectUrl = useCallback(() => {
    if (!activeObjectUrlRef.current) return;
    URL.revokeObjectURL(activeObjectUrlRef.current);
    activeObjectUrlRef.current = null;
  }, []);

  const stopAudio = useCallback(() => {
    const html = activeHtmlAudioRef.current ?? sharedAudioRef.current;
    if (!html) {
      revokeActiveObjectUrl();
      return;
    }
    try {
      html.onended = null;
      html.onerror = null;
      html.onloadeddata = null;
      html.oncanplaythrough = null;
      html.pause();
    } catch {
      // Ignore.
    }
    activeHtmlAudioRef.current = null;
    revokeActiveObjectUrl();
  }, [revokeActiveObjectUrl]);

  /** Play from the in-memory blob cache when warm; falls back to the SPIFFS URL. */
  const assignClipSrc = useCallback(
    (audio: HTMLAudioElement, url: string) => {
      revokeActiveObjectUrl();
      const blob = clipBlobCacheRef.current.get(url);
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        activeObjectUrlRef.current = objectUrl;
        audio.src = objectUrl;
      } else {
        audio.src = url;
      }
    },
    [revokeActiveObjectUrl]
  );

  /**
   * Apply settings speech rate. Must run AFTER src changes — Safari/WebKit resets
   * playbackRate to 1 when a new source is assigned.
   */
  const applyCallerPlaybackRate = useCallback((audio: HTMLAudioElement, rate?: number) => {
    const next = clampCallerSpeechRate(rate ?? speechRateRef.current);
    try {
      audio.defaultPlaybackRate = next;
      audio.playbackRate = next;
    } catch {
      // Some browsers reject extreme rates; ignore.
    }
  }, []);

  const discardCachedVoiceClips = useCallback((voiceId: CallerVoiceId) => {
    const prefix = callerVoiceCachePrefix(voiceId);
    for (const url of [...clipBlobCacheRef.current.keys()]) {
      if (url.startsWith(prefix)) clipBlobCacheRef.current.delete(url);
    }
    for (const url of [...httpCacheWarmedRef.current]) {
      if (url.startsWith(prefix)) httpCacheWarmedRef.current.delete(url);
    }
    voicePackEntriesRef.current.delete(voiceId);
    voicePackLoadedRef.current.delete(voiceId);
    voiceJokesCachedRef.current.delete(voiceId);
    voicePackInflightRef.current.delete(voiceId);
  }, []);

  /** Drop in-memory joke blobs only (numbers stay warm). */
  const discardCachedJokeClips = useCallback((voiceId: CallerVoiceId) => {
    const prefix = callerVoiceCachePrefix(voiceId);
    for (const url of [...clipBlobCacheRef.current.keys()]) {
      if (url.startsWith(prefix) && isJokeClipUrl(url)) {
        clipBlobCacheRef.current.delete(url);
        httpCacheWarmedRef.current.delete(url);
      }
    }
    voiceJokesCachedRef.current.delete(voiceId);
  }, []);

  /** Apply pack entries into the blob cache; jokes only when includeJokes is true. */
  const applyVoicePackEntries = useCallback(
    (voiceId: CallerVoiceId, entries: Map<string, Blob>, includeJokes: boolean) => {
      for (const [name, blob] of entries) {
        if (!includeJokes && isJokeClipBasename(name)) continue;
        const clipName = name.endsWith(".mp3") ? name.slice(0, -4) : name;
        if (!includeJokes && clipName === "jokes-on") continue;
        const clipUrl = callerClipUrl(voiceId, clipName);
        clipBlobCacheRef.current.set(clipUrl, blob);
        httpCacheWarmedRef.current.add(clipUrl);
      }
      voicePackLoadedRef.current.add(voiceId);
      if (includeJokes) voiceJokesCachedRef.current.add(voiceId);
    },
    []
  );

  /**
   * One HTTP GET for the whole voice pack. Numbers always enter the blob cache;
   * joke-* clips only when includeJokes (caller jokes enabled).
   */
  const ensureVoicePackLoaded = useCallback(
    async (voiceId: CallerVoiceId, includeJokes = jokesOnRef.current): Promise<boolean> => {
      const cachedEntries = voicePackEntriesRef.current.get(voiceId);
      if (cachedEntries) {
        if (includeJokes && !voiceJokesCachedRef.current.has(voiceId)) {
          applyVoicePackEntries(voiceId, cachedEntries, true);
        } else if (!includeJokes && !voicePackLoadedRef.current.has(voiceId)) {
          applyVoicePackEntries(voiceId, cachedEntries, false);
        }
        return true;
      }

      const existing = voicePackInflightRef.current.get(voiceId);
      if (existing) {
        const ok = await existing;
        if (ok && includeJokes && !voiceJokesCachedRef.current.has(voiceId)) {
          const entries = voicePackEntriesRef.current.get(voiceId);
          if (entries) applyVoicePackEntries(voiceId, entries, true);
        }
        return ok;
      }

      const work = (async () => {
        try {
          const packUrl = callerVoicePackUrl(voiceId);
          const res = await fetch(packUrl, { credentials: "same-origin" });
          if (!res.ok) return false;
          const entries = parseCallerVoicePack(await res.arrayBuffer());
          voicePackEntriesRef.current.set(voiceId, entries);
          applyVoicePackEntries(voiceId, entries, includeJokes || jokesOnRef.current);
          return true;
        } catch {
          return false;
        } finally {
          voicePackInflightRef.current.delete(voiceId);
        }
      })();

      voicePackInflightRef.current.set(voiceId, work);
      return work;
    },
    [applyVoicePackEntries]
  );

  const ensureAudioContext = useCallback(async (): Promise<AudioContextType | null> => {
    if (typeof window === "undefined") return null;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioContextRef.current) {
      audioContextRef.current = new Ctx();
    }
    const ctx = audioContextRef.current;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // Ignore.
      }
    }
    return ctx;
  }, []);

  /** Prefetch clip into an in-memory blob map (HTTP cache alone cannot be purged on voice swap). */
  const warmHttpCache = useCallback((url: string): Promise<void> => {
    if (clipBlobCacheRef.current.has(url) || httpCacheWarmedRef.current.has(url)) {
      return Promise.resolve();
    }
    httpCacheWarmedRef.current.add(url);
    return fetch(url, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) {
          httpCacheWarmedRef.current.delete(url);
          return;
        }
        const blob = asCallerAudioBlob(await res.blob());
        // Voice may have been discarded while this fetch was in flight.
        if (!httpCacheWarmedRef.current.has(url)) return;
        clipBlobCacheRef.current.set(url, blob);
      })
      .catch(() => {
        httpCacheWarmedRef.current.delete(url);
      });
  }, []);

  const waitWhilePrefetchBlocked = useCallback(async (alive: () => boolean) => {
    // Only pause while a clip is actively loading/playing so SPIFFS stays free for that fetch.
    // Do not block the whole batch queue for the entire auto-calling session.
    while (playbackBusyRef.current) {
      await new Promise((r) => window.setTimeout(r, 250));
      if (!alive()) return false;
    }
    return true;
  }, []);

  /** Fire concurrent fetches in bunches; pause while call-out audio / auto-call needs SPIFFS. */
  const warmHttpCacheBunched = useCallback(
    async (urls: string[], alive: () => boolean) => {
      const batchSize = mobileRef.current ? PREFETCH_BATCH_MOBILE : PREFETCH_BATCH_DESKTOP;
      const gap = mobileRef.current ? PREFETCH_BATCH_GAP_MOBILE_MS : PREFETCH_BATCH_GAP_DESKTOP_MS;
      for (let i = 0; i < urls.length; i += batchSize) {
        if (!alive()) return;
        if (!(await waitWhilePrefetchBlocked(alive))) return;
        const batch = urls.slice(i, i + batchSize);
        await Promise.all(batch.map((url) => warmHttpCache(url)));
        if (!alive()) return;
        if (i + batchSize < urls.length) {
          await new Promise((r) => window.setTimeout(r, gap));
        }
      }
    },
    [waitWhilePrefetchBlocked, warmHttpCache]
  );

  /**
   * HTML Audio on the shared unlocked element — required for timer-driven auto-call
   * clips on mobile (fresh `new Audio()` after idle often fails without a gesture).
   */
  const playHtmlClip = useCallback(
    async (url: string, generation: number): Promise<void> => {
      // If a batch/prefetch fetch is already in flight for this clip, wait briefly so we
      // play from the in-memory blob instead of a cold SPIFFS hit.
      if (!clipBlobCacheRef.current.has(url) && httpCacheWarmedRef.current.has(url)) {
        const deadline = Date.now() + 250;
        while (!clipBlobCacheRef.current.has(url) && Date.now() < deadline) {
          if (generation !== playGenerationRef.current) return;
          await new Promise((r) => window.setTimeout(r, 20));
        }
      }

      return new Promise((resolve) => {
        if (generation !== playGenerationRef.current) {
          resolve();
          return;
        }
        const audio = ensureSharedAudio();
        if (!audio) {
          resolve();
          return;
        }

        stopAudio();
        playbackBusyRef.current = true;
        activeHtmlAudioRef.current = audio;
        try {
          audio.volume = CALLER_PLAYBACK_VOLUME;
        } catch {
          // Ignore.
        }

        let settled = false;
        const timeoutId = window.setTimeout(() => finish(), mobileRef.current ? 12000 : 8000);

        function finish() {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          if (activeHtmlAudioRef.current === audio) activeHtmlAudioRef.current = null;
          if (generation === playGenerationRef.current) {
            playbackBusyRef.current = false;
          }
          resolve();
        }

        audio.onended = () => finish();
        audio.onerror = () => finish();

        const tryPlay = () => {
          if (settled || generation !== playGenerationRef.current) {
            finish();
            return;
          }
          applyCallerPlaybackRate(audio);
          void ensureAudioContext();
          void audio.play().then(
            () => undefined,
            (err: unknown) => {
              const name =
                err && typeof err === "object" && "name" in err
                  ? String((err as { name?: string }).name)
                  : "";
              // iOS revoked unlock — ask the user to tap caller again.
              if (name === "NotAllowedError") {
                markUnlockLostRef.current();
                finish();
              }
              // Other play() races (not buffered yet) — loadeddata / retry / timeout handle it.
            }
          );
        };

        audio.onloadeddata = () => {
          applyCallerPlaybackRate(audio);
          tryPlay();
        };
        assignClipSrc(audio, url);
        // WebKit resets rate on src assign — re-apply immediately and again before play.
        applyCallerPlaybackRate(audio);
        tryPlay();
        window.setTimeout(tryPlay, 80);
      });
    },
    [applyCallerPlaybackRate, assignClipSrc, ensureAudioContext, ensureSharedAudio, stopAudio]
  );

  /** Sync start for unlock / jokes-on / bingo / any prompt — must not await before play(). */
  const playUtilityClipSync = useCallback(
    (url: string) => {
      playGenerationRef.current += 1;
      const generation = playGenerationRef.current;
      const audio = ensureSharedAudio();
      if (!audio) return;
      stopAudio();
      playbackBusyRef.current = true;
      activeHtmlAudioRef.current = audio;
      try {
        audio.volume = CALLER_PLAYBACK_VOLUME;
      } catch {
        // Ignore.
      }
      audio.onended = () => {
        if (activeHtmlAudioRef.current === audio) activeHtmlAudioRef.current = null;
        if (generation === playGenerationRef.current) playbackBusyRef.current = false;
      };
      audio.onerror = () => {
        if (activeHtmlAudioRef.current === audio) activeHtmlAudioRef.current = null;
        if (generation === playGenerationRef.current) playbackBusyRef.current = false;
      };
      audio.onloadeddata = () => {
        applyCallerPlaybackRate(audio);
      };
      assignClipSrc(audio, url);
      applyCallerPlaybackRate(audio);
      void audio.play().catch((err: unknown) => {
        const name =
          err && typeof err === "object" && "name" in err
            ? String((err as { name?: string }).name)
            : "";
        if (name === "NotAllowedError") markUnlockLostRef.current();
        if (generation === playGenerationRef.current) playbackBusyRef.current = false;
      });
    },
    [applyCallerPlaybackRate, assignClipSrc, ensureSharedAudio, stopAudio]
  );

  /**
   * Warm call-out clips via pack.bin (same path for numbers and jokes).
   * Joke blobs are only inserted into the in-memory cache when jokes are enabled.
   */
  const prefetchVoiceClipsInBackground = useCallback(() => {
    const gen = ++voicePrefetchGenRef.current;
    const includeJokes = jokesOnRef.current;
    const alive = () =>
      gen === voicePrefetchGenRef.current &&
      speechUnlockedRef.current &&
      speechOnRef.current &&
      (!includeJokes || jokesOnRef.current);

    void (async () => {
      const voice = callerVoiceRef.current;
      if (!alive()) return;
      if (await ensureVoicePackLoaded(voice, includeJokes)) return;
      if (!alive()) return;
      const urls = [
        callerClipUrl(voice, "on"),
        callerClipUrl(voice, "bingo"),
        callerClipUrl(voice, "example"),
        ...LETTERS.flatMap((letter) => [
          columnPromptClipUrl(voice, "no-more", letter),
          columnPromptClipUrl(voice, "all-called", letter),
        ]),
        ...Array.from({ length: 75 }, (_, i) => numberClipUrl(voice, i + 1)),
      ];
      if (includeJokes) {
        urls.push(
          callerClipUrl(voice, "jokes-on"),
          ...Array.from({ length: 75 }, (_, i) => jokeClipUrl(voice, i + 1)!)
        );
      }
      await warmHttpCacheBunched(urls, alive);
    })();
  }, [ensureVoicePackLoaded, warmHttpCacheBunched]);

  const cancelVoicePrefetch = useCallback(() => {
    voicePrefetchGenRef.current += 1;
  }, []);

  const announceNumber = useCallback(
    (n: number) => {
      if (n < 1 || n > 75) return;
      if (!speechOnRef.current || !speechUnlockedRef.current) return;
      const voice = callerVoiceRef.current;
      const generation = ++playGenerationRef.current;
      const clipUrl = numberClipUrl(voice, n);
      const jokeUrl = jokesOnRef.current ? jokeClipUrl(voice, n) : null;
      const calledBefore = new Set(calledRef.current);
      calledBefore.delete(n);
      const completedLetters = lettersNewlyCompleted(calledBefore, n);
      const promptKind = columnCompletePromptKind(gameTypeRef.current);
      const columnUrls = completedLetters.map((letter) =>
        columnPromptClipUrl(voice, promptKind, letter)
      );

      void (async () => {
        // Pack (or per-clip) must be ready — SPIFFS may only ship pack.bin.
        // Joke blobs are only requested when jokes are enabled.
        const needNumber = !clipBlobCacheRef.current.has(clipUrl);
        const needJoke = Boolean(jokeUrl && !clipBlobCacheRef.current.has(jokeUrl));
        const needColumn = columnUrls.some((url) => !clipBlobCacheRef.current.has(url));
        if (needNumber || needJoke || needColumn) {
          const packed = await ensureVoicePackLoaded(voice, needJoke || jokesOnRef.current);
          if (!packed) {
            if (needNumber) await warmHttpCache(clipUrl);
            if (needJoke && jokeUrl) await warmHttpCache(jokeUrl);
            if (needColumn) {
              for (const url of columnUrls) await warmHttpCache(url);
            }
          }
        }
        if (generation !== playGenerationRef.current) return;
        if (!speechOnRef.current || !speechUnlockedRef.current) return;
        playbackBusyRef.current = true;
        // Mark local hold immediately so winner UI waits, but delay the ESP32 POST so it
        // does not queue behind / contend with an in-flight `/draw` on the single HTTP task.
        audioHoldActiveRef.current = true;
        const holdDelayId = window.setTimeout(() => {
          if (generation !== playGenerationRef.current) return;
          // Clip may have already finished (and released hold) before this fires.
          if (!audioHoldActiveRef.current) return;
          if (!activeRef.current) return;
          if (!speechOnRef.current || !speechUnlockedRef.current) return;
          notifyBoardAutoCallingHold(true);
        }, 120);
        try {
          await ensureAudioContext();
          await playHtmlClip(clipUrl, generation);
          if (generation !== playGenerationRef.current) return;
          if (!speechOnRef.current || !speechUnlockedRef.current) return;
          if (jokesOnRef.current && jokeUrl) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, JOKE_AFTER_NUMBER_PAUSE_MS);
            });
            if (generation !== playGenerationRef.current) return;
            if (!speechOnRef.current || !speechUnlockedRef.current) return;
            if (jokesOnRef.current) {
              await playHtmlClip(jokeUrl, generation);
            }
          }
          // Column prompts only while caller remains enabled.
          if (
            columnUrls.length > 0 &&
            speechOnRef.current &&
            speechUnlockedRef.current
          ) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, COLUMN_PROMPT_PAUSE_MS);
            });
            if (generation !== playGenerationRef.current) return;
            if (!speechOnRef.current || !speechUnlockedRef.current) return;
            for (const url of columnUrls) {
              if (generation !== playGenerationRef.current) return;
              if (!speechOnRef.current || !speechUnlockedRef.current) return;
              await playHtmlClip(url, generation);
            }
          }
        } finally {
          window.clearTimeout(holdDelayId);
          if (generation === playGenerationRef.current) {
            playbackBusyRef.current = false;
            const playBingo = pendingBingoRef.current;
            pendingBingoRef.current = false;
            // Release hold first so firmware activates deferred winner mode, then bingo audio.
            releaseAutoCallingHold(true);
            if (playBingo && speechOnRef.current && speechUnlockedRef.current) {
              playUtilityClipSync(callerClipUrl(callerVoiceRef.current, "bingo"));
            }
          }
        }
      })();
    },
    [
      ensureAudioContext,
      ensureVoicePackLoaded,
      notifyBoardAutoCallingHold,
      playHtmlClip,
      playUtilityClipSync,
      releaseAutoCallingHold,
      warmHttpCache,
    ]
  );

  const prefetchNumberClip = useCallback(
    (n: number) => {
      if (n < 1 || n > 75) return;
      if (!speechOnRef.current || !speechUnlockedRef.current) return;
      const voice = callerVoiceRef.current;
      const includeJokes = jokesOnRef.current;
      void ensureVoicePackLoaded(voice, includeJokes).then((ok) => {
        if (ok) return;
        warmHttpCache(numberClipUrl(voice, n));
        if (includeJokes) {
          const jokeUrl = jokeClipUrl(voice, n);
          if (jokeUrl) warmHttpCache(jokeUrl);
        }
      });
    },
    [ensureVoicePackLoaded, warmHttpCache]
  );

  const announceNumberNow = useCallback(
    (n: number) => {
      if (n < 1 || n > 75) return;
      if (!speechOnRef.current || !speechUnlockedRef.current) return;
      // `/draw` broadcasts `number_called` over WS before the HTTP response returns.
      // The called-numbers effect may already be announcing — claim the number so we
      // do not start a second play (and a second hold=true) for the same Draw press.
      if (spokenNumbersRef.current.has(n) || manualAnnounceRef.current.has(n)) return;
      manualAnnounceRef.current.add(n);
      spokenNumbersRef.current.add(n);
      announceNumber(n);
    },
    [announceNumber]
  );

  const setJokesOn = useCallback((on: boolean) => {
    setJokesOnState(on);
    jokesOnRef.current = on;
    localStorage.setItem(JOKES_STORAGE_KEY, on ? "true" : "false");
  }, []);

  const setSpeechOn = useCallback(
    (on: boolean) => {
      setSpeechOnState(on);
      localStorage.setItem(STORAGE_KEY, on ? "true" : "false");
      if (!on) {
        cancelVoicePrefetch();
        setJokesOn(false);
        discardCachedJokeClips(callerVoiceRef.current);
        playGenerationRef.current += 1;
        playbackBusyRef.current = false;
        stopAudio();
        notifyBoardWaitForAudio(false);
        void releaseAutoCallingHold(true);
      }
    },
    [
      cancelVoicePrefetch,
      discardCachedJokeClips,
      notifyBoardWaitForAudio,
      releaseAutoCallingHold,
      setJokesOn,
      stopAudio,
    ]
  );

  const setSpeechRate = useCallback((rate: number) => {
    setSpeechRateState(writeCallerSpeechRate(rate));
  }, []);

  const setCallerVoice = useCallback(
    (voice: CallerVoiceId) => {
      const previous = callerVoiceRef.current;
      if (voice === previous) return;
      discardCachedVoiceClips(previous);
      writeCallerVoice(voice);
      callerVoiceRef.current = voice;
      setCallerVoiceState(voice);
      cancelVoicePrefetch();
      if (speechUnlockedRef.current && speechOnRef.current) {
        prefetchVoiceClipsInBackground();
      }
    },
    [
      cancelVoicePrefetch,
      discardCachedVoiceClips,
      prefetchVoiceClipsInBackground,
    ]
  );

  /**
   * Must run inside a user-gesture handler (click/tap).
   * Unlocks HTML Audio (and AudioContext) so later timer-driven call-outs can play.
   */
  const unlockSpeechFromGesture = useCallback(() => {
    if (!speechSupported) return;
    speechUnlockedRef.current = true;
    setSpeechUnlocked(true);
    prevUnlockedRef.current = false;
    notifyBoardWaitForAudio(true);

    // Create the shared element inside the gesture before any async work.
    ensureSharedAudio();
    playUtilityClipSync(callerClipUrl(callerVoiceRef.current, "on"));

    void (async () => {
      await ensureAudioContext();
      prefetchVoiceClipsInBackground();
    })();
  }, [
    ensureAudioContext,
    ensureSharedAudio,
    notifyBoardWaitForAudio,
    playUtilityClipSync,
    prefetchVoiceClipsInBackground,
    speechSupported,
  ]);

  const markUnlockLost = useCallback(() => {
    if (!speechUnlockedRef.current) return;
    speechUnlockedRef.current = false;
    prevUnlockedRef.current = false;
    setSpeechUnlocked(false);
    cancelVoicePrefetch();
    notifyBoardWaitForAudio(false);
    void releaseAutoCallingHold(true);
  }, [cancelVoicePrefetch, notifyBoardWaitForAudio, releaseAutoCallingHold]);

  useEffect(() => {
    markUnlockLostRef.current = markUnlockLost;
  }, [markUnlockLost]);

  const toggleSpeech = useCallback(() => {
    if (!speechSupported) return;

    if (!speechOnRef.current || !speechUnlockedRef.current) {
      setSpeechOn(true);
      unlockSpeechFromGesture();
      return;
    }

    setSpeechOn(false);
  }, [setSpeechOn, speechSupported, unlockSpeechFromGesture]);

  const toggleJokes = useCallback(() => {
    if (!speechSupported) return;
    if (!speechOnRef.current || !speechUnlockedRef.current) return;

    if (jokesOnRef.current) {
      setJokesOn(false);
      discardCachedJokeClips(callerVoiceRef.current);
      return;
    }

    setJokesOn(true);
    // Cache joke clips now (same pack.bin path as numbers), then cue.
    prefetchVoiceClipsInBackground();
    playUtilityClipSync(callerClipUrl(callerVoiceRef.current, "jokes-on"));
  }, [
    discardCachedJokeClips,
    playUtilityClipSync,
    prefetchVoiceClipsInBackground,
    setJokesOn,
    speechSupported,
  ]);

  // Reset baselines when leaving board mode (not while waiting for initial hydrate).
  useEffect(() => {
    if (active) return;
    baselineReadyRef.current = false;
    prevUnlockedRef.current = false;
    prevCalledLenRef.current = 0;
    cancelVoicePrefetch();
    playGenerationRef.current += 1;
    playbackBusyRef.current = false;
    stopAudio();
    // Only clear firmware wait-audio/hold if this tab was the board caller.
    if (!mayNotifyBoardAudioRef.current) return;
    mayNotifyBoardAudioRef.current = false;
    void api.setAutoCallingWaitForAudio(false).catch(() => undefined);
    void api.setAutoCallingHold(false).catch(() => undefined);
    audioHoldActiveRef.current = false;
  }, [active, cancelVoicePrefetch, stopAudio]);

  // Warm short speech utilities once board mode is live (full pack warms with unlock).
  useEffect(() => {
    if (!active || !speechSupported) return;
    for (const name of ["on", "bingo"] as const) {
      warmHttpCache(callerClipUrl(callerVoice, name));
    }
  }, [active, callerVoice, speechSupported, warmHttpCache]);

  // Keep audio unlock alive after backgrounding (common mobile failure).
  useEffect(() => {
    if (!speechUnlocked) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void ensureAudioContext();
      const audio = ensureSharedAudio();
      if (!audio || playbackBusyRef.current) return;
      // Kick a silent clip so Safari keeps the session unlocked across idle gaps.
      // Always restore full playback volume — nested keepalives can leave volume at 0.01.
      try {
        audio.volume = 0.01;
      } catch {
        // Ignore.
      }
      const prevSrc = audio.src;
      audio.src = SILENT_WAV;
      void audio.play().then(
        () => {
          try {
            audio.pause();
            audio.volume = CALLER_PLAYBACK_VOLUME;
            if (prevSrc) audio.src = prevSrc;
            applyCallerPlaybackRate(audio);
          } catch {
            // Ignore.
          }
        },
        () => {
          try {
            audio.volume = CALLER_PLAYBACK_VOLUME;
            applyCallerPlaybackRate(audio);
          } catch {
            // Ignore.
          }
        }
      );
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [applyCallerPlaybackRate, ensureAudioContext, ensureSharedAudio, speechUnlocked]);

  // Periodic keepalive while unlocked — auto-call clips fail after ~30s idle without this on iOS.
  useEffect(() => {
    if (!active || !speechOn || !speechUnlocked) return;
    const tick = () => {
      if (!speechUnlockedRef.current || !speechOnRef.current) return;
      if (playbackBusyRef.current) return;
      if (document.visibilityState !== "visible") return;
      void ensureAudioContext();
      const audio = ensureSharedAudio();
      if (!audio) return;
      try {
        audio.volume = 0.01;
        audio.src = SILENT_WAV;
        void audio.play().then(
          () => {
            window.setTimeout(() => {
              try {
                audio.pause();
                audio.volume = CALLER_PLAYBACK_VOLUME;
                applyCallerPlaybackRate(audio);
              } catch {
                // Ignore.
              }
            }, 80);
          },
          (err: unknown) => {
            try {
              audio.volume = CALLER_PLAYBACK_VOLUME;
              applyCallerPlaybackRate(audio);
            } catch {
              // Ignore.
            }
            const name =
              err && typeof err === "object" && "name" in err
                ? String((err as { name?: string }).name)
                : "";
            if (name === "NotAllowedError") markUnlockLostRef.current();
          }
        );
      } catch {
        try {
          audio.volume = CALLER_PLAYBACK_VOLUME;
          applyCallerPlaybackRate(audio);
        } catch {
          // Ignore.
        }
      }
    };
    const id = window.setInterval(tick, AUDIO_KEEPALIVE_MS);
    return () => window.clearInterval(id);
  }, [active, applyCallerPlaybackRate, ensureAudioContext, ensureSharedAudio, speechOn, speechUnlocked]);

  useEffect(() => {
    if (!active || !hydrated || !speechSupported) return;

    const calledNow = calledRef.current;

    // New game / reset — allow numbers to be announced again next round.
    if (calledNow.length === 0) {
      const wasReset = prevCalledLenRef.current > 0;
      prevCalledLenRef.current = 0;
      prevWinnerDeclaredRef.current = winnerDeclared;
      baselineReadyRef.current = true;
      if (wasReset) {
        spokenNumbersRef.current.clear();
        manualAnnounceRef.current.clear();
        pendingBingoRef.current = false;
        playGenerationRef.current += 1;
        playbackBusyRef.current = false;
        stopAudio();
      }
      return;
    }

    const undidCalls = calledNow.length < prevCalledLenRef.current;
    prevCalledLenRef.current = calledNow.length;

    if (!baselineReadyRef.current) {
      spokenNumbersRef.current = new Set(calledNow);
      prevWinnerDeclaredRef.current = winnerDeclared;
      baselineReadyRef.current = true;
      return;
    }

    // Fully muted: align spoken set so enabling later does not dump history.
    if (!speechOn) {
      spokenNumbersRef.current = new Set(calledNow);
      prevWinnerDeclaredRef.current = winnerDeclared;
      prevUnlockedRef.current = false;
      return;
    }

    // Caller preference on but not unlocked yet — do NOT mark numbers spoken.
    if (!speechUnlocked) {
      prevWinnerDeclaredRef.current = winnerDeclared;
      prevUnlockedRef.current = false;
      return;
    }

    // Just unlocked: seed current board as already-heard, only future calls announce.
    if (!prevUnlockedRef.current) {
      prevUnlockedRef.current = true;
      spokenNumbersRef.current = new Set(calledNow);
      prevWinnerDeclaredRef.current = winnerDeclared;
      return;
    }

    // Undo: allow re-announcing numbers that return to the pool.
    if (undidCalls) {
      spokenNumbersRef.current = new Set(calledNow);
      prevWinnerDeclaredRef.current = winnerDeclared;
      return;
    }

    const newest = calledNow[calledNow.length - 1];
    if (newest != null && newest >= 1 && !spokenNumbersRef.current.has(newest)) {
      for (const n of calledNow) spokenNumbersRef.current.add(n);
      if (manualAnnounceRef.current.has(newest)) {
        manualAnnounceRef.current.delete(newest);
      } else {
        announceNumber(newest);
      }
    } else {
      for (const n of calledNow) spokenNumbersRef.current.add(n);
      if (newest != null) manualAnnounceRef.current.delete(newest);
    }

    const winnerJustEnabled = winnerDeclared && !prevWinnerDeclaredRef.current;
    prevWinnerDeclaredRef.current = winnerDeclared;
    if (winnerJustEnabled) {
      // Never cut off the number call — queue bingo until playback is idle.
      if (playbackBusyRef.current || audioHoldActiveRef.current) {
        pendingBingoRef.current = true;
      } else {
        playUtilityClipSync(callerClipUrl(callerVoiceRef.current, "bingo"));
      }
    }
  }, [
    active,
    hydrated,
    speechSupported,
    speechOn,
    speechUnlocked,
    calledSignature,
    winnerDeclared,
    announceNumber,
    playUtilityClipSync,
    stopAudio,
  ]);

  useEffect(() => {
    return () => {
      playGenerationRef.current += 1;
      playbackBusyRef.current = false;
      stopAudio();
      const ctx = audioContextRef.current;
      if (ctx) {
        void ctx.close().catch(() => undefined);
        audioContextRef.current = null;
      }
    };
  }, [stopAudio]);

  return {
    speechOn,
    jokesOn,
    speechUnlocked,
    speechSupported,
    speechRate,
    callerVoice,
    isAudioHoldActive,
    prefetchNumberClip,
    announceNumberNow,
    setSpeechRate,
    setCallerVoice,
    toggleSpeech,
    toggleJokes,
    setSpeechOn,
  };
}
