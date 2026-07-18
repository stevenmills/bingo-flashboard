import { LETTERS, LETTER_RANGES, type Letter } from "@/types";
import { generateBingoCard, generateHouseyCard, type CardGrid } from "@/lib/card";
import { isStoredBoardSessionActive } from "@/lib/board-auth";
import { hmacSha256, utf8Encode } from "@/lib/hmac-sha256";
import {
  HOUSEY_MAX_POPULATED,
  HOUSEY_MIN_POPULATED,
  type GameStyle,
} from "@/lib/game-style";

/** Flat 25 cells; null = FREE (bingo center) or blank (housey). */
export type FlatCardNumbers = Array<number | null>;

export type SignedPrintableCard = {
  numbers: FlatCardNumbers;
  gameStyle: GameStyle;
  /** HMAC-SHA256(deviceId, domain||cells…) truncated hex (32 chars). */
  sig: string;
  /** Uniqueness key for this batch. */
  contentHash: string;
};

export type QrCardClaim = {
  numbers: FlatCardNumbers;
  gameStyle: GameStyle;
  sig: string | null;
};

export function gridToFlatNumbers(grid: CardGrid): FlatCardNumbers {
  return grid.flat().map((cell) => (cell.isFree || cell.isBlank || cell.value == null ? null : cell.value));
}

export function flatNumbersToBingoGrid(numbers: FlatCardNumbers): CardGrid | null {
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
        isBlank: false,
        marked: isFree,
      };
    })
  );
}

export function flatNumbersToHouseyGrid(numbers: FlatCardNumbers): CardGrid | null {
  if (!Array.isArray(numbers) || numbers.length !== 25) return null;
  let populated = 0;
  const seen = new Set<number>();
  for (let col = 0; col < 5; col++) {
    const letter = LETTERS[col] as Letter;
    const [min, max] = LETTER_RANGES[letter];
    const colVals: number[] = [];
    for (let row = 0; row < 5; row++) {
      const idx = row * 5 + col;
      const n = numbers[idx];
      if (n == null) continue;
      if (typeof n !== "number" || n < min || n > max) return null;
      if (colVals.includes(n) || seen.has(n)) return null;
      colVals.push(n);
      seen.add(n);
      populated++;
    }
  }
  if (populated < HOUSEY_MIN_POPULATED || populated > HOUSEY_MAX_POPULATED) return null;

  return Array.from({ length: 5 }, (_, rowIdx) =>
    Array.from({ length: 5 }, (_, colIdx) => {
      const idx = rowIdx * 5 + colIdx;
      const value = numbers[idx];
      const isBlank = value == null;
      return {
        letter: LETTERS[colIdx],
        value: isBlank ? null : value,
        isFree: false,
        isBlank,
        marked: false,
      };
    })
  );
}

export function flatNumbersToGrid(
  numbers: FlatCardNumbers,
  gameStyle: GameStyle = "bingo"
): CardGrid | null {
  return gameStyle === "housey" ? flatNumbersToHouseyGrid(numbers) : flatNumbersToBingoGrid(numbers);
}

/** Legacy v1: 24 bytes, center FREE implied. */
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
 * v2: version byte + style byte ('b'|'h') + 25 cell bytes (0 = blank).
 * Prefixed with "H2." so decode can distinguish from legacy base64.
 */
export function encodeCardPayloadV2(numbers: FlatCardNumbers, gameStyle: GameStyle): string {
  const bytes = new Uint8Array(27);
  bytes[0] = 2;
  bytes[1] = gameStyle === "housey" ? "h".charCodeAt(0) : "b".charCodeAt(0);
  for (let i = 0; i < 25; i++) {
    const n = numbers[i];
    bytes[2 + i] = typeof n === "number" && n >= 1 && n <= 75 ? n : 0;
  }
  let bin = "";
  for (let b = 0; b < bytes.length; b++) bin += String.fromCharCode(bytes[b]);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `H2.${b64}`;
}

export function encodeCardPayload(numbers: FlatCardNumbers, gameStyle: GameStyle = "bingo"): string {
  if (gameStyle === "housey") return encodeCardPayloadV2(numbers, "housey");
  return encodeCardPayloadV1(numbers);
}

export type DecodedCardPayload = {
  numbers: FlatCardNumbers;
  gameStyle: GameStyle;
};

export function decodeCardPayload(payload: string): FlatCardNumbers | null {
  const decoded = decodeCardPayloadWithStyle(payload);
  return decoded?.numbers ?? null;
}

export function decodeCardPayloadWithStyle(payload: string): DecodedCardPayload | null {
  try {
    if (payload.startsWith("H2.")) {
      const padded = payload.slice(3).replace(/-/g, "+").replace(/_/g, "/");
      const padLen = (4 - (padded.length % 4)) % 4;
      const b64 = padded + "=".repeat(padLen);
      const bin = atob(b64);
      if (bin.length !== 27) return null;
      if (bin.charCodeAt(0) !== 2) return null;
      const styleChar = bin.charCodeAt(1);
      const gameStyle: GameStyle = styleChar === "h".charCodeAt(0) ? "housey" : "bingo";
      const numbers: FlatCardNumbers = new Array(25).fill(null);
      for (let i = 0; i < 25; i++) {
        const n = bin.charCodeAt(2 + i);
        numbers[i] = n >= 1 && n <= 75 ? n : null;
      }
      if (!flatNumbersToGrid(numbers, gameStyle)) return null;
      return { numbers, gameStyle };
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
    return { numbers, gameStyle: "bingo" };
  } catch {
    return null;
  }
}

export function cardContentFingerprint(numbers: FlatCardNumbers, gameStyle: GameStyle = "bingo"): string {
  const parts: string[] = [`v2:${gameStyle}`];
  for (let idx = 0; idx < 25; idx++) {
    parts.push(`${idx}:${numbers[idx] ?? 0}`);
  }
  return parts.join("|");
}

function buildAuthMessageBytes(numbers: FlatCardNumbers, gameStyle: GameStyle): Uint8Array {
  if (gameStyle === "bingo") {
    // Legacy v1: 48 bytes of index+value for non-FREE cells only.
    const msg = new Uint8Array(48);
    let i = 0;
    for (let idx = 0; idx < 25; idx++) {
      if (idx === 12) continue;
      msg[i++] = idx & 0xff;
      msg[i++] = (typeof numbers[idx] === "number" ? numbers[idx]! : 0) & 0xff;
    }
    return msg;
  }
  const domain = utf8Encode("housey-card-v2");
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

export async function signCardWithDeviceId(
  numbers: FlatCardNumbers,
  deviceId: string,
  gameStyle: GameStyle = "bingo"
): Promise<string> {
  const msg = buildAuthMessageBytes(numbers, gameStyle);
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
  sig?: string | null,
  gameStyle: GameStyle = "bingo"
): string {
  const base =
    origin ||
    (typeof window !== "undefined" ? window.location.origin : "http://bingo.local");
  const c = encodeCardPayload(numbers, gameStyle);
  let url = `${base.replace(/\/$/, "")}/?mode=card&claim=1&c=${c}`;
  if (sig) url += `&s=${encodeURIComponent(sig)}`;
  return url;
}

export async function generateSignedPrintableCards(
  count: number,
  deviceId: string,
  gameStyle: GameStyle = "bingo"
): Promise<SignedPrintableCard[]> {
  const n = Math.max(1, Math.min(200, Math.round(count)));
  const cards: SignedPrintableCard[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (cards.length < n && guard < n * 40) {
    guard++;
    const flat = gridToFlatNumbers(gameStyle === "housey" ? generateHouseyCard() : generateBingoCard());
    const contentHash = cardContentFingerprint(flat, gameStyle);
    if (seen.has(contentHash)) continue;
    seen.add(contentHash);
    const sig = await signCardWithDeviceId(flat, deviceId, gameStyle);
    cards.push({ numbers: flat, gameStyle, sig, contentHash });
  }
  return cards;
}

/** @deprecated Prefer generateSignedPrintableCards when a deviceId is available. */
export function generatePrintableCards(count: number, gameStyle: GameStyle = "bingo"): FlatCardNumbers[] {
  const n = Math.max(1, Math.min(200, Math.round(count)));
  const cards: FlatCardNumbers[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (cards.length < n && guard < n * 40) {
    guard++;
    const flat = gridToFlatNumbers(gameStyle === "housey" ? generateHouseyCard() : generateBingoCard());
    const key = cardContentFingerprint(flat, gameStyle);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(flat);
  }
  return cards;
}

export const QR_CARD_STORAGE_KEY = "bingo-qr-claim-card";
export const QR_CARD_SIG_STORAGE_KEY = "bingo-qr-claim-sig";
export const QR_BOARD_VERIFY_KEY = "bingo-qr-board-verify";

export type QrClaimRoute = "card" | "board" | null;

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

export function takeQrCardClaim(): QrCardClaim | null {
  if (typeof window === "undefined") return null;
  const payload = sessionStorage.getItem(QR_CARD_STORAGE_KEY);
  const sig = sessionStorage.getItem(QR_CARD_SIG_STORAGE_KEY);
  sessionStorage.removeItem(QR_CARD_STORAGE_KEY);
  sessionStorage.removeItem(QR_CARD_SIG_STORAGE_KEY);
  if (!payload) return null;
  const decoded = decodeCardPayloadWithStyle(payload);
  if (!decoded) return null;
  return { numbers: decoded.numbers, gameStyle: decoded.gameStyle, sig: sig || null };
}
