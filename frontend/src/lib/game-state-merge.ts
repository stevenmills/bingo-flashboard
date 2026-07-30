import { DEFAULT_STATE, type GameState } from "@/types";

export function isValidSnapshot(state: GameState): boolean {
  if (!Array.isArray(state.called)) return false;
  if (typeof state.remaining !== "number") return false;
  const expectedCalledCount = 75 - state.remaining;
  if (expectedCalledCount < 0 || expectedCalledCount > 75) return false;
  return state.called.length === expectedCalledCount;
}

function looksLikeGameReset(_prev: GameState, next: GameState): boolean {
  return next.called.length === 0 && next.remaining === 75 && !next.gameEstablished;
}

export type MergeSnapshotOptions = {
  /** Allow fewer called numbers (undo / reset). Default rejects regressions. */
  allowCallRegression?: boolean;
};

/**
 * Apply a validated server snapshot.
 * Rejects stale mid-game snapshots that regress call progress — e.g. an
 * `auto_calling_changed` broadcast from audio-hold racing ahead of `/call`.
 */
export function mergeServerSnapshot(
  prev: GameState,
  next: GameState,
  options?: MergeSnapshotOptions
): GameState {
  if (!isValidSnapshot(next)) return prev;
  // Reject spurious empty payloads mid-game (stale poll during reconnect).
  if (next.called.length === 0 && prev.called.length > 0 && !looksLikeGameReset(prev, next)) {
    return prev;
  }
  if (
    !options?.allowCallRegression &&
    next.called.length < prev.called.length &&
    !looksLikeGameReset(prev, next)
  ) {
    return prev;
  }
  // Keep "current" aligned with call order so banner/UI don't flicker on
  // partial/stale snapshots that share the same called length.
  if (next.called.length > 0) {
    const last = next.called[next.called.length - 1];
    if (next.current !== last) {
      return { ...next, current: last };
    }
  }
  return next;
}

export function mergePartialState(prev: GameState, data: Record<string, unknown>): GameState {
  const next = { ...prev, ...data } as GameState;
  if ("called" in data) {
    return mergeServerSnapshot(prev, next);
  }
  return next;
}

export function initialGameState(): GameState {
  return DEFAULT_STATE;
}

/** Immediate UI state for a new/reset game — keeps settings, clears call progress. */
export function optimisticResetState(prev: GameState): GameState {
  return {
    ...prev,
    current: 0,
    called: [],
    remaining: 75,
    gameEstablished: false,
    winnerDeclared: false,
    manualWinnerDeclared: false,
    winnerEventId: 0,
    winnerCount: 0,
    patternIndex: 0,
    autoCallingEnabled: false,
    autoCallingHold: false,
    autoCallingRemainingMs: 0,
  };
}
