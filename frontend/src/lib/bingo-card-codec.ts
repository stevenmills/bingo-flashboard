import { LETTERS, LETTER_RANGES, type Letter } from "@/types";
import { generateBingoCard, type CardGrid } from "@/lib/card";
import { isStoredBoardSessionActive } from "@/lib/board-auth";
import { hmacSha256, utf8Encode } from "@/lib/hmac-sha256";

/** Flat 25 cells; center (12) is always null (FREE). */
export type FlatCardNumbers = Array<number | null>;

export type SignedPrintableCard = {
  numbers: FlatCardNumbers;
  /** HMAC-SHA256(deviceId, position||value…) truncated hex (32 chars). */
  sig: string;
  /** Uniqueness key for this batch (position+value, no salt). */
  contentHash: string;
};

export type QrCardClaim = {
  numbers: FlatCardNumbers;
  sig: string | null;
};

export function gridToFlatNumbers(grid: CardGrid): FlatCardNumbers {
  return grid.flat().map((cell, idx) => (idx === 12 || cell.isFree ? null : cell.value));
}

export function flatNumbersToGrid(numbers: FlatCardNumbers): CardGrid | null {
  if (!Array.isArray(numbers) || numbers.length !== 25) return null;
  for (let col = 0; col < 5; col++) {
    const letter = LETTERS[col] as Letter;
    const [min, max] = LETTER_RANGES[letter];
    const colVals: number[] = [];
    for (let row = 0; row < 5; row++) {
      const idx = row * 5 + col;
      if (idx === 12) continue;
      const n = numbers[idx];
      if (typeof n !== "number" || n < min || n > max) return null;
      if (colVals.includes(n)) return null;
      colVals.push(n);
    }
  }
  if (numbers[12] != null) return null;

  return Array.from({ length: 5 }, (_, rowIdx) =>
    Array.from({ length: 5 }, (_, colIdx) => {
      const idx = rowIdx * 5 + colIdx;
      const isFree = idx === 12;
      return {
        letter: LETTERS[colIdx],
        value: isFree ? null : numbers[idx],
        isFree,
        marked: isFree,
      };
    })
  );
}

/** Compact URL-safe payload: 24 bytes (center FREE implied). */
export function encodeCardPayload(numbers: FlatCardNumbers): string {
  const bytes = new Uint8Array(24);
  let i = 0;
  for (let idx = 0; idx < 25; idx++) {
    if (idx === 12) continue;
    const n = numbers[idx];
    bytes[i++] = typeof n === "number" && n >= 1 && n <= 75 ? n : 0;
  }
  let bin = "";
  for (let b = 0; b < bytes.length; b++) bin += String.fromCharCode(bytes[b]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeCardPayload(payload: string): FlatCardNumbers | null {
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const b64 = padded + "=".repeat(padLen);
    const bin = atob(b64);
    if (bin.length !== 24) return null;
    const numbers: FlatCardNumbers = new Array(25).fill(null);
    let i = 0;
    for (let idx = 0; idx < 25; idx++) {
      if (idx === 12) {
        numbers[idx] = null;
        continue;
      }
      const n = bin.charCodeAt(i++);
      if (n < 1 || n > 75) return null;
      numbers[idx] = n;
    }
    return flatNumbersToGrid(numbers) ? numbers : null;
  } catch {
    return null;
  }
}

/** Position+value fingerprint for deduping a generation batch (no board salt). */
export function cardContentFingerprint(numbers: FlatCardNumbers): string {
  const parts: string[] = [];
  for (let idx = 0; idx < 25; idx++) {
    if (idx === 12) continue;
    parts.push(`${idx}:${numbers[idx] ?? 0}`);
  }
  return parts.join("|");
}

function buildAuthMessageBytes(numbers: FlatCardNumbers): Uint8Array {
  const msg = new Uint8Array(48);
  let i = 0;
  for (let idx = 0; idx < 25; idx++) {
    if (idx === 12) continue;
    msg[i++] = idx & 0xff;
    msg[i++] = (typeof numbers[idx] === "number" ? numbers[idx]! : 0) & 0xff;
  }
  return msg;
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < arr.length; i++) out += arr[i]!.toString(16).padStart(2, "0");
  return out;
}

/** HMAC-SHA256 with deviceId salt; returns first 16 bytes as hex (32 chars). */
export async function signCardWithDeviceId(
  numbers: FlatCardNumbers,
  deviceId: string
): Promise<string> {
  const msg = buildAuthMessageBytes(numbers);
  // Prefer Web Crypto when available (HTTPS / localhost); pure JS works on HTTP AP pages.
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const key = await subtle.importKey(
        "raw",
        utf8Encode(deviceId),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const mac = await subtle.sign("HMAC", key, msg);
      return bytesToHex(mac).slice(0, 32);
    } catch {
      // Fall through (e.g. insecure context where subtle exists but rejects).
    }
  }
  return bytesToHex(hmacSha256(utf8Encode(deviceId), msg)).slice(0, 32);
}

export function buildCardClaimUrl(
  numbers: FlatCardNumbers,
  origin?: string,
  sig?: string | null
): string {
  const base =
    origin ||
    (typeof window !== "undefined" ? window.location.origin : "http://bingo.local");
  const c = encodeCardPayload(numbers);
  let url = `${base.replace(/\/$/, "")}/?mode=card&claim=1&c=${c}`;
  if (sig) url += `&s=${encodeURIComponent(sig)}`;
  return url;
}

/**
 * Generate unique cards (by position+value fingerprint) and sign each with the board salt.
 */
export async function generateSignedPrintableCards(
  count: number,
  deviceId: string
): Promise<SignedPrintableCard[]> {
  const n = Math.max(1, Math.min(200, Math.round(count)));
  const cards: SignedPrintableCard[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (cards.length < n && guard < n * 40) {
    guard++;
    const flat = gridToFlatNumbers(generateBingoCard());
    const contentHash = cardContentFingerprint(flat);
    if (seen.has(contentHash)) continue;
    seen.add(contentHash);
    const sig = await signCardWithDeviceId(flat, deviceId);
    cards.push({ numbers: flat, sig, contentHash });
  }
  return cards;
}

/** @deprecated Prefer generateSignedPrintableCards when a deviceId is available. */
export function generatePrintableCards(count: number): FlatCardNumbers[] {
  const n = Math.max(1, Math.min(200, Math.round(count)));
  const cards: FlatCardNumbers[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (cards.length < n && guard < n * 40) {
    guard++;
    const flat = gridToFlatNumbers(generateBingoCard());
    const key = cardContentFingerprint(flat);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(flat);
  }
  return cards;
}

export const QR_CARD_STORAGE_KEY = "bingo-qr-claim-card";
export const QR_CARD_SIG_STORAGE_KEY = "bingo-qr-claim-sig";
/** When set, an authenticated board host should verify the stashed QR card. */
export const QR_BOARD_VERIFY_KEY = "bingo-qr-board-verify";

export type QrClaimRoute = "card" | "board" | null;

/**
 * Parse claim query (`?mode=card&claim=1&c=…&s=…`), stash payload, route by auth.
 */
export function bootstrapQrCardClaim(appModeStorageKey = "bingo-app-mode"): QrClaimRoute {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const payload = params.get("c") || params.get("n");
  const sig = params.get("s");
  const modeCard = params.get("mode") === "card";
  const claimFlag = params.get("claim") === "1";
  const looksLikeClaim = Boolean(payload) && (modeCard || claimFlag);

  let route: QrClaimRoute = null;
  if (looksLikeClaim && payload) {
    const decoded = decodeCardPayload(payload);
    if (decoded) {
      sessionStorage.setItem(QR_CARD_STORAGE_KEY, payload);
      if (sig) sessionStorage.setItem(QR_CARD_SIG_STORAGE_KEY, sig);
      else sessionStorage.removeItem(QR_CARD_SIG_STORAGE_KEY);
      if (isStoredBoardSessionActive()) {
        sessionStorage.setItem(appModeStorageKey, "board");
        sessionStorage.setItem(QR_BOARD_VERIFY_KEY, "1");
        route = "board";
      } else {
        sessionStorage.setItem(appModeStorageKey, "card");
        sessionStorage.removeItem(QR_BOARD_VERIFY_KEY);
        route = "card";
      }
    }
  }

  if (params.has("c") || params.has("n") || params.has("mode") || params.has("claim") || params.has("s")) {
    const clean = window.location.pathname || "/";
    window.history.replaceState({}, "", clean);
  }

  return route;
}

export function isQrBoardVerifyPending(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(QR_BOARD_VERIFY_KEY) === "1";
}

export function clearQrBoardVerifyFlag(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(QR_BOARD_VERIFY_KEY);
}

/** Consume a stashed QR claim payload (once). */
export function takeQrCardClaim(): QrCardClaim | null {
  if (typeof window === "undefined") return null;
  const payload = sessionStorage.getItem(QR_CARD_STORAGE_KEY);
  const sig = sessionStorage.getItem(QR_CARD_SIG_STORAGE_KEY);
  sessionStorage.removeItem(QR_CARD_STORAGE_KEY);
  sessionStorage.removeItem(QR_CARD_SIG_STORAGE_KEY);
  if (!payload) return null;
  const numbers = decodeCardPayload(payload);
  if (!numbers) return null;
  return { numbers, sig: sig || null };
}
