#!/usr/bin/env node
/**
 * Focused assertions for the game-type catalog (parity + rule semantics).
 * Run: node scripts/validate-game-types.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const gen = spawnSync("node", [join(ROOT, "scripts/generate-game-types.mjs"), "--check"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (gen.status !== 0) {
  console.error(gen.stdout);
  console.error(gen.stderr);
  fail("generated files out of date or invalid");
}

const catalog = JSON.parse(
  readFileSync(join(ROOT, "frontend/src/lib/game-types.generated.json"), "utf8")
);
const types = catalog.types;
const byId = Object.fromEntries(types.map((t) => [t.id, t]));

if (types.length !== 47) fail(`expected 47 types, got ${types.length}`);

const railroad = byId.railroad;
if (!railroad || railroad.winPatterns.length !== 20) {
  fail(`railroad should have 20 win patterns, got ${railroad?.winPatterns?.length}`);
}

const ladder = byId.ladder;
if (!ladder || ladder.winPatterns.length !== 3) {
  fail(`ladder should have 3 win patterns, got ${ladder?.winPatterns?.length}`);
}

const asterisk = byId.asterisk;
if (!asterisk || asterisk.winPatterns.length !== 2 || asterisk.requiredPatterns !== 2) {
  fail(`asterisk should require both X and Plus, got patterns=${asterisk?.winPatterns?.length} required=${asterisk?.requiredPatterns}`);
}

const blackout = byId.blackout_lite;
if (!blackout || blackout.coveredThreshold !== 20) fail("blackout_lite coveredThreshold");
if (blackout.winPatterns.length !== 0) fail("blackout_lite should use threshold, not winPatterns");

const doubleBingo = byId.double_bingo;
if (!doubleBingo || doubleBingo.requiredPatterns !== 2) fail("double_bingo requiredPatterns");
if (doubleBingo.winPatterns.length !== 12) fail("double_bingo should reuse 12 traditional lines");
if (doubleBingo.displayPatterns.length !== 66) {
  fail(`double_bingo should cycle 66 two-line displays, got ${doubleBingo.displayPatterns.length}`);
}

const traditional = byId.traditional;
if (traditional.winPatterns.length !== 12) fail("traditional should have 12 patterns");
if (traditional.displayPatterns.length !== 12) fail("traditional should cycle 12 displays");

const postage = byId.postage_stamp;
if (postage.displayPatterns.length !== 4) fail("postage_stamp should cycle 4");

const bigStamp = byId.big_stamp;
if (bigStamp.winPatterns.length !== 4) fail("big_stamp should have 4 corners");

const arrow = byId.arrow;
if (arrow.winPatterns.length < 4) fail("arrow should rotate");

const split = byId.split_the_room;
if (split.winPatterns.length !== 2) fail("split_the_room variants");

const topBottom = byId.top_vs_bottom;
if (topBottom.winPatterns.length !== 2) fail("top_vs_bottom variants");

const diag = byId.diagonal_band;
if (diag.winPatterns.length !== 2) fail("diagonal_band slopes");

const glyph = byId.bingo_glyph;
if (glyph.winPatterns.length !== 5) fail("bingo_glyph should have B-I-N-G-O");

const letterY = byId.y;
const yCells = letterY.winPatterns[0];
if (!yCells.includes(13)) fail("letter Y must include FREE (13)");
const yMin = letterY.minCalls;
if (yMin !== 6) fail(`letter Y minCalls should be 6 numbered cells, got ${yMin}`);

// FREE-cell minima: patterns including FREE should not count FREE as a call
for (const t of types) {
  if (t.coveredThreshold > 0) continue;
  if (!t.usesFreeSpace) continue;
  for (const pat of t.winPatterns) {
    if (!pat.includes(13)) continue;
    const numbered = pat.length - 1;
    if (t.requiredPatterns === 1 && t.minCalls > numbered) {
      fail(`${t.id}: minCalls ${t.minCalls} > numbered cells ${numbered}`);
    }
  }
}

// Firmware header parity
const header = readFileSync(join(ROOT, "include/game_types.generated.h"), "utf8");
if (!header.includes(`#define GAME_TYPE_COUNT ${types.length}`)) {
  fail("firmware GAME_TYPE_COUNT mismatch");
}
for (const t of types) {
  if (!header.includes(`"${t.id}"`)) fail(`firmware missing id ${t.id}`);
}

console.log("validate-game-types: OK");
console.log(`  ${types.length} types`);
console.log(`  railroad=${railroad.winPatterns.length} blackout=${blackout.coveredThreshold} double_bingo=${doubleBingo.requiredPatterns}`);
