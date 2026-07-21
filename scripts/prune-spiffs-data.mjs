#!/usr/bin/env node
/**
 * Remove stale Vite hashed bundles from data/ (SPIFFS upload dir).
 * Keeps assets referenced from index.html and transitively from kept JS chunks.
 * Never deletes MP3 / SVG / other non-hashed static assets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const indexHtml = path.join(dataDir, "index.html");

if (!fs.existsSync(dataDir)) {
  process.exit(0);
}

const ALWAYS_KEEP = new Set([
  "index.html",
  "paw.svg",
  "favicon.ico",
  "favicon.svg",
]);

/** Hashed Vite outputs we may prune when unreferenced. */
function isPrunableBundle(name) {
  return /\.(js|css)$/.test(name) && !name.startsWith(".");
}

function extractBundleNames(text) {
  const found = new Set();
  for (const m of text.matchAll(/\/?([A-Za-z0-9_.-]+\.(?:js|css))/g)) {
    found.add(m[1]);
  }
  return found;
}

const keep = new Set(ALWAYS_KEEP);

// Preserve caller audio and other static non-bundle files by name presence later.
if (fs.existsSync(indexHtml)) {
  const html = fs.readFileSync(indexHtml, "utf8");
  for (const name of extractBundleNames(html)) {
    if (fs.existsSync(path.join(dataDir, name))) keep.add(name);
  }
}

// Walk JS import graph so dynamic chunks (e.g. bingo-cards-pdf-*.js) are kept.
const queue = [...keep];
while (queue.length) {
  const name = queue.pop();
  if (!name || !name.endsWith(".js")) continue;
  const full = path.join(dataDir, name);
  if (!fs.existsSync(full)) continue;
  let text = "";
  try {
    text = fs.readFileSync(full, "utf8");
  } catch {
    continue;
  }
  for (const ref of extractBundleNames(text)) {
    if (keep.has(ref)) continue;
    if (!fs.existsSync(path.join(dataDir, ref))) continue;
    if (!isPrunableBundle(ref) && !ALWAYS_KEEP.has(ref)) continue;
    keep.add(ref);
    queue.push(ref);
  }
}

let removed = 0;
for (const name of fs.readdirSync(dataDir)) {
  if (!isPrunableBundle(name)) continue;
  if (keep.has(name)) continue;
  // Never touch mp3s (already excluded by extension).
  fs.unlinkSync(path.join(dataDir, name));
  removed++;
  console.log(`[prune-spiffs] removed stale ${name}`);
}

if (removed > 0) {
  console.log(`[prune-spiffs] removed ${removed} stale bundle(s)`);
} else {
  console.log("[prune-spiffs] no stale bundles");
}

// Prefer pack.bin on SPIFFS: drop per-clip MP3s when a pack exists (saves file-count overhead).
let removedMp3 = 0;
const cvDir = path.join(dataDir, "cv");
if (fs.existsSync(cvDir)) {
  for (const slug of fs.readdirSync(cvDir)) {
    const slugDir = path.join(cvDir, slug);
    if (!fs.statSync(slugDir).isDirectory()) continue;
    const packPath = path.join(slugDir, "pack.bin");
    if (!fs.existsSync(packPath)) continue;
    for (const name of fs.readdirSync(slugDir)) {
      if (!name.endsWith(".mp3")) continue;
      // Keep tiny utilities for Settings / unlock before pack finishes downloading.
      if (name === "example.mp3" || name === "on.mp3" || name === "bingo.mp3" || name === "jokes-on.mp3") {
        continue;
      }
      fs.unlinkSync(path.join(slugDir, name));
      removedMp3++;
    }
  }
}
if (removedMp3 > 0) {
  console.log(`[prune-spiffs] removed ${removedMp3} per-clip mp3(s); using pack.bin`);
}

function dirBytes(dir) {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) total += dirBytes(full);
    else total += st.size;
  }
  return total;
}

const SPIFFS_BYTES = 0xdf0000; // partitions/bingo.csv
/** SPIFFS only reliably holds ~75% of the partition (Espressif docs). */
const SPIFFS_USABLE = Math.floor(SPIFFS_BYTES * 0.75);
const total = dirBytes(dataDir);
const pctUsable = (100 * total) / SPIFFS_USABLE;
console.log(
  `[prune-spiffs] data/ total ${(total / 1024 / 1024).toFixed(2)} MiB ` +
    `(SPIFFS partition ~${(SPIFFS_BYTES / 1024 / 1024).toFixed(2)} MiB, ` +
    `usable ~${(SPIFFS_USABLE / 1024 / 1024).toFixed(2)} MiB, ${pctUsable.toFixed(0)}% filled)`
);
if (total > SPIFFS_USABLE * 0.92) {
  console.warn(
    `[prune-spiffs] WARNING: payload is near/over SPIFFS usable capacity — uploadfs may fail with File system is full.`
  );
}
