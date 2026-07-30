import { useEffect, useRef, useState } from "react";

interface AutoCallingProgressBarProps {
  running: boolean;
  intervalSeconds: number;
  remainingMs: number;
  serverHold: boolean;
  isAudioHold: () => boolean;
  color: string;
  /** Thicker, higher-contrast bar for HUD / TV display. */
  prominent?: boolean;
}

/** Re-sync local deadline only when server disagree by more than this (ms). */
const DRIFT_RESYNC_MS = 800;

/**
 * Smooth auto-call countdown.
 * Firmware remainingMs is the authority; the next interval starts only after
 * call-out audio (+ jokes) finishes (remainingMs is 0 while held).
 * Local deadline avoids fighting the 250ms WS progress ticks.
 */
export function AutoCallingProgressBar({
  running,
  intervalSeconds,
  remainingMs,
  serverHold: _serverHold,
  isAudioHold: _isAudioHold,
  color,
  prominent = false,
}: AutoCallingProgressBarProps) {
  const [displayMs, setDisplayMs] = useState(0);
  /** performance.now() when the countdown should hit zero. */
  const deadlineRef = useRef<number | null>(null);
  const remainingMsRef = useRef(remainingMs);
  remainingMsRef.current = remainingMs;

  // Arm / re-arm from server. Ignore small jitter ticks.
  useEffect(() => {
    if (!running) {
      deadlineRef.current = null;
      setDisplayMs(0);
      return;
    }

    if (remainingMs <= 0) {
      deadlineRef.current = null;
      setDisplayMs(0);
      return;
    }

    const now = performance.now();
    const expected =
      deadlineRef.current != null ? Math.max(0, deadlineRef.current - now) : null;
    const drift = expected == null ? Number.POSITIVE_INFINITY : Math.abs(expected - remainingMs);

    // Re-arm after a draw (remaining jumps back up) or large drift.
    const jumpedUp =
      expected != null && remainingMs > expected + DRIFT_RESYNC_MS;

    if (deadlineRef.current == null || drift > DRIFT_RESYNC_MS || jumpedUp) {
      deadlineRef.current = now + remainingMs;
      setDisplayMs(remainingMs);
    }
  }, [running, remainingMs, intervalSeconds]);

  // Steady local tick — do NOT depend on remainingMs (that caused fighting timers).
  useEffect(() => {
    if (!running) {
      setDisplayMs(0);
      return;
    }

    const tick = () => {
      if (deadlineRef.current == null) {
        const serverRemaining = remainingMsRef.current;
        if (serverRemaining > 0) {
          deadlineRef.current = performance.now() + serverRemaining;
          setDisplayMs(serverRemaining);
        } else {
          setDisplayMs(0);
        }
        return;
      }
      setDisplayMs(Math.max(0, deadlineRef.current - performance.now()));
    };

    tick();
    const intervalId = window.setInterval(tick, 50);
    return () => window.clearInterval(intervalId);
  }, [running]);

  if (!running) return null;

  const intervalMs = Math.max(1000, intervalSeconds * 1000);
  const pct = Math.min(100, Math.max(0, (displayMs / intervalMs) * 100));

  return (
    <div
      className={
        prominent
          ? "absolute left-0 right-0 top-0 h-2.5 bg-muted/60 pointer-events-none overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
          : "absolute left-0 right-0 top-0 h-0.5 bg-transparent pointer-events-none overflow-hidden"
      }
    >
      <div
        className="h-full ml-auto transition-[width] duration-75 ease-linear"
        style={{
          backgroundColor: color,
          width: `${pct}%`,
          boxShadow: prominent ? `0 0 12px ${color}` : undefined,
        }}
      />
    </div>
  );
}
