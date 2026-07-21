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
const BITRATE = process.env.CALLER_MP3_BITRATE || '24k';
const CONCURRENCY = Number(process.env.CALLER_TTS_CONCURRENCY || 4);

const INSTRUCTIONS = `Affect/personality:
Warm, enthusiastic, friendly, welcoming, community-oriented, confident, cheerful, and engaging. Sounds like an experienced volunteer who genuinely enjoys hosting bingo and interacting with the crowd.
Tone:
Upbeat, bright, positive, and conversational with lively energy. Projects clearly without shouting. Encouraging and playful while remaining professional and easy to follow.
Pronunciation:
Clear diction with crisp consonants. Speak each call as the letter name, then the number words — for example: "Bee, twelve" or "En, forty-one". Never insert the word "and" between the letter and the number (do not say "Bee and three"). Never spell letter names as single alphabet letters followed by "N".
Pause:
A short beat between the letter name and the number — just enough to mark the card, not a long dramatic pause. Use a comma pause, not a drawn-out ellipsis.
Emotion:
Joyful, energetic, encouraging, and genuinely excited to be hosting. Expresses delight when calling numbers and maintains a positive, welcoming atmosphere.`;

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

/** Supplemental jokes — punchlines only; the letter/number call already played. */
const JOKE_INSTRUCTIONS = `Affect/personality:
Warm bingo host delivering a quick one-liner — playful, witty, and good-natured.
Tone:
Conversational comedy at a snappy pace. Bright smile in the voice; clear enough for a noisy hall.
Pronunciation:
Clear diction so the punchline lands. Do NOT announce or repeat the bingo letter or number (no "B-12", "Eye sixteen", "N forty-five", etc.) — that call-out already played. Speak only the joke line as written.
Pause:
No leading pause. Tiny beat before the punch when punctuation suggests it. End cleanly with no trailing filler.
Emotion:
Amused and encouraging — keep it moving.`;

/**
 * Per-number joke lines → joke-{Letter}-{n}.mp3
 * Do not lead with a number re-call (e.g. "Forty-five!"); the call-out clip already did that.
 */
const NUMBER_JOKES = [
  [1, "Number one in my heart... don't tell the other seventy-four."],
  [2, "Bee yourself... everybody else is already playing bingo."],
  [3, "Bee careful... this little number has started winning streaks before!"],
  [4, "Before anyone yells 'BINGO,' let's make sure you've actually got it!"],
  [5, "Buzzing in with another beautiful B!"],
  [6, "Sweet as honey... unless you were holding out for seven."],
  [7, "Lucky number seven decided to wear a B today."],
  [8, "Better mark it—I have a feeling this one's up to something."],
  [9, "'Be mine?' Sorry, my heart already belongs to bingo."],
  [10, "Ben there, daubed that!"],
  [11, "Two little ones standing shoulder to shoulder... probably swapping lucky numbers."],
  [12, "The only vitamin that comes with a chance to win cash!"],
  [13, "Unlucky for some... but today could be your lucky day."],
  [14, "Before-teen... don't question it, I'm a bingo caller, not an English teacher!"],
  [15, "The penthouse suite of the B column!"],
  [16, "Sweet sixteen... and still not old enough to drive your dauber."],
  [17, "I've got a good feeling about this one... mostly because I say that every time."],
  [18, "If this completed your line, try to act surprised."],
  [19, "I'd tell you this one's lucky... but I don't want the other numbers getting jealous."],
  [20, "Perfect vision—it can already see your jackpot."],
  [21, "Finally old enough to buy... another bingo card!"],
  [22, "Two little ducks! Quack, quack... now mark your card."],
  [23, "Nobody expects this one... except the people who needed it."],
  [24, "Two dozen? Sounds like somebody ordered extra luck."],
  [25, "Quarter of a hundred... because saying 'twenty-five' was apparently too easy."],
  [26, "Proof that every number deserves its moment in the spotlight."],
  [27, "Lucky? Maybe. Fashionable? Absolutely."],
  [28, "Twenty ate... because it was hungry for a winner!"],
  [29, "So close to thirty it can almost hear everyone complaining about getting older."],
  [30, "That's the top shelf of the I column—give it a warm welcome!"],
  [31, "The overachiever that just couldn't stay in the twenties."],
  [32, "Smile... your card might finally be cooperating."],
  [33, "Double threes! They're seeing double so you don't have to."],
  [34, "Not famous, just reliable."],
  [35, "Age is just a number... and this one agrees."],
  [36, "Three dozen! Fresh from the bingo bakery."],
  [37, "Oddly specific, just like my lucky socks."],
  [38, "Looking great... that's what it told me, anyway."],
  [39, "Almost forty, but who's counting? Besides me."],
  [40, "Forty is the new... forty."],
  [41, "A prime number with a prime attitude."],
  [42, "The answer to life, the universe... and hopefully your bingo card."],
  [43, "Not everyone's favorite... but somebody out there just cheered."],
  [44, "Double fours! Four-tified and ready to win."],
  [45, "Right down the middle... just like my dance moves."],
  [46, "This one showed up dressed to impress."],
  [47, "Proof that good things come to those who daub."],
  [48, "Looking great... it insisted I say that."],
  [49, "Almost fifty, but who's rushing?"],
  [50, "Half a hundred! That's what I call bingo math."],
  [51, "If your card's getting exciting, I can feel the suspense from here."],
  [52, "A full deck has nothing on a full bingo card."],
  [53, "This number came to play."],
  [54, "Don't worry, the lucky numbers travel in packs... probably."],
  [55, "Double nickels! No speeding through your daubing now."],
  [56, "Sweet enough to put a smile on somebody's face."],
  [57, "Heinz may have the varieties, but we've got the better numbers."],
  [58, "If this finished your row, try not to scare the neighbors."],
  [59, "One step away from the top of the Gs."],
  [60, "The penthouse suite of the G column... enjoy the view!"],
  [61, "This number always arrives with confidence."],
  [62, "Just cruising through the O column."],
  [63, "It's not old—it's well seasoned."],
  [64, "Still loading... please wait."],
  [65, "Retirement? This number says it's just getting warmed up."],
  [66, "Double sixes! Twice the six, twice the style."],
  [67, "Oddly satisfying, just like a perfectly centered daub."],
  [68, "So close to the number everybody pretends not to laugh at."],
  [69, "I know... you're all very mature. Let's keep it moving."],
  [70, "It's got seniority, and it knows it."],
  [71, "Proof that the O column still has surprises left."],
  [72, "Half a dozen dozens... that's a lot of dozen if you ask me."],
  [73, "Lucky for somebody... statistically speaking."],
  [74, "The suspense is getting thicker than grandma's gravy."],
  [75, "The very top of the board! It saved the best seat in the house for itself."],
];

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

/** Possessive letter names for column prompts ("No more Gee's!"). */
function letterNamePossessive(letter) {
  // G must be "Gee's" — "Gees" is misread as a hard G / geese-like syllable.
  return { B: "Bee's", I: "Eye's", N: "En's", G: "Gee's", O: "Oh's" }[letter];
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
    // Comma (not ellipsis): TTS often turns "Bee... three" into "Bee and three" → sounds like "B.. N.. 3".
    jobs.push({
      text: `${letterName(letter)}, ${numberWord(n)}`,
      file: `${letter}-${n}.mp3`,
    });
  }
  for (const [n, text] of NUMBER_JOKES) {
    const letter = letterForNumber(n);
    jobs.push({
      text,
      file: `joke-${letter}-${n}.mp3`,
      instructions: JOKE_INSTRUCTIONS,
    });
  }
  for (const letter of ['B', 'I', 'N', 'G', 'O']) {
    const possessive = letterNamePossessive(letter);
    const spoken = letterName(letter);
    jobs.push({
      text: `No more ${possessive}!`,
      file: `no-more-${letter}.mp3`,
      instructions: `${INSTRUCTIONS}

Pronunciation note for this clip:
Say the bingo letter as "${spoken}" with a clear possessive "s" — exactly like "${spoken}'s", not a hard consonant cluster and not "geese".`,
    });
    jobs.push({
      text: `All the ${possessive} have been called!`,
      file: `all-called-${letter}.mp3`,
      instructions: `${INSTRUCTIONS}

Pronunciation note for this clip:
Say the bingo letter as "${spoken}" with a clear possessive "s" — exactly like "${spoken}'s", not a hard consonant cluster and not "geese".`,
    });
  }

  if (process.env.CALLER_ONLY_JOKES === '1') {
    return jobs.filter((j) => j.file.startsWith('joke-'));
  }
  if (process.env.CALLER_ONLY_NUMBERS === '1') {
    return jobs.filter((j) => /^[BINGO]-\d+\.mp3$/.test(j.file));
  }
  if (process.env.CALLER_ONLY_COLUMN_PROMPTS === '1') {
    return jobs.filter(
      (j) => j.file.startsWith('no-more-') || j.file.startsWith('all-called-')
    );
  }

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
