import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "bingo-auto-seconds";
const DEFAULT_SECONDS = 30;
const MIN_SECONDS = 1;
const MAX_SECONDS = 600;

function clampSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SECONDS;
  return Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.round(value)));
}

function readInitialSeconds(): number {
  if (typeof window === "undefined") return DEFAULT_SECONDS;
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_SECONDS;
  return clampSeconds(parsed);
}

interface UseAutoCallingTimerOptions {
  onElapsed?: () => Promise<boolean> | boolean;
}

interface UseAutoCallingTimerState {
  isRunning: boolean;
  seconds: number;
  progressRemaining: number; // 1 -> 0 for loader
  setSeconds: (value: number) => void;
  start: () => void;
  pause: () => void;
  toggle: () => void;
}

export function useAutoCallingTimer(options: UseAutoCallingTimerOptions = {}): UseAutoCallingTimerState {
  const { onElapsed } = options;
  const [seconds, setSecondsState] = useState<number>(() => readInitialSeconds());
  const [isRunning, setIsRunning] = useState(false);
  const [progressRemaining, setProgressRemaining] = useState(1);

  const onElapsedRef = useRef(onElapsed);
  const runningRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const durationMsRef = useRef(seconds * 1000);
  const remainingMsRef = useRef(seconds * 1000);
  const endTimeRef = useRef<number>(0);
  const firingRef = useRef(false);

  useEffect(() => {
    onElapsedRef.current = onElapsed;
  }, [onElapsed]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(seconds));
    durationMsRef.current = seconds * 1000;
    if (!runningRef.current) {
      remainingMsRef.current = durationMsRef.current;
      setProgressRemaining(1);
    }
  }, [seconds]);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const runTick = useCallback(() => {
    const tick = async () => {
      if (!runningRef.current) return;
      const now = performance.now();
      const remaining = Math.max(0, endTimeRef.current - now);
      setProgressRemaining(durationMsRef.current <= 0 ? 0 : remaining / durationMsRef.current);

      if (remaining <= 0) {
        if (firingRef.current) return;
        firingRef.current = true;
        stopRaf();
        const shouldContinue = (await onElapsedRef.current?.()) ?? true;
        firingRef.current = false;
        if (runningRef.current && shouldContinue) {
          remainingMsRef.current = durationMsRef.current;
          endTimeRef.current = performance.now() + remainingMsRef.current;
          setProgressRemaining(1);
          rafRef.current = requestAnimationFrame(tick);
        } else {
          runningRef.current = false;
          setIsRunning(false);
          setProgressRemaining(1);
          remainingMsRef.current = durationMsRef.current;
        }
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [stopRaf]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);
    if (remainingMsRef.current <= 0) {
      remainingMsRef.current = durationMsRef.current;
    }
    endTimeRef.current = performance.now() + remainingMsRef.current;
    setProgressRemaining(durationMsRef.current <= 0 ? 0 : remainingMsRef.current / durationMsRef.current);
    stopRaf();
    runTick();
  }, [runTick, stopRaf]);

  const pause = useCallback(() => {
    const now = performance.now();
    remainingMsRef.current = runningRef.current ? Math.max(0, endTimeRef.current - now) : remainingMsRef.current;
    runningRef.current = false;
    setIsRunning(false);
    setProgressRemaining(durationMsRef.current <= 0 ? 0 : remainingMsRef.current / durationMsRef.current);
    stopRaf();
  }, [stopRaf]);

  const toggle = useCallback(() => {
    if (runningRef.current) {
      pause();
    } else {
      start();
    }
  }, [pause, start]);

  const setSeconds = useCallback(
    (value: number) => {
      const clamped = clampSeconds(value);
      setSecondsState(clamped);
      if (runningRef.current) {
        // Per requirement: when seconds changes mid-countdown, reset immediately.
        remainingMsRef.current = clamped * 1000;
        endTimeRef.current = performance.now() + remainingMsRef.current;
        setProgressRemaining(1);
      } else {
        remainingMsRef.current = clamped * 1000;
        setProgressRemaining(1);
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      stopRaf();
      runningRef.current = false;
    };
  }, [stopRaf]);

  return {
    isRunning,
    seconds,
    progressRemaining,
    setSeconds,
    start,
    pause,
    toggle,
  };
}
