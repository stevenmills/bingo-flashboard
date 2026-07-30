import { LETTERS, LETTER_RANGES, type Letter } from "@/types";
import {
  generateBingoCard,
  readCardFillRange,
  type CardGrid,
} from "@/lib/card";
import { isStoredBoardSessionActive } from "@/lib/board-auth";
import { hmacSha256, utf8Encode } from "@/lib/hmac-sha256";

/** Flat 25 cells; null = FREE (center) or blank (unfilled). */
export type FlatCardNumbers = Array<number | null>;

export type SignedPrintableCard = {
  numbers: FlatCardNumbers;
  /** HMAC-SHA256(deviceId, …) truncated hex (32 chars). */
  sig: string;
  contentHash: string;
};

export type QrCardClaim = {
  numbers: FlatCardNumbers;
  sig: string | null;
};

export function gridToFlatNumbers(grid: CardGrid): FlatCardNumbers {
  return grid.flat().map((cell) => (cell.isFree || cell.isBlank || cell.value == null ? null : cell.value));
}

function populatedCount(numbers: FlatCardNumbers): number {
  let n = 0;
  for (let i = 0; i < 25; i++) {
    if (i === 12) {
      n++; // FREE always counts
      continue;
    }
    if (typeof numbers[i] === "number") n++;
  }
  return n;
}

/** Validate column rules; FREE at center; blanks allowed; 1–25 populated (incl FREE). */
export function flatNumbersToBingoGrid(numbers: FlatCardNumbers): CardGrid | null {
  if (!Array.isArray(numbers) || numbers.length !== 25) return null;
  if (numbers[12] != null) return null;
  if (populatedCount(numbers) < 1 || populatedCount(numbers) > 25) return null;

  const seen = new Set<number>();
  for (let col = 0; col < 5; col++) {
    const letter = LETTERS[col] as Letter;
    const [min, max] = LETTER_RANGES[letter];
    const colVals: number[] = [];
    for (let row = 0; row < 5; row++) {
      const idx = row * 5 + col;
      if (idx === 12) continue;
      const n = numbers[idx];
      if (n == null) continue;
      if (typeof n !== "number" || n < min || n > max) return null;
      if (colVals.includes(n) || seen.has(n)) return null;
      colVals.push(n);
      seen.add(n);
    }
  }

  return Array.from({ length: 5 }, (_, rowIdx) =>
    Array.from({ length: 5 }, (_, colIdx) => {
      const idx = rowIdx * 5 + colIdx;
      const isFree = idx === 12;
      const value = numbers[idx];
      const isBlank = !isFree && value == null;
      return {
        letter: LETTERS[colIdx],
        value: isFree || isBlank ? null : value,
        isFree,
        isBlank,
        marked: isFree,
      };
    })
  );
}

export function flatNumbersToGrid(numbers: FlatCardNumbers): CardGrid | null {
  return flatNumbersToBingoGrid(numbers);
}

function cardIsFullyPopulated(numbers: FlatCardNumbers): boolean {
  for (let i = 0; i < 25; i++) {
    if (i === 12) continue;
    if (typeof numbers[i] !== "number") return false;
  }
  return numbers[12] == null;
}

/** Legacy v1: 24 bytes, center FREE implied — full cards only. */
export function encodeCardPayloadV1(numbers: FlatCardNumbers): string {
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

/**
 * v2 sparse-capable: "B2." + version + 25 cell bytes (0 = blank/FREE at center).
 * Used when the card has unfilled cells.
 */
export function encodeCardPayloadV2(numbers: FlatCardNumbers): string {
  const bytes = new Uint8Array(26);
  bytes[0] = 2;
  for (let i = 0; i < 25; i++) {
    const n = numbers[i];
    bytes[1 + i] = typeof n === "number" && n >= 1 && n <= 75 ? n : 0;
  }
  let bin = "";
  for (let b = 0; b < bytes.length; b++) bin += String.fromCharCode(bytes[b]);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `B2.${b64}`;
}

export function encodeCardPayload(numbers: FlatCardNumbers): string {
  if (cardIsFullyPopulated(numbers)) return encodeCardPayloadV1(numbers);
  return encodeCardPayloadV2(numbers);
}

export type DecodedCardPayload = {
  numbers: FlatCardNumbers;
};

export function decodeCardPayload(payload: string): FlatCardNumbers | null {
  return decodeCardPayloadWithStyle(payload)?.numbers ?? null;
}

/** Decode legacy H2./v1/B2. payloads into a bingo grid with FREE center. */
export function decodeCardPayloadWithStyle(payload: string): DecodedCardPayload | null {
  try {
    if (payload.startsWith("B2.")) {
      const padded = payload.slice(3).replace(/-/g, "+").replace(/_/g, "/");
      const padLen = (4 - (padded.length % 4)) % 4;
      const b64 = padded + "=".repeat(padLen);
      const bin = atob(b64);
      if (bin.length !== 26 || bin.charCodeAt(0) !== 2) return null;
      const numbers: FlatCardNumbers = new Array(25).fill(null);
      for (let i = 0; i < 25; i++) {
        const n = bin.charCodeAt(1 + i);
        numbers[i] = n >= 1 && n <= 75 ? n : null;
      }
      numbers[12] = null; // FREE
      if (!flatNumbersToBingoGrid(numbers)) return null;
      return { numbers };
    }

    if (payload.startsWith("H2.")) {
      // Legacy housey-style payloads: force FREE at center.
      const padded = payload.slice(3).replace(/-/g, "+").replace(/_/g, "/");
      const padLen = (4 - (padded.length % 4)) % 4;
      const b64 = padded + "=".repeat(padLen);
      const bin = atob(b64);
      if (bin.length !== 27 || bin.charCodeAt(0) !== 2) return null;
      const numbers: FlatCardNumbers = new Array(25).fill(null);
      for (let i = 0; i < 25; i++) {
        const n = bin.charCodeAt(2 + i);
        numbers[i] = n >= 1 && n <= 75 ? n : null;
      }
      numbers[12] = null;
      if (!flatNumbersToBingoGrid(numbers)) return null;
      return { numbers };
    }

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
    if (!flatNumbersToBingoGrid(numbers)) return null;
    return { numbers };
  } catch {
    return null;
  }
}

export function cardContentFingerprint(numbers: FlatCardNumbers): string {
  const parts: string[] = ["v3"];
  for (let idx = 0; idx < 25; idx++) {
    parts.push(`${idx}:${numbers[idx] ?? 0}`);
  }
  return parts.join("|");
}

function buildAuthMessageBytes(numbers: FlatCardNumbers): Uint8Array {
  if (cardIsFullyPopulated(numbers)) {
    const msg = new Uint8Array(48);
    let i = 0;
    for (let idx = 0; idx < 25; idx++) {
      if (idx === 12) continue;
      msg[i++] = idx & 0xff;
      msg[i++] = (typeof numbers[idx] === "number" ? numbers[idx]! : 0) & 0xff;
    }
    return msg;
  }
  const domain = utf8Encode("bingo-card-v2");
  const msg = new Uint8Array(domain.length + 1 + 50);
  msg.set(domain, 0);
  let i = domain.length;
  msg[i++] = 1;
  for (let idx = 0; idx < 25; idx++) {
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

export async function signCardWithDeviceId(numbers: FlatCardNumbers, deviceId: string): Promise<string> {
  const msg = buildAuthMessageBytes(numbers);
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
      // Fall through
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

export async function generateSignedPrintableCards(
  count: number,
  deviceId: string,
  fill?: { min?: number; max?: number }
): Promise<SignedPrintableCard[]> {
  const range = fill ?? readCardFillRange();
  const n = Math.max(1, Math.min(200, Math.round(count)));
  const cards: SignedPrintableCard[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (cards.length < n && guard < n * 40) {
    guard++;
    const flat = gridToFlatNumbers(
      generateBingoCard({ minFilled: range.min, maxFilled: range.max })
    );
    const contentHash = cardContentFingerprint(flat);
    if (seen.has(contentHash)) continue;
    seen.add(contentHash);
    const sig = await signCardWithDeviceId(flat, deviceId);
    cards.push({ numbers: flat, sig, contentHash });
  }
  return cards;
}

/** @deprecated Prefer generateSignedPrintableCards when a deviceId is available. */
export function generatePrintableCards(
  count: number,
  fill?: { min?: number; max?: number }
): FlatCardNumbers[] {
  const range = fill ?? readCardFillRange();
  const n = Math.max(1, Math.min(200, Math.round(count)));
  const cards: FlatCardNumbers[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (cards.length < n && guard < n * 40) {
    guard++;
    const flat = gridToFlatNumbers(
      generateBingoCard({ minFilled: range.min, maxFilled: range.max })
    );
    const key = cardContentFingerprint(flat);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(flat);
  }
  return cards;
}

export const QR_CARD_STORAGE_KEY = "bingo-qr-claim-card";
export const QR_CARD_SIG_STORAGE_KEY = "bingo-qr-claim-sig";
export const QR_BOARD_VERIFY_KEY = "bingo-qr-board-verify";

export type QrClaimRoute = "card" | "scan" | null;

/** Parse a scanned QR string (full claim URL or raw card payload) into a claim. */
export function parseCardClaimFromQrText(text: string): QrCardClaim | null {
  const raw = text.trim().replace(/\s+/g, "");
  if (!raw) return null;

  let payload: string | null = null;
  let sig: string | null = null;

  const takeParams = (params: URLSearchParams) => {
    payload = params.get("c") || params.get("n");
    sig = params.get("s");
  };

  try {
    const url = new URL(raw);
    takeParams(url.searchParams);
  } catch {
    // Relative URLs / query-only strings from some scanners.
    try {
      const url = new URL(raw, "http://bingo.local");
      takeParams(url.searchParams);
    } catch {
      // ignore
    }
  }

  if (!payload) {
    const cMatch = raw.match(/[?&#]c=([^&?#]+)/i) || raw.match(/(?:^|[^a-z])c=([^&?#]+)/i);
    const sMatch = raw.match(/[?&#]s=([^&?#]+)/i);
    if (cMatch) {
      try {
        payload = decodeURIComponent(cMatch[1]);
      } catch {
        payload = cMatch[1];
      }
    }
    if (sMatch) {
      try {
        sig = decodeURIComponent(sMatch[1]);
      } catch {
        sig = sMatch[1];
      }
    }
  }

  if (!payload) {
    // Raw card payload (v1 / B2. / H2.)
    if (/^(B2\.|H2\.)/i.test(raw) || /^[A-Za-z0-9_-]{20,}$/.test(raw)) {
      payload = raw;
    }
  }

  if (!payload) return null;
  try {
    payload = decodeURIComponent(payload);
  } catch {
    // already decoded
  }
  const decoded = decodeCardPayloadWithStyle(payload);
  if (!decoded) return null;
  return { numbers: decoded.numbers, sig: sig || null };
}

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
    const decoded = decodeCardPayloadWithStyle(payload);
    if (decoded) {
      sessionStorage.setItem(QR_CARD_STORAGE_KEY, payload);
      if (sig) sessionStorage.setItem(QR_CARD_SIG_STORAGE_KEY, sig);
      else sessionStorage.removeItem(QR_CARD_SIG_STORAGE_KEY);
      if (isStoredBoardSessionActive()) {
        // Authenticated host → Scan mode verify (not Board flashboard).
        sessionStorage.setItem(appModeStorageKey, "scan");
        sessionStorage.setItem(QR_BOARD_VERIFY_KEY, "1");
        route = "scan";
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

export function takeQrCardClaim(): QrCardClaim | null {
  if (typeof window === "undefined") return null;
  const payload = sessionStorage.getItem(QR_CARD_STORAGE_KEY);
  const sig = sessionStorage.getItem(QR_CARD_SIG_STORAGE_KEY);
  sessionStorage.removeItem(QR_CARD_STORAGE_KEY);
  sessionStorage.removeItem(QR_CARD_SIG_STORAGE_KEY);
  if (!payload) return null;
  const decoded = decodeCardPayloadWithStyle(payload);
  if (!decoded) return null;
  return { numbers: decoded.numbers, sig: sig || null };
}
