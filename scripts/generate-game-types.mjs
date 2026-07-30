#!/usr/bin/env node
/**
 * Canonical bingo game-type catalog.
 * Generates:
 *   - frontend/src/lib/game-types.generated.ts
 *   - include/game_types.generated.h
 *
 * Run: node scripts/generate-game-types.mjs
 * Also: node scripts/generate-game-types.mjs --check
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TS_OUT = join(ROOT, "frontend/src/lib/game-types.generated.ts");
const H_OUT = join(ROOT, "include/game_types.generated.h");
const JSON_OUT = join(ROOT, "frontend/src/lib/game-types.generated.json");
/** Max independently claimable win alternatives (uint32_t claim mask). */
const MAX_WIN_ALTS = 32;
/** Max LED/UI display orientations (Double Bingo needs C(12,2)=66). */
const MAX_DISPLAY_ALTS = 66;
const MAX_ID_LEN = 23; // firmware buffer is 24 including NUL

const CATEGORIES = [
  { id: "classics", label: "Classics" },
  { id: "letters", label: "Letters & Symbols" },
  { id: "shapes", label: "Shapes & Frames" },
  { id: "blocks", label: "Blocks & Arrows" },
  { id: "pictures", label: "Pictures" },
  { id: "combos", label: "Combos & Rules" },
  { id: "experimental", label: "Experimental" },
];

/** @param {number[]} cells1 1-indexed cells */
function maskFromCells(cells1) {
  let m = 0;
  for (const c of cells1) {
    if (c < 1 || c > 25) throw new Error(`Invalid cell ${c}`);
    m |= 1 << (c - 1);
  }
  return m >>> 0;
}

/** @param {number} mask */
function cellsFromMask(mask) {
  const out = [];
  for (let i = 0; i < 25; i++) if (mask & (1 << i)) out.push(i + 1);
  return out;
}

/** @param {number} mask rotate 90° clockwise (1-indexed grid) */
function rotateMaskCW(mask) {
  let out = 0;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const bit = r * 5 + c;
      if (mask & (1 << bit)) {
        const nr = c;
        const nc = 4 - r;
        out |= 1 << (nr * 5 + nc);
      }
    }
  }
  return out >>> 0;
}

/** @param {number} mask mirror horizontally */
function mirrorH(mask) {
  let out = 0;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const bit = r * 5 + c;
      if (mask & (1 << bit)) out |= 1 << (r * 5 + (4 - c));
    }
  }
  return out >>> 0;
}

/** Unique masks from seed via 0–3 CW rotations (+ optional mirrors of each). */
function orientMasks(seedCells1, { rotate = true, mirror = false } = {}) {
  let m = maskFromCells(seedCells1);
  const seen = new Set();
  const out = [];
  const push = (x) => {
    x = x >>> 0;
    if (seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };
  const variants = [m];
  if (rotate) {
    let cur = m;
    for (let i = 0; i < 3; i++) {
      cur = rotateMaskCW(cur);
      variants.push(cur);
    }
  }
  for (const v of variants) {
    push(v);
    if (mirror) push(mirrorH(v));
  }
  return out;
}

function row(r) {
  return [r * 5 + 1, r * 5 + 2, r * 5 + 3, r * 5 + 4, r * 5 + 5];
}
function col(c) {
  return [c, c + 5, c + 10, c + 15, c + 20];
}

/** Vertical ladder: rails one column apart, rungs on rows 2 & 4 of the gap. */
function ladderMasks() {
  const masks = [];
  for (const left of [1, 2, 3]) {
    const right = left + 2;
    const mid = left + 1;
    const cells = [...col(left), ...col(right), mid + 5, mid + 15]; // rows 2 & 4
    masks.push(maskFromCells(cells));
  }
  return masks; // 3
}

const TRADITIONAL_MASKS = [
  ...[0, 1, 2, 3, 4].map((r) => maskFromCells(row(r))),
  ...[1, 2, 3, 4, 5].map((c) => maskFromCells(col(c))),
  maskFromCells([1, 7, 13, 19, 25]),
  maskFromCells([5, 9, 13, 17, 21]),
];

const POSTAGE_MASKS = [
  maskFromCells([1, 2, 6, 7]),
  maskFromCells([4, 5, 9, 10]),
  maskFromCells([16, 17, 21, 22]),
  maskFromCells([19, 20, 24, 25]),
];

const X_MASK = maskFromCells([1, 5, 7, 9, 13, 17, 19, 21, 25]);
const PLUS_MASK = maskFromCells([3, 8, 11, 12, 13, 14, 15, 18, 23]);
const EVERY_OTHER_1 = maskFromCells([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25]);
const EVERY_OTHER_2 = maskFromCells([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);

function coveredCount(mask) {
  let n = 0;
  for (let i = 0; i < 25; i++) if (mask & (1 << i)) n++;
  return n;
}

function freeInMask(mask) {
  return (mask & (1 << 12)) !== 0;
}

function minCallsForMask(mask, requiredPatterns = 1) {
  // Approximate: numbered cells in the smallest alternative.
  // FREE never needs a call.
  const numbered = coveredCount(mask) - (freeInMask(mask) ? 1 : 0);
  if (requiredPatterns <= 1) return Math.max(0, numbered);
  // Double bingo: two lines share at most FREE → ~8 numbered min in practice.
  return Math.max(0, numbered * requiredPatterns - (freeInMask(mask) ? requiredPatterns - 1 : 0));
}

function def(partial) {
  const winMasks = partial.winMasks;
  if (!winMasks || winMasks.length === 0) {
    if (partial.coveredThreshold == null && !partial.elimination) {
      throw new Error(`${partial.id}: no winMasks`);
    }
  }
  if (winMasks && winMasks.length > MAX_WIN_ALTS) {
    throw new Error(`${partial.id}: ${winMasks.length} win alts > ${MAX_WIN_ALTS}`);
  }
  if (partial.displayMasks && partial.displayMasks.length > MAX_DISPLAY_ALTS) {
    throw new Error(`${partial.id}: ${partial.displayMasks.length} display alts > ${MAX_DISPLAY_ALTS}`);
  }
  const displayMasks = partial.displayMasks ?? winMasks ?? [maskFromCells(Array.from({ length: 25 }, (_, i) => i + 1))];
  const requiredPatterns = partial.requiredPatterns ?? 1;
  const coveredThreshold = partial.coveredThreshold ?? 0;
  let minCalls;
  let oddsHits;
  if (partial.elimination) {
    minCalls = partial.minCalls ?? 10;
    oddsHits = partial.oddsHits ?? 0;
  } else if (coveredThreshold > 0) {
    // Blackout Lite: 20 covered including FREE → 19 numbered calls minimum.
    minCalls = coveredThreshold - 1;
    oddsHits = coveredThreshold;
  } else {
    const smallest = winMasks.reduce((a, b) => (coveredCount(a) <= coveredCount(b) ? a : b));
    minCalls = partial.minCalls ?? minCallsForMask(smallest, requiredPatterns);
    oddsHits = partial.oddsHits ?? (coveredCount(smallest) - (freeInMask(smallest) ? 0 : 0));
    // oddsHits = number of cell hits needed (including FREE as automatic)
    if (partial.oddsHits == null) {
      oddsHits = coveredCount(smallest); // cells that must be covered (FREE counts)
    }
  }
  return {
    id: partial.id,
    label: partial.label,
    category: partial.category,
    description: partial.description,
    winMasks: winMasks ?? [],
    displayMasks,
    requiredPatterns,
    coveredThreshold,
    minCalls,
    oddsHits,
    usesFreeSpace: partial.usesFreeSpace ?? (winMasks?.some(freeInMask) ?? coveredThreshold > 0),
    elimination: Boolean(partial.elimination),
  };
}

/** @type {ReturnType<typeof def>[]} */
const CATALOG = [
  // ── Classics ──────────────────────────────────────────────
  def({
    id: "traditional",
    label: "Traditional",
    category: "classics",
    description: "Any row, column, or diagonal.",
    winMasks: TRADITIONAL_MASKS,
    displayMasks: TRADITIONAL_MASKS,
    minCalls: 4,
    oddsHits: 5,
    usesFreeSpace: true,
  }),
  def({
    id: "double_bingo",
    label: "Double Bingo",
    category: "classics",
    description: "Any two distinct Traditional lines.",
    winMasks: TRADITIONAL_MASKS,
    // Cycle every unordered pair of Traditional lines as two independent bingos.
    displayMasks: (() => {
      const pairs = [];
      for (let i = 0; i < TRADITIONAL_MASKS.length; i++) {
        for (let j = i + 1; j < TRADITIONAL_MASKS.length; j++) {
          pairs.push((TRADITIONAL_MASKS[i] | TRADITIONAL_MASKS[j]) >>> 0);
        }
      }
      return pairs; // C(12,2) = 66
    })(),
    requiredPatterns: 2,
    minCalls: 8,
    oddsHits: 8,
    usesFreeSpace: true,
  }),
  def({
    id: "four_corners",
    label: "Four Corners",
    category: "classics",
    description: "All four corner cells.",
    winMasks: [maskFromCells([1, 5, 21, 25])],
    minCalls: 4,
    oddsHits: 4,
  }),
  def({
    id: "postage_stamp",
    label: "Postage Stamp",
    category: "classics",
    description: "Any 2×2 block in a corner.",
    winMasks: POSTAGE_MASKS,
    displayMasks: POSTAGE_MASKS,
    minCalls: 4,
    oddsHits: 4,
  }),
  def({
    id: "cover_all",
    label: "Cover All",
    category: "classics",
    description: "Mark every number on the card.",
    winMasks: [maskFromCells(Array.from({ length: 25 }, (_, i) => i + 1))],
    minCalls: 24,
    oddsHits: 25,
    usesFreeSpace: true,
  }),
  def({
    id: "blackout_lite",
    label: "Blackout Lite",
    category: "classics",
    description: "Cover any 20 of 25 cells (80%).",
    winMasks: [],
    displayMasks: [maskFromCells(Array.from({ length: 25 }, (_, i) => i + 1))],
    coveredThreshold: 20,
    minCalls: 19,
    oddsHits: 20,
    usesFreeSpace: true,
  }),

  // ── Letters & Symbols ─────────────────────────────────────
  def({
    id: "x",
    label: "Letter X",
    category: "letters",
    description: "Both diagonals forming an X.",
    winMasks: [X_MASK],
    minCalls: 8,
    oddsHits: 9,
    usesFreeSpace: true,
  }),
  def({
    id: "y",
    label: "Letter Y",
    category: "letters",
    description: "A Y shape through the center.",
    winMasks: [maskFromCells([1, 5, 7, 9, 13, 18, 23])],
    minCalls: 6,
    oddsHits: 7,
    usesFreeSpace: true,
  }),
  def({
    id: "lucky_7",
    label: "Lucky 7",
    category: "letters",
    description: "A classic 7 across the top and down the right diagonal.",
    winMasks: orientMasks([1, 2, 3, 4, 5, 9, 13, 17, 21], { rotate: true }),
    minCalls: 8,
    oddsHits: 9,
  }),
  def({
    id: "letter_o",
    label: "Letter O",
    category: "letters",
    description: "The outer ring; center stays open.",
    winMasks: [maskFromCells([1, 2, 3, 4, 5, 6, 10, 11, 15, 16, 20, 21, 22, 23, 24, 25])],
    minCalls: 16,
    oddsHits: 16,
  }),
  def({
    id: "letter_h",
    label: "Letter H",
    category: "letters",
    description: "Two side columns bridged through the center.",
    winMasks: [maskFromCells([1, 5, 6, 10, 11, 12, 13, 14, 15, 16, 20, 21, 25])],
    minCalls: 12,
    oddsHits: 13,
    usesFreeSpace: true,
  }),
  def({
    id: "plus_sign",
    label: "Plus Sign",
    category: "letters",
    description: "Center row and center column.",
    winMasks: [PLUS_MASK],
    minCalls: 8,
    oddsHits: 9,
    usesFreeSpace: true,
  }),
  def({
    id: "asterisk",
    label: "Asterisk",
    category: "letters",
    description: "Both the Letter X and the Plus Sign — a full star through FREE.",
    winMasks: [X_MASK, PLUS_MASK],
    displayMasks: [(X_MASK | PLUS_MASK) >>> 0],
    requiredPatterns: 2,
    minCalls: 16,
    oddsHits: 17,
    usesFreeSpace: true,
  }),

  // ── Shapes & Frames ───────────────────────────────────────
  def({
    id: "frame_outside",
    label: "Frame Outside",
    category: "shapes",
    description: "The entire outer edge of the card.",
    winMasks: [maskFromCells([1, 2, 3, 4, 5, 6, 10, 11, 15, 16, 20, 21, 22, 23, 24, 25])],
    minCalls: 16,
    oddsHits: 16,
  }),
  def({
    id: "frame_inside",
    label: "Frame Inside",
    category: "shapes",
    description: "The eight cells around FREE.",
    winMasks: [maskFromCells([7, 8, 9, 12, 14, 17, 18, 19])],
    minCalls: 8,
    oddsHits: 8,
  }),
  def({
    id: "diamond",
    label: "Diamond",
    category: "shapes",
    description: "A diamond around FREE.",
    winMasks: [maskFromCells([3, 7, 9, 11, 13, 15, 17, 19, 23])],
    minCalls: 8,
    oddsHits: 9,
    usesFreeSpace: true,
  }),
  def({
    id: "bullseye",
    label: "Bullseye",
    category: "shapes",
    description: "FREE plus the eight surrounding cells.",
    winMasks: [maskFromCells([7, 8, 9, 12, 13, 14, 17, 18, 19])],
    minCalls: 8,
    oddsHits: 9,
    usesFreeSpace: true,
  }),
  def({
    id: "hourglass",
    label: "Hourglass",
    category: "shapes",
    description: "Top and bottom triangles meeting at FREE.",
    winMasks: orientMasks([1, 2, 3, 4, 5, 7, 8, 9, 13, 17, 18, 19, 21, 22, 23, 24, 25], { rotate: true }),
    minCalls: 16,
    oddsHits: 17,
    usesFreeSpace: true,
  }),
  def({
    id: "pyramid",
    label: "Pyramid",
    category: "shapes",
    description: "A pyramid pointing up from the bottom row.",
    winMasks: orientMasks([3, 7, 8, 9, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25], { rotate: true }),
    minCalls: 13,
    oddsHits: 14,
    usesFreeSpace: true,
  }),
  def({
    id: "bow_tie",
    label: "Bow Tie",
    category: "shapes",
    description: "Two triangles meeting at the center.",
    winMasks: orientMasks([1, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 25], { rotate: true }),
    minCalls: 16,
    oddsHits: 17,
    usesFreeSpace: true,
  }),
  def({
    id: "infinity",
    label: "Infinity",
    category: "shapes",
    description: "A figure-eight loop through FREE.",
    winMasks: orientMasks([2, 4, 6, 8, 10, 12, 13, 14, 16, 18, 20, 22, 24], { rotate: true }),
    minCalls: 12,
    oddsHits: 13,
    usesFreeSpace: true,
  }),
  def({
    id: "lightning",
    label: "Lightning",
    category: "shapes",
    description: "A zigzag bolt down the card.",
    winMasks: orientMasks([2, 3, 4, 5, 8, 12, 13, 14, 17, 21, 22, 23, 24], { rotate: true, mirror: true }),
    minCalls: 12,
    oddsHits: 13,
    usesFreeSpace: true,
  }),
  def({
    id: "ladder",
    label: "Ladder",
    category: "shapes",
    description: "Two parallel columns one apart, connected by rungs on rows 2 and 4.",
    winMasks: ladderMasks(),
  }),
  def({
    id: "tic_tac_toe",
    label: "Tic Tac Toe",
    category: "shapes",
    description: "The hashtag / pound symbol — rows 2 and 4 and columns 2 and 4.",
    winMasks: [maskFromCells([...row(1), ...row(3), ...col(2), ...col(4)])],
    minCalls: 16,
    oddsHits: 16,
  }),
  def({
    id: "every_other_1",
    label: "Every Other 1",
    category: "shapes",
    description: "Checkerboard starting on the corners — every other cell including FREE.",
    winMasks: [EVERY_OTHER_1],
    minCalls: 12,
    oddsHits: 13,
    usesFreeSpace: true,
  }),
  def({
    id: "every_other_2",
    label: "Every Other 2",
    category: "shapes",
    description: "The opposite checkerboard — every other cell excluding FREE.",
    winMasks: [EVERY_OTHER_2],
    minCalls: 12,
    oddsHits: 12,
  }),

  // ── Blocks & Arrows ───────────────────────────────────────
  def({
    id: "big_stamp",
    label: "Big Stamp",
    category: "blocks",
    description: "Any 3×3 block in a corner.",
    winMasks: [
      maskFromCells([1, 2, 3, 6, 7, 8, 11, 12, 13]),
      maskFromCells([3, 4, 5, 8, 9, 10, 13, 14, 15]),
      maskFromCells([11, 12, 13, 16, 17, 18, 21, 22, 23]),
      maskFromCells([13, 14, 15, 18, 19, 20, 23, 24, 25]),
    ],
    minCalls: 8,
    oddsHits: 9,
    usesFreeSpace: true,
  }),
  def({
    id: "brick",
    label: "Brick",
    category: "blocks",
    description: "A 2×3 rectangle in any corner orientation.",
    winMasks: orientMasks([1, 2, 3, 6, 7, 8], { rotate: true, mirror: true }),
    minCalls: 6,
    oddsHits: 6,
  }),
  def({
    id: "l_block",
    label: "L-Block",
    category: "blocks",
    description: "A Tetris L in any corner orientation.",
    winMasks: orientMasks([1, 6, 11, 12, 13], { rotate: true, mirror: true }),
    minCalls: 4,
    oddsHits: 5,
    usesFreeSpace: true,
  }),
  def({
    id: "arrow",
    label: "Arrow",
    category: "blocks",
    description: "An arrow pointing any direction.",
    winMasks: orientMasks([3, 7, 8, 9, 11, 12, 13, 14, 15, 18, 23], { rotate: true }),
    minCalls: 10,
    oddsHits: 11,
    usesFreeSpace: true,
  }),

  // ── Pictures ──────────────────────────────────────────────
  def({
    id: "field_goal",
    label: "Field Goal",
    category: "pictures",
    description: "Uprights with a crossbar — sports night classic.",
    winMasks: [maskFromCells([1, 5, 6, 10, 11, 12, 13, 14, 15, 18, 23])],
    minCalls: 10,
    oddsHits: 11,
    usesFreeSpace: true,
  }),
  def({
    id: "anchor",
    label: "Anchor",
    category: "pictures",
    description: "Stem down with curved arms at top.",
    winMasks: [maskFromCells([2, 3, 4, 8, 13, 17, 18, 19, 21, 23, 25])],
    minCalls: 10,
    oddsHits: 11,
    usesFreeSpace: true,
  }),
  def({
    id: "heart",
    label: "Heart",
    category: "pictures",
    description: "A classic heart with FREE in the center.",
    winMasks: [maskFromCells([2, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 23])],
    minCalls: 15,
    oddsHits: 16,
    usesFreeSpace: true,
  }),
  def({
    id: "smiley",
    label: "Smiley",
    category: "pictures",
    description: "Eyes and a grin; FREE is the nose.",
    winMasks: [maskFromCells([7, 9, 13, 16, 20, 22, 23, 24])],
    minCalls: 7,
    oddsHits: 8,
    usesFreeSpace: true,
  }),
  def({
    id: "rocket",
    label: "Rocket",
    category: "pictures",
    description: "Nose at top, body down the middle, fins at the bottom corners.",
    winMasks: [maskFromCells([3, 7, 8, 9, 12, 13, 14, 18, 21, 23, 25])],
    minCalls: 10,
    oddsHits: 11,
    usesFreeSpace: true,
  }),
  def({
    id: "ufo",
    label: "UFO",
    category: "pictures",
    description: "Oval body with two landing legs below.",
    winMasks: [maskFromCells([7, 8, 9, 11, 12, 13, 14, 15, 17, 18, 19, 22, 24])],
    minCalls: 12,
    oddsHits: 13,
    usesFreeSpace: true,
  }),
  def({
    id: "top_hat",
    label: "Top Hat",
    category: "pictures",
    description: "Tall crown with a wide brim along the bottom.",
    winMasks: [maskFromCells([2, 3, 4, 7, 8, 9, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25])],
    minCalls: 18,
    oddsHits: 19,
    usesFreeSpace: true,
  }),
  def({
    id: "pac_man",
    label: "Pac-Man",
    category: "pictures",
    description: "A Pac-Man character with an open mouth facing right.",
    winMasks: [maskFromCells([2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 22, 23, 24])],
    minCalls: 18,
    oddsHits: 19,
    usesFreeSpace: true,
  }),
  def({
    id: "clover",
    label: "Clover",
    category: "pictures",
    description: "Four leaves around FREE — lucky St. Patrick’s pattern.",
    winMasks: [maskFromCells([2, 3, 4, 7, 9, 11, 12, 13, 14, 15, 17, 19, 22, 23, 24])],
    minCalls: 14,
    oddsHits: 15,
    usesFreeSpace: true,
  }),
  def({
    id: "bingo_glyph",
    label: "BINGO Glyph",
    category: "pictures",
    description: "Complete any letter glyph: B, I, N, G, or O.",
    winMasks: [
      // B
      maskFromCells([1, 2, 3, 6, 8, 9, 11, 12, 13, 16, 18, 19, 21, 22, 23]),
      // I
      maskFromCells([1, 2, 3, 4, 5, 8, 13, 18, 21, 22, 23, 24, 25]),
      // N
      maskFromCells([1, 5, 6, 7, 10, 11, 13, 15, 16, 19, 20, 21, 25]),
      // G
      maskFromCells([2, 3, 4, 5, 6, 11, 13, 14, 15, 16, 20, 22, 23, 24]),
      // O
      maskFromCells([2, 3, 4, 6, 10, 11, 15, 16, 20, 22, 23, 24]),
    ],
    minCalls: 12,
    oddsHits: 12,
    usesFreeSpace: true,
  }),
  def({
    id: "snake",
    label: "Snake",
    category: "pictures",
    description: "An S shape in any orientation.",
    winMasks: orientMasks([1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25], {
      rotate: true,
      mirror: true,
    }),
    minCalls: 16,
    oddsHits: 17,
    usesFreeSpace: true,
  }),

  // ── Combos & Rules ────────────────────────────────────────
  def({
    id: "railroad",
    label: "Railroad",
    category: "combos",
    description: "Any two parallel rows, or any two parallel columns.",
    winMasks: (() => {
      const masks = [];
      for (let a = 0; a < 5; a++) {
        for (let b = a + 1; b < 5; b++) {
          masks.push(maskFromCells([...row(a), ...row(b)]));
        }
      }
      for (let a = 1; a <= 5; a++) {
        for (let b = a + 1; b <= 5; b++) {
          masks.push(maskFromCells([...col(a), ...col(b)]));
        }
      }
      return masks; // 10 + 10 = 20
    })(),
    minCalls: 8,
    oddsHits: 10,
    usesFreeSpace: true,
  }),
  def({
    id: "vip_cross",
    label: "VIP Cross",
    category: "combos",
    description: "Thick center cross — center row, center column, and the four diagonal neighbors of FREE.",
    winMasks: [maskFromCells([3, 7, 8, 9, 11, 12, 13, 14, 15, 17, 18, 19, 23])],
    minCalls: 12,
    oddsHits: 13,
    usesFreeSpace: true,
  }),
  def({
    id: "four_horsemen",
    label: "Four Horsemen",
    category: "combos",
    description: "The four midpoints of the outer edges.",
    winMasks: [maskFromCells([3, 11, 15, 23])],
    minCalls: 4,
    oddsHits: 4,
  }),
  def({
    id: "split_the_room",
    label: "Split the Room",
    category: "combos",
    description: "Left two columns or right two columns.",
    winMasks: [
      maskFromCells([...col(1), ...col(2)]),
      maskFromCells([...col(4), ...col(5)]),
    ],
    minCalls: 10,
    oddsHits: 10,
  }),
  def({
    id: "top_vs_bottom",
    label: "Top vs Bottom",
    category: "combos",
    description: "Top two rows or bottom two rows.",
    winMasks: [
      maskFromCells([...row(0), ...row(1)]),
      maskFromCells([...row(3), ...row(4)]),
    ],
    minCalls: 10,
    oddsHits: 10,
  }),
  def({
    id: "diagonal_band",
    label: "Diagonal Band",
    category: "combos",
    description: "Main diagonal plus both adjacent parallel offsets (either slope).",
    winMasks: [
      // Main \ and parallels
      maskFromCells([1, 7, 13, 19, 25, 2, 8, 14, 20, 6, 12, 18, 24]),
      // Main / and parallels
      maskFromCells([5, 9, 13, 17, 21, 4, 8, 12, 16, 10, 14, 18, 22]),
    ],
    minCalls: 12,
    oddsHits: 13,
    usesFreeSpace: true,
  }),

  // ── Experimental ──────────────────────────────────────────
  def({
    id: "battleship",
    label: "Battleship",
    category: "experimental",
    description:
      "Last card still afloat wins. A card sinks when all of its numbers are called.",
    winMasks: [],
    displayMasks: [],
    elimination: true,
    minCalls: 10,
    oddsHits: 0,
    usesFreeSpace: true,
  }),
];

// Fix vip_cross — the def() above has a bug: I left comments inside the object after winMasks was wrongly set.
// Re-check: looking at the object, I first set winMasks to plus then had a big comment and then set winMasks again.
// In JS the second winMasks wins. Good.

function validate(catalog) {
  const ids = new Set();
  const errors = [];
  for (const g of catalog) {
    if (ids.has(g.id)) errors.push(`Duplicate id ${g.id}`);
    ids.add(g.id);
    if (g.id.length > MAX_ID_LEN) errors.push(`ID too long: ${g.id} (${g.id.length} > ${MAX_ID_LEN})`);
    if (!/^[a-z][a-z0-9_]*$/.test(g.id)) errors.push(`Bad id: ${g.id}`);
    if (!CATEGORIES.some((c) => c.id === g.category)) errors.push(`${g.id}: bad category`);
    if (g.winMasks.length > MAX_WIN_ALTS) errors.push(`${g.id}: too many winMasks`);
    if (g.displayMasks.length > MAX_DISPLAY_ALTS) errors.push(`${g.id}: too many displayMasks`);
    if (g.coveredThreshold === 0 && g.winMasks.length === 0 && !g.elimination) {
      errors.push(`${g.id}: empty winMasks`);
    }
    if (g.coveredThreshold < 0 || g.coveredThreshold > 25) errors.push(`${g.id}: bad threshold`);
    if (g.requiredPatterns < 1 || g.requiredPatterns > 8) errors.push(`${g.id}: bad requiredPatterns`);
    for (const m of [...g.winMasks, ...g.displayMasks]) {
      if (m === 0 && g.coveredThreshold === 0 && !g.elimination) errors.push(`${g.id}: empty mask`);
    }
  }
  if (catalog.length !== 48) errors.push(`Expected 48 types, got ${catalog.length}`);
  if (errors.length) {
    console.error("Catalog validation failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }
}

function emitTs(catalog) {
  const ids = catalog.map((g) => g.id);
  const lines = [];
  lines.push(`/* AUTO-GENERATED by scripts/generate-game-types.mjs — do not edit */`);
  lines.push(``);
  lines.push(`export const GAME_TYPE_CATEGORIES = ${JSON.stringify(CATEGORIES, null, 2)} as const;`);
  lines.push(`export type GameTypeCategoryId = (typeof GAME_TYPE_CATEGORIES)[number]["id"];`);
  lines.push(``);
  lines.push(`export type GameType =`);
  for (const id of ids) lines.push(`  | "${id}"`);
  lines.push(`;`);
  lines.push(``);
  lines.push(`export interface GameTypeDef {`);
  lines.push(`  id: GameType;`);
  lines.push(`  label: string;`);
  lines.push(`  category: GameTypeCategoryId;`);
  lines.push(`  description: string;`);
  lines.push(`  /** 1-indexed cell patterns that each constitute a win alternative */`);
  lines.push(`  winPatterns: number[][];`);
  lines.push(`  /** 1-indexed cell patterns cycled on the LED / indicator (may differ from win) */`);
  lines.push(`  displayPatterns: number[][];`);
  lines.push(`  requiredPatterns: number;`);
  lines.push(`  /** If > 0, win when at least this many cells are covered (incl. FREE) */`);
  lines.push(`  coveredThreshold: number;`);
  lines.push(`  minCalls: number;`);
  lines.push(`  oddsHits: number;`);
  lines.push(`  usesFreeSpace: boolean;`);
  lines.push(`  /** Last-survivor elimination (e.g. Battleship); no pattern masks. */`);
  lines.push(`  elimination: boolean;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const GAME_TYPE_DEFS: GameTypeDef[] = [`);
  for (const g of catalog) {
    const win = g.winMasks.map((m) => cellsFromMask(m));
    const disp = g.displayMasks.map((m) => cellsFromMask(m));
    lines.push(`  {`);
    lines.push(`    id: "${g.id}",`);
    lines.push(`    label: ${JSON.stringify(g.label)},`);
    lines.push(`    category: "${g.category}",`);
    lines.push(`    description: ${JSON.stringify(g.description)},`);
    lines.push(`    winPatterns: ${JSON.stringify(win)},`);
    lines.push(`    displayPatterns: ${JSON.stringify(disp)},`);
    lines.push(`    requiredPatterns: ${g.requiredPatterns},`);
    lines.push(`    coveredThreshold: ${g.coveredThreshold},`);
    lines.push(`    minCalls: ${g.minCalls},`);
    lines.push(`    oddsHits: ${g.oddsHits},`);
    lines.push(`    usesFreeSpace: ${g.usesFreeSpace},`);
    lines.push(`    elimination: ${g.elimination},`);
    lines.push(`  },`);
  }
  lines.push(`];`);
  lines.push(``);
  lines.push(`export const GAME_TYPE_BY_ID: Record<GameType, GameTypeDef> = Object.fromEntries(`);
  lines.push(`  GAME_TYPE_DEFS.map((d) => [d.id, d])`);
  lines.push(`) as Record<GameType, GameTypeDef>;`);
  lines.push(``);
  lines.push(`export const ALL_GAME_TYPES: GameType[] = GAME_TYPE_DEFS.map((d) => d.id);`);
  lines.push(``);
  lines.push(`export const GAME_TYPE_LABELS: Record<GameType, string> = Object.fromEntries(`);
  lines.push(`  GAME_TYPE_DEFS.map((d) => [d.id, d.label])`);
  lines.push(`) as Record<GameType, string>;`);
  lines.push(``);
  lines.push(`export const GAME_TYPE_MIN_CALLS: Record<GameType, number> = Object.fromEntries(`);
  lines.push(`  GAME_TYPE_DEFS.map((d) => [d.id, d.minCalls])`);
  lines.push(`) as Record<GameType, number>;`);
  lines.push(``);
  lines.push(`export const GAME_TYPE_CELLS: Record<GameType, number[]> = Object.fromEntries(`);
  lines.push(`  GAME_TYPE_DEFS.map((d) => [d.id, d.displayPatterns[0] ?? []])`);
  lines.push(`) as Record<GameType, number[]>;`);
  lines.push(``);
  lines.push(`export const CYCLING_PATTERNS: Partial<Record<GameType, number[][]>> = Object.fromEntries(`);
  lines.push(`  GAME_TYPE_DEFS.filter((d) => d.displayPatterns.length > 1).map((d) => [d.id, d.displayPatterns])`);
  lines.push(`);`);
  lines.push(``);
  lines.push(`export const GAME_TYPE_REQUIRED_HITS: Record<GameType, number> = Object.fromEntries(`);
  lines.push(`  GAME_TYPE_DEFS.map((d) => [d.id, d.oddsHits])`);
  lines.push(`) as Record<GameType, number>;`);
  lines.push(``);
  lines.push(`export function isGameType(value: string): value is GameType {`);
  lines.push(`  return value in GAME_TYPE_BY_ID;`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n") + "\n";
}

function emitH(catalog) {
  const lines = [];
  lines.push(`/* AUTO-GENERATED by scripts/generate-game-types.mjs — do not edit */`);
  lines.push(`#pragma once`);
  lines.push(`#include <stdint.h>`);
  lines.push(`#include <string.h>`);
  lines.push(``);
  lines.push(`#define GAME_TYPE_COUNT ${catalog.length}`);
  lines.push(`#define GAME_TYPE_MAX_WIN_ALTS ${MAX_WIN_ALTS}`);
  lines.push(`#define GAME_TYPE_MAX_DISPLAY_ALTS ${MAX_DISPLAY_ALTS}`);
  lines.push(`#define GAME_TYPE_ID_MAX ${MAX_ID_LEN}`);
  lines.push(``);
  lines.push(`struct GameTypeDef {`);
  lines.push(`  const char* id;`);
  lines.push(`  uint8_t winCount;`);
  lines.push(`  uint8_t displayCount;`);
  lines.push(`  uint8_t requiredPatterns;`);
  lines.push(`  uint8_t coveredThreshold;`);
  lines.push(`  uint8_t minCalls;`);
  lines.push(`  uint8_t elimination;`);
  lines.push(`  const uint32_t* winMasks;`);
  lines.push(`  const uint32_t* displayMasks;`);
  lines.push(`};`);
  lines.push(``);

  for (let i = 0; i < catalog.length; i++) {
    const g = catalog[i];
    const win = g.winMasks.length ? g.winMasks : [0];
    const disp = g.displayMasks.length ? g.displayMasks : [0];
    lines.push(
      `static const uint32_t GT_WIN_${i}[] = { ${win.map((m) => `0x${m.toString(16)}u`).join(", ")} };`
    );
    lines.push(
      `static const uint32_t GT_DISP_${i}[] = { ${disp.map((m) => `0x${m.toString(16)}u`).join(", ")} };`
    );
  }
  lines.push(``);
  lines.push(`static const GameTypeDef GAME_TYPE_TABLE[GAME_TYPE_COUNT] = {`);
  for (let i = 0; i < catalog.length; i++) {
    const g = catalog[i];
    lines.push(
      `  { "${g.id}", ${g.winMasks.length}, ${g.displayMasks.length}, ${g.requiredPatterns}, ${g.coveredThreshold}, ${g.minCalls}, ${g.elimination ? 1 : 0}, GT_WIN_${i}, GT_DISP_${i} },`
    );
  }
  lines.push(`};`);
  lines.push(``);
  lines.push(`inline const GameTypeDef* gameTypeDefAt(int idx) {`);
  lines.push(`  if (idx < 0 || idx >= GAME_TYPE_COUNT) return nullptr;`);
  lines.push(`  return &GAME_TYPE_TABLE[idx];`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`inline int findGameTypeIndex(const char* id) {`);
  lines.push(`  if (!id) return -1;`);
  lines.push(`  for (int i = 0; i < GAME_TYPE_COUNT; i++) {`);
  lines.push(`    if (strcmp(GAME_TYPE_TABLE[i].id, id) == 0) return i;`);
  lines.push(`  }`);
  lines.push(`  return -1;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`inline bool isValidGameTypeId(const char* id) { return findGameTypeIndex(id) >= 0; }`);
  lines.push(``);
  lines.push(`inline uint32_t gameTypeWinMaskAt(const GameTypeDef* def, int alt) {`);
  lines.push(`  if (!def || alt < 0 || alt >= def->winCount) return 0;`);
  lines.push(`  return def->winMasks[alt];`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`inline uint32_t gameTypeDisplayMaskAt(const GameTypeDef* def, int alt) {`);
  lines.push(`  if (!def || alt < 0 || alt >= def->displayCount) return 0;`);
  lines.push(`  return def->displayMasks[alt];`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n") + "\n";
}

function emitJson(catalog) {
  return (
    JSON.stringify(
      {
        categories: CATEGORIES,
        types: catalog.map((g) => ({
          id: g.id,
          label: g.label,
          category: g.category,
          description: g.description,
          winPatterns: g.winMasks.map((m) => cellsFromMask(m)),
          displayPatterns: g.displayMasks.map((m) => cellsFromMask(m)),
          requiredPatterns: g.requiredPatterns,
          coveredThreshold: g.coveredThreshold,
          minCalls: g.minCalls,
          oddsHits: g.oddsHits,
          usesFreeSpace: g.usesFreeSpace,
          elimination: g.elimination,
        })),
      },
      null,
      2
    ) + "\n"
  );
}

function main() {
  validate(CATALOG);
  const ts = emitTs(CATALOG);
  const h = emitH(CATALOG);
  const json = emitJson(CATALOG);
  const check = process.argv.includes("--check");

  if (check) {
    let ok = true;
    for (const [path, content] of [
      [TS_OUT, ts],
      [H_OUT, h],
      [JSON_OUT, json],
    ]) {
      if (!existsSync(path)) {
        console.error(`Missing generated file: ${path}`);
        ok = false;
        continue;
      }
      const existing = readFileSync(path, "utf8");
      if (existing !== content) {
        console.error(`Out of date: ${path}`);
        ok = false;
      }
    }
    if (!ok) process.exit(1);
    console.log(`OK: ${CATALOG.length} game types, generated files up to date.`);
    return;
  }

  mkdirSync(dirname(TS_OUT), { recursive: true });
  mkdirSync(dirname(H_OUT), { recursive: true });
  writeFileSync(TS_OUT, ts);
  writeFileSync(H_OUT, h);
  writeFileSync(JSON_OUT, json);
  console.log(`Wrote ${TS_OUT}`);
  console.log(`Wrote ${H_OUT}`);
  console.log(`Wrote ${JSON_OUT}`);
  console.log(`${CATALOG.length} game types.`);

  // Quick parity assertions
  const railroad = CATALOG.find((g) => g.id === "railroad");
  if (railroad.winMasks.length !== 20) throw new Error("Railroad should have 20 pairs");
  const ladder = CATALOG.find((g) => g.id === "ladder");
  if (!ladder || ladder.winMasks.length !== 3) throw new Error("Ladder should have 3 placements");
  const asterisk = CATALOG.find((g) => g.id === "asterisk");
  if (!asterisk || asterisk.winMasks.length !== 2 || asterisk.requiredPatterns !== 2) {
    throw new Error("Asterisk should require both X and Plus");
  }
  const allCells = maskFromCells(Array.from({ length: 25 }, (_, i) => i + 1));
  if ((EVERY_OTHER_1 & EVERY_OTHER_2) !== 0) throw new Error("Every Other masks should be disjoint");
  if (((EVERY_OTHER_1 | EVERY_OTHER_2) >>> 0) !== allCells) {
    throw new Error("Every Other masks should partition the board");
  }
  const bl = CATALOG.find((g) => g.id === "blackout_lite");
  if (bl.coveredThreshold !== 20) throw new Error("Blackout Lite threshold");
  const db = CATALOG.find((g) => g.id === "double_bingo");
  if (db.requiredPatterns !== 2) throw new Error("Double Bingo requiredPatterns");
  if (db.displayMasks.length !== 66) throw new Error(`Double Bingo should cycle 66 pairs, got ${db.displayMasks.length}`);
  console.log("Assertions passed (railroad=20, ladder=3, asterisk=2, every_other, blackout_lite, double_bingo=66 displays).");
}

main();
