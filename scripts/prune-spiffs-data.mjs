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

const total = fs
  .readdirSync(dataDir)
  .map((n) => fs.statSync(path.join(dataDir, n)).size)
  .reduce((a, b) => a + b, 0);
console.log(
  `[prune-spiffs] data/ total ${(total / 1024 / 1024).toFixed(2)} MiB (SPIFFS ~${(
    0x230000 /
    1024 /
    1024
  ).toFixed(2)} MiB)`
);
