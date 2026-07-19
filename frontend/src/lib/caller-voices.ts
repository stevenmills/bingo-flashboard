/** Caller voice packs under `/cv/{F1,F2,M1,M2}/` — short paths for SPIFFS 31-char limit. */

export const CALLER_VOICE_STORAGE_KEY = "bingo-caller-voice";

export const CALLER_VOICE_IDS = ["Female1", "Female2", "Male1", "Male2"] as const;

export type CallerVoiceId = (typeof CALLER_VOICE_IDS)[number];

export const DEFAULT_CALLER_VOICE: CallerVoiceId = "Female1";

/** Filesystem path segment (must keep `/cv/{slug}/….mp3` ≤ 31 chars for SPIFFS). */
export const CALLER_VOICE_SLUG: Record<CallerVoiceId, string> = {
  Female1: "F1",
  Female2: "F2",
  Male1: "M1",
  Male2: "M2",
};

/** Single-file voice bundle — one HTTP fetch warms all clips (~1 MiB vs 80× SPIFFS hits). */
export function callerVoicePackUrl(voiceId: CallerVoiceId): string {
  return `/cv/${CALLER_VOICE_SLUG[voiceId]}/pack.bin`;
}

export const CALLER_VOICES: readonly { id: CallerVoiceId; label: string }[] = [
  { id: "Female1", label: "Female 1" },
  { id: "Female2", label: "Female 2" },
  { id: "Male1", label: "Male 1" },
  { id: "Male2", label: "Male 2" },
];

export function isCallerVoiceId(value: string): value is CallerVoiceId {
  return (CALLER_VOICE_IDS as readonly string[]).includes(value);
}

export function readCallerVoice(): CallerVoiceId {
  if (typeof window === "undefined") return DEFAULT_CALLER_VOICE;
  const raw = localStorage.getItem(CALLER_VOICE_STORAGE_KEY);
  if (raw && isCallerVoiceId(raw)) return raw;
  return DEFAULT_CALLER_VOICE;
}

export function writeCallerVoice(voice: CallerVoiceId): CallerVoiceId {
  localStorage.setItem(CALLER_VOICE_STORAGE_KEY, voice);
  return voice;
}

/** Clip basename without `.mp3` — e.g. `on`, `B-12`, `joke-O-67`, `example`. */
export function callerClipUrl(voiceId: CallerVoiceId, name: string): string {
  return `/cv/${CALLER_VOICE_SLUG[voiceId]}/${name}.mp3`;
}

/** Prefix used when discarding a deselected voice’s in-memory clip cache. */
export function callerVoiceCachePrefix(voiceId: CallerVoiceId): string {
  return `/cv/${CALLER_VOICE_SLUG[voiceId]}/`;
}

/** Settings preview clip — host intro for the selected voice pack. */
export const CALLER_EXAMPLE_CLIP = "example";
