# 🎱 Bingo Flashboard

An **ESP32-S3 N16R8** development board drives a **105-LED 12V WS2811** bingo board — and serves a full **React web UI** over WiFi so phones, tablets, and laptops can call games, join cards, hear call-outs, and print signed bingo sheets.

Connect to the **`BINGO`** network → open **`http://bingo.local`** (fallback **`http://192.168.4.1`**) → pick **Board** or **Card** mode → play.

---

## ✨ What’s in the box

| 🎮 Gameplay | 💡 Lights | 📱 Clients | 🔐 Safety |
|---|---|---|---|
| 42 game types | 19 themes + vibrance | Board host UI | PIN + 7-day token |
| Auto / manual calling | Screensavers (13) | Printed QR cards | Unlock lockout |
| Physical buttons | Called-number banner | Live card sync | Device-signed cards |
| Caller audio + jokes | Winner animations | Odds drawer | Optional home WiFi |

---

## 🧩 Hardware

**Board:** [ESP32-S3 N16R8 development board](https://www.amazon.com/dp/B0F5QCK6X5) — ESP32-S3-WROOM-1, **16 MB** flash, **8 MB** PSRAM, dual USB-C, 44-pin DevKitC-1 layout

**Strip:** WS2811 × **105**, **12V**, single data line

Wire by **GPIO numbers on the silkscreen** (not classic 30-pin ESP32 charts). Full pinout: **[WIRING.md](WIRING.md)**

| Function | GPIO | Silkscreen | Connect |
|---|---|---|---|
| LED data | **4** | **`4`** (J1) | Strip **DIN** |
| Button 1 | **16** | **`16`** (J1) | Momentary → **GND** |
| Button 2 | **17** | **`17`** (J1) | Momentary → **GND** |
| Status LED | **2** | **`2`** (J3) | Header GPIO (onboard RGB is separate) |
| Ground | — | **`G`** | 12V (−) + strip GND |

⚠️ **Never** put 12V on ESP32 pins. Tie all grounds together. Power the board via USB-C (UART port) or **5V** (J1).

### 🎛️ Physical buttons

| Button | Short press | Long press (~700 ms) |
|---|---|---|
| **1** (game type) | Cycle game type (when allowed) | Reset active game |
| **2** (draw / winner) | Draw next (**automatic** style only) | Winner / keep-going — **or**, on a fresh **manual** game with **zero** calls: switch to **automatic** and draw the first number *(does not turn on UI auto-call Play)* |

Any button exits LED test / screensaver.

---

## 🏗️ Architecture

```text
┌────────────────────┐   WiFi AP "BINGO"    ┌──────────────────────┐
│  ESP32 firmware    │ ◄──────────────────► │  Browser (React SPA) │
│  FastLED → 105 LEDs│   REST + WebSocket   │  Board / Card / OCR  │
│  SPIFFS → UI+MP3s  │   Push snapshots     │  Served from /data   │
└────────────────────┘                      └──────────────────────┘
```

- **Firmware:** `src/main.cpp` — game engine, LEDs, auth, cards, WiFi, NVS
- **Frontend:** `frontend/` — Vite + React + TypeScript + Tailwind + shadcn/ui
- **SPIFFS:** custom partition (~6 MB) for UI + multi-voice caller MP3s — `partitions/bingo.csv` (sized to content so `uploadfs` is faster)
- **Dev mock:** if the board is unreachable, the UI falls back to an in-memory mock API

---

## 🎯 Game features

### Calling
- **Automatic** — Draw next / header Play timer / Button 2 short press
- **Manual** — Tap numbers on the board; Button 2 long-press can convert a blank manual game to automatic + first draw
- **Undo** last call
- **Power-loss recovery** — call order / current / pool restore from NVS
- Default auto-call interval: **10 seconds** (configurable; Play stays UI-driven)

### Game styles & types

**Game style** is **BINGO** (default) or **HOUSEY**.

**BINGO — 42 types** in six categories (Classics, Letters & Symbols, Shapes & Frames, Blocks & Arrows, Pictures, Combos & Rules). The board/new-game UI uses a **searchable, filterable picker** with mini pattern previews. Physical **Button 1** cycles every type in catalog order within the current style when changing type is allowed.

Canonical BINGO definitions live in `scripts/generate-game-types.mjs` (generates frontend + firmware tables). Multi-orientation types cycle display patterns on the LED matrix (synced to the UI). **Double Bingo** wins on any two Traditional lines; **Blackout Lite** wins at any 20 covered cells.

**HOUSEY — 5×5 sparse cards** (same B-I-N-G-O column ranges / 1–75 pool, **not** UK 9×3 tickets): 10–12 numbers, no FREE cell. Types:

| Type | Rule |
|---|---|
| Battleship | Last card still afloat; a card sinks when all its numbers are called (same-call co-survivors share) |
| Four Corners | Populated corners `{B top, O top, B bottom, O bottom}`; completing call must be a corner |
| Line | Any one horizontal row (populated cells only) |
| Two Lines | Any two complete horizontal rows |
| Full House | All populated numbers called |

HOUSEY winner mode auto-alerts when a pattern is complete (same as BINGO); the real-world host adjudicates. Keep-going dismisses the prize and continues. LED indicators: Battleship loops a 1→25 chase at the standard pattern cycle speed; Four Corners lights corners; Line middle row; Two Lines two rows; Full House all 25.

### Winners
- Declare / clear winner (UI + Button 2 long-press)
- Card-driven winners + keep-going with claimed pattern masks
- Winner LED phases (board sparkle → scroll)
- Winner activation can wait while call-out audio is still playing

---

## 🔊 Caller audio

Pre-recorded voice packs on SPIFFS / `frontend/public/cv/{F1,F2,M1,M2}/` (short paths — SPIFFS max ~31 chars):

- Numbers **B-1 … O-75**
- Utility: `on`, `jokes-on`, `bingo`
- Optional jokes (e.g. `joke-B-4`, `joke-O-67`)

**Board UI:** Settings → Caller → voice + speech rate · unlock with a tap → volume / jokes · keepalive for iOS/Android · firmware **audio hold** so the next auto-draw waits for the clip (countdown still runs).

Regenerate with OpenAI TTS (requires `.env` `OPENAI_API_KEY` + ffmpeg):

```bash
CALLER_VOICE_PACKS=Male1,Male2,Female2 node scripts/generate-caller-audio-openai.mjs
```

Legacy macOS `say` generator (single pack):

```bash
./scripts/generate-caller-audio.sh
```

---

## 🃏 Card mode & printable cards

- Full **5×5** card with FREE center; re-roll / auto-sync
- Join the live board session (no seed)
- Joined cards: only called numbers markable; winner flash + confetti
- Settings → **Cards**:
  - Download signed **PDF** (4 cards / page; FREE cell = QR)
  - Copy shareable claim links
- QR / link joins via `POST /card/claim` with HMAC over the board’s stable **device id**
- Scanning while already unlocked as Board can **verify** authenticity without switching modes

---

## 🔐 Board access

- Default PIN: **`1975`** (change in Settings → Access)
- Session token TTL: **7 days**, persisted in NVS (survives reboot)
- **5** failed unlocks → **30 s** lockout (`429`)
- Mutating board APIs require `X-Board-Token`
- Public paths: unlock, card join/mark/leave/claim/state sync
- Expired auth prompts unlock **in place** (no forced Card-mode switch)

---

## 💡 LED features

| Feature | Notes |
|---|---|
| Layout | CSV-mapped; letters → numbers → game-type matrix |
| Themes | 19 (static + animated) |
| Color modes | Theme / solid / custom letter colors |
| Header color | Dedicated BINGO letter LEDs |
| Game-type color | Dedicated 5×5 matrix |
| Vibrance | `0–100` boost for strip punch |
| Current beacon | Color + **flash / pulse / strobe** |
| Letter-full mode | When a column is complete: on / off / number theme |
| Called-number banner | Optional ~3 s letter+digits glyph across the board |
| Screensavers | 13 types on the full **21×5** matrix |
| LED test | Sequenced strip test from Settings |

---

## 🖥️ Web UI highlights

- Mode chooser: **Board** vs **Card**
- Odds drawer (Monte Carlo win estimates)
- Per-mode light/dark themes (`bingo-theme-board` / `bingo-theme-card`; card defaults dark)
- Settings tabs: **LEDs · Screensaver · UI · Caller · Cards · WiFi · Access**
- Optional **STA WiFi** join (home network) alongside / instead of AP-only use
- Fullscreen, theme toggle, live player/card counts
- UI-only BINGO color themes (do **not** change strip colors)

---

## 📡 Networking

| | |
|---|---|
| AP SSID | `BINGO` |
| AP password | `washisnameo` |
| AP IP | `192.168.4.1` |
| mDNS | `bingo.local` |
| Config | `include/config.h` |

Realtime: WebSocket `/ws` (subscribe as `board` / `card` / `none`) + HTTP polling fallback.

---

## 🛠️ Build & deploy

**Needs:** Node.js, npm, [PlatformIO](https://platformio.org/), Python 3 (for `make qa`)

### One-command deploy

```bash
make deploy
# or pin the serial port (S3 boards often use usbmodem):
make deploy PIO_PORT=/dev/cu.usbmodem101
```

### Pieces

```bash
make frontend-build   # Vite → data/ (prunes stale hashed assets; keeps MP3s)
make fw-upload        # firmware (esp32s3 + partitions/bingo.csv)
make fs-upload        # SPIFFS
make monitor          # serial @ 115200
make qa               # smoke tests → QA_BASE / QA_PIN
```

SPIFFS size guidance: UI + voice packs should fit in **~6 MiB**. `uploadfs` writes the **entire** SPIFFS partition image (empty space included), so keep the map tight. After changing `partitions/bingo.csv`, erase flash once before upload. Build prints prune size via `scripts/prune-spiffs-data.mjs`.

### Local UI (no hardware)

```bash
cd frontend && npm install && npm run dev
```

Mock backend activates automatically if the ESP32 doesn’t answer within ~2 s. Force mock with `VITE_MOCK=true`.

### Shared multi-tab mock (optional)

See `frontend/dev/shared-mock-server.mjs` for multi-browser mock sessions during development.

---

## 🧪 QA smoke tests

```bash
make qa
make qa QA_BASE=http://192.168.4.1 QA_PIN=1975
```

`scripts/qa-board.py` exercises unlock/lockout, game actions, screensaver quirks, LED test vs screensaver, auth headers, and more.

---

## 📁 Repo map

```text
bingo-flashboard/
├── src/main.cpp              # Firmware (game + LEDs + API + WS)
├── include/config.h          # Pins, AP, PIN, NVS keys
├── include/led_map.h         # Physical LED index maps
├── partitions/bingo.csv      # Larger SPIFFS layout
├── WIRING.md                 # ESP32-S3 wiring + pinout
├── docs/                     # Hardware reference (optional diagrams)
├── data/                     # SPIFFS payload (built UI + MP3s)
├── frontend/                 # React app source
│   └── public/cv/{F1,F2,M1,M2}/  # Voice packs (short SPIFFS paths)
├── scripts/
│   ├── generate-caller-audio-openai.mjs
│   ├── generate-caller-audio.sh
│   ├── prune-spiffs-data.mjs
│   └── qa-board.py
├── Makefile                  # deploy helpers
└── platformio.ini
```

---

## 🔑 Persistence cheatsheet

**NVS (device):** brightness, vibrance, themes/colors, screensaver, auto-call seconds, game style, game type, calling style, board PIN, device id, board token, letter-full / beacon / banner flags, WiFi STA creds, live game snapshot.

**Browser:** UI themes (per mode), UI letter colors, auto-call seconds UI, board token/expiry, card id + card state, caller speech/jokes/rate prefs.

---

## 📝 License / notes

Personal / venue bingo hardware project. WiFi credentials and default PIN are intended for a local party AP — change them before leaving the device on an open floor.

Happy daubing. 🎉
