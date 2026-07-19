import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api";
import { numberToLetter } from "@/types";

const STORAGE_KEY = "bingo-caller-speech";
const JOKES_STORAGE_KEY = "bingo-caller-jokes";
export const CALLER_SPEECH_RATE_KEY = "bingo-caller-speech-rate";
export const DEFAULT_CALLER_SPEECH_RATE = 0.85;
export const MIN_CALLER_SPEECH_RATE = 0.6;
export const MAX_CALLER_SPEECH_RATE = 1.2;

/** Numbers with a supplemental joke clip at /caller-joke-{Letter}-{n}.mp3 */
const JOKE_NUMBERS = new Set<number>([4, 67]);

/** Pause after the number call-out before playing a joke clip. */
const JOKE_AFTER_NUMBER_PAUSE_MS = 1000;

/**
 * Concurrent HTTP-cache warm batch size + gap between batches.
 * Bunching downloads SPIFFS clips faster while still yielding so play fetches can win.
 */
const PREFETCH_BATCH_DESKTOP = 6;
const PREFETCH_BATCH_MOBILE = 3;
const PREFETCH_BATCH_GAP_DESKTOP_MS = 40;
const PREFETCH_BATCH_GAP_MOBILE_MS = 100;

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

function callerClipUrl(name: string): string {
  return `/caller-${name}.mp3`;
}

function numberClipUrl(n: number): string {
  const letter = numberToLetter(n);
  return callerClipUrl(`${letter}-${n}`);
}

function jokeClipUrl(n: number): string | null {
  if (!JOKE_NUMBERS.has(n)) return null;
  const letter = numberToLetter(n);
  return `/caller-joke-${letter}-${n}.mp3`;
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
  /** Board mode + authenticated + connected. */
  active: boolean;
  /** Full call order — newest number is at the end. */
  called: number[];
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
  /** Read whether call-out audio is currently holding the auto-call timer (ref-based). */
  isAudioHoldActive: () => boolean;
  /** Start loading a number clip (e.g. on pointer-down before tap completes). */
  prefetchNumberClip: (n: number) => void;
  /** Play call-out immediately on manual tap — do not wait for server round-trip. */
  announceNumberNow: (n: number) => void;
  setSpeechRate: (rate: number) => void;
  /** Call from a click/tap handler only. */
  toggleSpeech: () => void;
  toggleJokes: () => void;
  setSpeechOn: (on: boolean) => void;
}

export function useCallerSpeech(options: UseCallerSpeechOptions): UseCallerSpeechState {
  const { active, called, winnerDeclared, hydrated, autoCallingEnabled } = options;
  const [speechOn, setSpeechOnState] = useState<boolean>(() => readInitialSpeechOn());
  // Always start off for the page session.
  const [jokesOn, setJokesOnState] = useState(false);
  const [speechUnlocked, setSpeechUnlocked] = useState(false);
  const [speechRate, setSpeechRateState] = useState<number>(() => readCallerSpeechRate());
  const [speechSupported] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      (typeof Audio !== "undefined" ||
        window.AudioContext != null ||
        (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext != null)
  );

  const baselineReadyRef = useRef(false);
  const spokenNumbersRef = useRef<Set<number>>(new Set());
  const prevWinnerDeclaredRef = useRef(false);
  const prevUnlockedRef = useRef(false);
  const speechOnRef = useRef(speechOn);
  const jokesOnRef = useRef(jokesOn);
  const speechUnlockedRef = useRef(speechUnlocked);
  const calledRef = useRef(called);
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
  /** Bumps cancel in-flight number / joke prefetch queues. */
  const numberPrefetchGenRef = useRef(0);
  const jokePrefetchGenRef = useRef(0);
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
    autoCallingEnabledRef.current = autoCallingEnabled;
  }, [autoCallingEnabled]);

  useEffect(() => {
    activeRef.current = active;
    if (active) mayNotifyBoardAudioRef.current = true;
  }, [active]);

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

  const beginAutoCallingHold = useCallback(() => {
    if (!activeRef.current) return;
    if (!speechOnRef.current || !speechUnlockedRef.current) return;
    // Mark call-out in progress (even when auto-calling is off) so winner mode waits.
    if (audioHoldActiveRef.current) return;
    audioHoldActiveRef.current = true;
    notifyBoardAutoCallingHold(true);
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
  const stopAudio = useCallback(() => {
    const html = activeHtmlAudioRef.current ?? sharedAudioRef.current;
    if (!html) return;
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
  }, []);

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

  /** Warm HTTP cache only (no Web Audio decode). Cheap and works for HTML Audio later. */
  const warmHttpCache = useCallback((url: string): Promise<void> => {
    if (httpCacheWarmedRef.current.has(url)) return Promise.resolve();
    httpCacheWarmedRef.current.add(url);
    return fetch(url, { cache: "force-cache", credentials: "same-origin" })
      .then((res) => {
        if (res.ok) return res.arrayBuffer().then(() => undefined);
        // Allow a later retry if the first warm failed.
        httpCacheWarmedRef.current.delete(url);
      })
      .catch(() => {
        httpCacheWarmedRef.current.delete(url);
      });
  }, []);

  const waitWhilePrefetchBlocked = useCallback(async (alive: () => boolean) => {
    while (playbackBusyRef.current || autoCallingEnabledRef.current) {
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
    (url: string, rate: number, generation: number): Promise<void> => {
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
          audio.playbackRate = rate;
        } catch {
          // Some browsers reject extreme rates; ignore.
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
              }
              finish();
            }
          );
        };

        audio.onloadeddata = () => tryPlay();
        audio.src = url;
        audio.load();
        // Fallback if loadeddata is late/missed.
        window.setTimeout(tryPlay, 350);
      });
    },
    [ensureAudioContext, ensureSharedAudio, stopAudio]
  );

  /** Sync start for unlock / jokes-on / bingo — must not await before play(). */
  const playUtilityClipSync = useCallback(
    (url: string, rate: number) => {
      playGenerationRef.current += 1;
      const generation = playGenerationRef.current;
      const audio = ensureSharedAudio();
      if (!audio) return;
      stopAudio();
      playbackBusyRef.current = true;
      activeHtmlAudioRef.current = audio;
      try {
        audio.volume = CALLER_PLAYBACK_VOLUME;
        audio.playbackRate = rate;
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
      audio.src = url;
      void audio.play().catch((err: unknown) => {
        const name =
          err && typeof err === "object" && "name" in err
            ? String((err as { name?: string }).name)
            : "";
        if (name === "NotAllowedError") markUnlockLostRef.current();
        if (generation === playGenerationRef.current) playbackBusyRef.current = false;
      });
    },
    [ensureSharedAudio, stopAudio]
  );

  /** Number call-outs only — starts when caller speech is unlocked/on. */
  const prefetchNumberClipsInBackground = useCallback(() => {
    const gen = ++numberPrefetchGenRef.current;
    const alive = () =>
      gen === numberPrefetchGenRef.current &&
      speechUnlockedRef.current &&
      speechOnRef.current;

    void (async () => {
      const urls = [
        callerClipUrl("on"),
        callerClipUrl("bingo"),
        ...Array.from({ length: 75 }, (_, i) => numberClipUrl(i + 1)),
      ];
      await warmHttpCacheBunched(urls, alive);
    })();
  }, [warmHttpCacheBunched]);

  /** Joke clips only — starts when jokes are turned on. */
  const prefetchJokeClipsInBackground = useCallback(() => {
    const gen = ++jokePrefetchGenRef.current;
    const alive = () =>
      gen === jokePrefetchGenRef.current &&
      speechUnlockedRef.current &&
      speechOnRef.current &&
      jokesOnRef.current;

    void (async () => {
      const urls = [
        callerClipUrl("jokes-on"),
        ...[...JOKE_NUMBERS]
          .map((n) => jokeClipUrl(n))
          .filter((u): u is string => Boolean(u)),
      ];
      await warmHttpCacheBunched(urls, alive);
    })();
  }, [warmHttpCacheBunched]);

  const cancelNumberPrefetch = useCallback(() => {
    numberPrefetchGenRef.current += 1;
  }, []);

  const cancelJokePrefetch = useCallback(() => {
    jokePrefetchGenRef.current += 1;
  }, []);

  const announceNumber = useCallback(
    (n: number) => {
      if (n < 1 || n > 75) return;
      const rate = readCallerSpeechRate();
      const generation = ++playGenerationRef.current;
      const clipUrl = numberClipUrl(n);
      const jokeUrl = jokesOnRef.current ? jokeClipUrl(n) : null;
      // Avoid competing SPIFFS fetches right before play on phones.
      if (!mobileRef.current) {
        warmHttpCache(clipUrl);
        if (jokeUrl) warmHttpCache(jokeUrl);
      }

      void (async () => {
        beginAutoCallingHold();
        playbackBusyRef.current = true;
        try {
          await ensureAudioContext();
          await playHtmlClip(clipUrl, rate, generation);
          if (generation !== playGenerationRef.current) return;
          if (jokesOnRef.current && jokeUrl) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, JOKE_AFTER_NUMBER_PAUSE_MS);
            });
            if (generation !== playGenerationRef.current) return;
            if (jokesOnRef.current) {
              await playHtmlClip(jokeUrl, rate, generation);
            }
          }
        } finally {
          if (generation === playGenerationRef.current) {
            playbackBusyRef.current = false;
            const playBingo = pendingBingoRef.current;
            pendingBingoRef.current = false;
            // Release hold first so firmware activates deferred winner mode, then bingo audio.
            releaseAutoCallingHold(true);
            if (playBingo) {
              playUtilityClipSync(callerClipUrl("bingo"), readCallerSpeechRate());
            }
          }
        }
      })();
    },
    [
      beginAutoCallingHold,
      ensureAudioContext,
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
      warmHttpCache(numberClipUrl(n));
      if (jokesOnRef.current) {
        const jokeUrl = jokeClipUrl(n);
        if (jokeUrl) warmHttpCache(jokeUrl);
      }
    },
    [warmHttpCache]
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
        cancelNumberPrefetch();
        cancelJokePrefetch();
        setJokesOn(false);
        playGenerationRef.current += 1;
        playbackBusyRef.current = false;
        stopAudio();
        notifyBoardWaitForAudio(false);
        void releaseAutoCallingHold(true);
      }
    },
    [
      cancelJokePrefetch,
      cancelNumberPrefetch,
      notifyBoardWaitForAudio,
      releaseAutoCallingHold,
      setJokesOn,
      stopAudio,
    ]
  );

  const setSpeechRate = useCallback((rate: number) => {
    setSpeechRateState(writeCallerSpeechRate(rate));
  }, []);

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
    const url = callerClipUrl("on");
    const rate = readCallerSpeechRate();
    playUtilityClipSync(url, rate);

    void (async () => {
      await ensureAudioContext();
      prefetchNumberClipsInBackground();
    })();
  }, [
    ensureAudioContext,
    ensureSharedAudio,
    notifyBoardWaitForAudio,
    playUtilityClipSync,
    prefetchNumberClipsInBackground,
    speechSupported,
  ]);

  const markUnlockLost = useCallback(() => {
    if (!speechUnlockedRef.current) return;
    speechUnlockedRef.current = false;
    prevUnlockedRef.current = false;
    setSpeechUnlocked(false);
    cancelNumberPrefetch();
    cancelJokePrefetch();
    notifyBoardWaitForAudio(false);
    void releaseAutoCallingHold(true);
  }, [cancelJokePrefetch, cancelNumberPrefetch, notifyBoardWaitForAudio, releaseAutoCallingHold]);

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
      cancelJokePrefetch();
      setJokesOn(false);
      return;
    }

    setJokesOn(true);
    playUtilityClipSync(callerClipUrl("jokes-on"), readCallerSpeechRate());
    prefetchJokeClipsInBackground();
  }, [
    cancelJokePrefetch,
    playUtilityClipSync,
    prefetchJokeClipsInBackground,
    setJokesOn,
    speechSupported,
  ]);

  // Reset baselines when leaving board mode (not while waiting for initial hydrate).
  useEffect(() => {
    if (active) return;
    baselineReadyRef.current = false;
    prevUnlockedRef.current = false;
    cancelNumberPrefetch();
    cancelJokePrefetch();
    playGenerationRef.current += 1;
    playbackBusyRef.current = false;
    stopAudio();
    // Only clear firmware wait-audio/hold if this tab was the board caller.
    if (!mayNotifyBoardAudioRef.current) return;
    mayNotifyBoardAudioRef.current = false;
    void api.setAutoCallingWaitForAudio(false).catch(() => undefined);
    void api.setAutoCallingHold(false).catch(() => undefined);
    audioHoldActiveRef.current = false;
  }, [active, cancelJokePrefetch, cancelNumberPrefetch, stopAudio]);

  // Warm short speech utilities once board mode is live (jokes cache separately).
  useEffect(() => {
    if (!active || !speechSupported) return;
    for (const name of ["on", "bingo"] as const) {
      warmHttpCache(callerClipUrl(name));
    }
  }, [active, speechSupported, warmHttpCache]);

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
          } catch {
            // Ignore.
          }
        },
        () => {
          try {
            audio.volume = CALLER_PLAYBACK_VOLUME;
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
  }, [ensureAudioContext, ensureSharedAudio, speechUnlocked]);

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
              } catch {
                // Ignore.
              }
            }, 80);
          },
          (err: unknown) => {
            try {
              audio.volume = CALLER_PLAYBACK_VOLUME;
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
        } catch {
          // Ignore.
        }
      }
    };
    const id = window.setInterval(tick, AUDIO_KEEPALIVE_MS);
    return () => window.clearInterval(id);
  }, [active, ensureAudioContext, ensureSharedAudio, speechOn, speechUnlocked]);

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
    prevCalledLenRef.current = calledNow.length;

    if (!baselineReadyRef.current) {
      spokenNumbersRef.current = new Set(calledNow);
      prevWinnerDeclaredRef.current = winnerDeclared;
      baselineReadyRef.current = true;
      return;
    }

    // Fully muted: align spoken set so enabling later does not dump history.
    if (!speechOn) {
      for (const n of calledNow) spokenNumbersRef.current.add(n);
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
        playUtilityClipSync(callerClipUrl("bingo"), readCallerSpeechRate());
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
    isAudioHoldActive,
    prefetchNumberClip,
    announceNumberNow,
    setSpeechRate,
    toggleSpeech,
    toggleJokes,
    setSpeechOn,
  };
}
