#!/usr/bin/env node
/**
 * Generate bingo caller MP3 voice packs via OpenAI TTS + vibe instructions.
 * Re-encodes with ffmpeg for SPIFFS size. Requires OPENAI_API_KEY in .env and ffmpeg.
 *
 * Usage:
 *   node scripts/generate-caller-audio-openai.mjs
 *   CALLER_VOICE_PACKS=Male1,Male2,Female2 node scripts/generate-caller-audio-openai.mjs
 *
 * Packs write to frontend/public/cv/{F1,F2,M1,M2}/ (short SPIFFS paths) and copy into data/.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_VOICES = path.join(ROOT, 'frontend/public/cv');
const DATA_VOICES = path.join(ROOT, 'data/cv');
const TMP_DIR = fs.mkdtempSync(path.join(ROOT, '.caller-tts-'));

/** Pack id → OpenAI voice name */
const VOICE_PACKS = {
  Female1: 'sage',
  Female2: 'marin',
  Male1: 'onyx',
  Male2: 'cedar',
};

/** Pack id → short SPIFFS directory slug (/cv/{slug}/… ≤ 31 chars). */
const VOICE_SLUGS = {
  Female1: 'F1',
  Female2: 'F2',
  Male1: 'M1',
  Male2: 'M2',
};

const MODEL = process.env.CALLER_OPENAI_MODEL || 'gpt-4o-mini-tts';
const SAMPLE_RATE = process.env.CALLER_SAMPLE_RATE || '16000';
const BITRATE = process.env.CALLER_MP3_BITRATE || '32k';
const CONCURRENCY = Number(process.env.CALLER_TTS_CONCURRENCY || 4);

const INSTRUCTIONS = `Affect/personality:
Warm, enthusiastic, friendly, welcoming, community-oriented, confident, cheerful, and engaging. Sounds like an experienced volunteer who genuinely enjoys hosting bingo and interacting with the crowd.
Tone:
Upbeat, bright, positive, and conversational with moderate energy. Projects clearly without shouting. Encouraging and playful while remaining professional and easy to follow.
Pronunciation:
Exceptionally clear diction with crisp consonants and deliberate enunciation. Speaks numbers and letters distinctly, avoiding any ambiguity (e.g., "B-12," "N-41"). Maintains a steady pace so players of all ages can easily understand every call.
Pause:
Brief, intentional pauses between the bingo letter and number (e.g., "B... 12"), and a slightly longer pause before the next call to allow players time to mark their cards. Uses natural pauses for emphasis without sounding slow.
Emotion:
Joyful, energetic, encouraging, and genuinely excited to be hosting. Expresses delight when calling numbers, builds anticipation naturally, and maintains a positive, welcoming atmosphere throughout the game. Sounds like someone who loves bingo and wants everyone to have a great time.`;

/** Winner yell — overrides the calmer host vibe for bingo.mp3 only. */
const BINGO_WIN_INSTRUCTIONS = `Affect/personality:
Someone who just won a round of bingo — super excited, loud, clear, and cheerful, almost yelling with pure delight.
Tone:
High energy celebration. Bright, triumphant, and joyful. Projects loudly and clearly without mumbling. Cheerful almost-yell, not angry or harsh.
Pronunciation:
Emphasize and draw out the word like a victory cry: "BIIINNGGGOOOOOO!!" Stretch the vowels and hold the final "O" with excitement. Crisp consonants so it still reads as BINGO.
Pause:
No leading pause — burst straight into the word. Hold the drawn-out ending, then cut cleanly.
Emotion:
Ecstatic winner energy. Loud, clear, cheerful celebration — the happiest moment of the night.`;

function loadApiKey() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) throw new Error('Missing .env with OPENAI_API_KEY');
  const m = fs.readFileSync(envPath, 'utf8').match(/^OPENAI_API_KEY=(.+)$/m);
  const key = m?.[1]?.trim();
  if (!key || key.includes('sk-...')) throw new Error('OPENAI_API_KEY not set in .env');
  return key;
}

function letterForNumber(n) {
  if (n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  return 'O';
}

function letterName(letter) {
  return { B: 'Bee', I: 'Eye', N: 'En', G: 'Gee', O: 'Oh' }[letter];
}

function numberWord(n) {
  const ones = [
    '',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy'];
  if (n < 20) return ones[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${tens[t]} ${ones[o]}` : tens[t];
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed (${code}): ${err}`));
    });
  });
}

async function synthesize(apiKey, voice, text, rawPath, instructions = INSTRUCTIONS) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      voice,
      input: text,
      instructions,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    throw new Error(`TTS failed (${res.status}): ${await res.text()}`);
  }
  fs.writeFileSync(rawPath, Buffer.from(await res.arrayBuffer()));
}

async function compress(rawPath, outPath) {
  await run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    rawPath,
    '-ac',
    '1',
    '-ar',
    SAMPLE_RATE,
    '-codec:a',
    'libmp3lame',
    '-b:a',
    BITRATE,
    outPath,
  ]);
}

async function mapPool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

function buildJobs() {
  const jobs = [
    { text: 'Caller on', file: 'on.mp3' },
    { text: 'Jokes on', file: 'jokes-on.mp3' },
    {
      text: 'BIIINNGGGOOOOOO!!',
      file: 'bingo.mp3',
      instructions: BINGO_WIN_INSTRUCTIONS,
    },
    {
      text:
        "Alright everybody!, take a deep breath... because I've got seventy-five beautiful little reasons to be excited! My favorite sound in the whole world is someone yelling 'BINGO!!'—well, unless it's me yelling it by accident. Cards up, daubers ready, let's make some magic happen!",
      file: 'example.mp3',
    },
  ];
  for (let n = 1; n <= 75; n++) {
    const letter = letterForNumber(n);
    jobs.push({
      text: `${letterName(letter)}... ${numberWord(n)}`,
      file: `${letter}-${n}.mp3`,
    });
  }
  jobs.push(
    { text: 'Before what?', file: 'joke-B-4.mp3' },
    { text: 'six seven six seven six seven', file: 'joke-O-67.mp3' }
  );

  const onlyRaw = process.env.CALLER_ONLY_FILES || '';
  if (!onlyRaw.trim()) return jobs;
  const only = new Set(
    onlyRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const filtered = jobs.filter((j) => only.has(j.file));
  if (filtered.length === 0) {
    throw new Error(`CALLER_ONLY_FILES matched nothing. Wanted: ${[...only].join(', ')}`);
  }
  return filtered;
}

function resolvePacks() {
  const raw = process.env.CALLER_VOICE_PACKS || process.env.CALLER_VOICE_PACK || '';
  if (!raw.trim()) {
    return Object.keys(VOICE_PACKS);
  }
  const packs = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of packs) {
    if (!VOICE_PACKS[p]) {
      throw new Error(`Unknown pack "${p}". Valid: ${Object.keys(VOICE_PACKS).join(', ')}`);
    }
  }
  return packs;
}

function dirBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((sum, f) => {
    const full = path.join(dir, f);
    const st = fs.statSync(full);
    return sum + (st.isFile() ? st.size : 0);
  }, 0);
}

const apiKey = loadApiKey();
const packs = resolvePacks();
const jobs = buildJobs();
const started = Date.now();

console.log(
  `Generating ${packs.length} pack(s) × ${jobs.length} clips model=${MODEL} bitrate=${BITRATE} concurrency=${CONCURRENCY}`
);

try {
  for (const packId of packs) {
    const openaiVoice = VOICE_PACKS[packId];
    const slug = VOICE_SLUGS[packId];
    const outDir = path.join(PUBLIC_VOICES, slug);
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`\n=== ${packId}/${slug} (OpenAI voice=${openaiVoice}) → ${outDir}`);

    let done = 0;
    await mapPool(jobs, CONCURRENCY, async (job) => {
      const raw = path.join(TMP_DIR, `${slug}-${job.file}`);
      const out = path.join(outDir, job.file);
      await synthesize(apiKey, openaiVoice, job.text, raw, job.instructions || INSTRUCTIONS);
      await compress(raw, out);
      done += 1;
      console.log(`  [${done}/${jobs.length}] ${slug}/${job.file} ← "${job.text}"`);
    });

    const dataDir = path.join(DATA_VOICES, slug);
    if (fs.existsSync(path.dirname(DATA_VOICES)) || fs.existsSync(path.join(ROOT, 'data'))) {
      fs.mkdirSync(dataDir, { recursive: true });
      for (const f of fs.readdirSync(outDir)) {
        if (!f.endsWith('.mp3')) continue;
        fs.copyFileSync(path.join(outDir, f), path.join(dataDir, f));
      }
    }

    console.log(
      `  ${packId} done — ${(dirBytes(outDir) / 1024).toFixed(0)} KiB`
    );
  }
} finally {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log(
  `\nAll packs finished in ${((Date.now() - started) / 1000).toFixed(1)}s`
);

const packBuild = spawnSync(process.execPath, [path.join(__dirname, "build-caller-voice-packs.mjs")], {
  stdio: "inherit",
});
if (packBuild.status !== 0) process.exit(packBuild.status ?? 1);
