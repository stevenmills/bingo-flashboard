#!/usr/bin/env node
/**
 * Bundle each voice folder's MP3s into a single pack.bin for fast SPIFFS prefetch.
 *
 * Format (little-endian):
 *   magic[8] = "BNGPCK01"
 *   count u16
 *   repeated:
 *     nameLen u8
 *     name utf8 (basename, e.g. "B-12.mp3")
 *     size u32
 *     data[size]
 *
 * Usage: node scripts/build-caller-voice-packs.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_CV = path.join(ROOT, "frontend/public/cv");
const DATA_CV = path.join(ROOT, "data/cv");
const MAGIC = Buffer.from("BNGPCK01", "ascii");

const SLUGS = ["F1", "F2", "M1", "M2"];

function buildPack(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mp3"))
    .sort();
  if (files.length === 0) return null;

  const parts = [MAGIC, Buffer.alloc(2)];
  parts[1].writeUInt16LE(files.length, 0);

  let totalMp3 = 0;
  for (const name of files) {
    const data = fs.readFileSync(path.join(dir, name));
    totalMp3 += data.length;
    if (name.length > 255) throw new Error(`name too long: ${name}`);
    const header = Buffer.alloc(1 + name.length + 4);
    header.writeUInt8(name.length, 0);
    header.write(name, 1, "utf8");
    header.writeUInt32LE(data.length, 1 + name.length);
    parts.push(header, data);
  }

  const pack = Buffer.concat(parts);
  return { pack, files: files.length, totalMp3 };
}

function writePack(slug) {
  const publicDir = path.join(PUBLIC_CV, slug);
  const built = buildPack(publicDir);
  if (!built) {
    console.log(`  skip ${slug} (no mp3s)`);
    return;
  }
  const out = path.join(publicDir, "pack.bin");
  fs.writeFileSync(out, built.pack);
  const dataDir = path.join(DATA_CV, slug);
  if (fs.existsSync(path.join(ROOT, "data"))) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(out, path.join(dataDir, "pack.bin"));
  }
  console.log(
    `  ${slug}/pack.bin — ${built.files} clips, ${(built.pack.length / 1024).toFixed(0)} KiB (mp3 ${((built.totalMp3) / 1024).toFixed(0)} KiB)`
  );
}

console.log("Building caller voice packs…");
for (const slug of SLUGS) writePack(slug);
console.log("Done.");
