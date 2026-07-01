# Bingo Flashboard

ESP32-WROOM-32D-driven **105-LED 12V WS2811** bingo flashboard with a WiFi AP and a modern React web UI.

The device hosts the UI from SPIFFS, and players control games from a phone/tablet/laptop connected to the `BINGO` network.

## Recent updates

- LED mapping now follows a CSV-defined physical layout in `include/led_map.h` (non-contiguous logical regions are supported).
- Current called number LED now uses a high-contrast white flash/beacon behavior while it is current.
- BINGO header LEDs now use a dedicated hardware color (default red), independent of active number theme.
- Game-type indicator LEDs now use a dedicated configurable hardware color (default warm white `#FFD8A8`).
- Added LED vibrance control (`0..100`) to prioritize physical strip visibility.
- Start game flow now issues a backend reset before transitioning, to keep UI/LED state synchronized.

## Hardware

- **ESP32-WROOM-32D** (DevKit-compatible)
- **WS2811** strip, 105 LEDs, 12V supply, single data line
- **Momentary button** between GPIO and GND (internal pull-up) for automatic draws
- **Status LED** on GPIO 2 cycles rainbow when firmware is running

Core hardware/network config is in `include/config.h`:
- `DATA_PIN`
- `BUTTON1_PIN`
- `BUTTON2_PIN`
- `NUM_LEDS` (`105`)
- `AP_SSID` (`BINGO`)
- `AP_PASSWORD` (`washisnameo`)

## Architecture

- **Firmware** (`src/main.cpp`)
  - FastLED rendering for board + game-type indicator LEDs
  - REST API + websocket state/event push via ESPAsyncWebServer
  - NVS persistence for LED/game preferences plus live game snapshot restore
- **Frontend** (`frontend/`)
  - React + TypeScript + Tailwind + shadcn/ui
  - WebSocket-first state/event updates (`/ws`) with HTTP polling fallback
  - Auto mock fallback when ESP32 is unreachable

## Key features

### Game flow
- Automatic or manual calling style
- Game types: Traditional, Four Corners, Postage Stamp, Cover All, Letter X, Letter Y, Frame Outside, Frame Inside, Plus Sign, Field Goal
- Winner flow + out-of-numbers modal
- **Undo** support (`/undo`) for last called number
- **Power-loss recovery**: called numbers/current game resume after reboot
- Draw selection uses ESP32 hardware RNG with unbiased index selection

### LED behavior
- 80 LED board (letters + numbers) + 25 LED game-type matrix
- 19 LED themes (static + animated)
- Static solid color option
- Winner sparkle mode
- Dedicated BINGO header LED color setting (lights only when that column has calls; includes short preview on color change)
- Dedicated game-type indicator LED color setting
- LED vibrance boost control for custom/static/header/game-type colors

### Web UI
- Responsive board + game-type indicator layout
- First-load mode chooser: `Board` or `Card`
- Header controls:
  - Exit-to-mode-selection button (with confirmation modal)
  - Settings toggle
  - Odds drawer toggle (dice icon)
  - Theme toggle
  - Fullscreen toggle (with broad browser API fallback support)
  - API status dot tooltip
  - Automatic-mode play/pause timer controls (seconds + countdown loader)
- Board mode bottom status bar: live player count + card count
- Board mode bottom status bar shows live player and card counts
- Current number shown as a bingo-ball style display
- Odds drawer includes Monte Carlo game-win estimates with tunable assumptions:
  - Opponents (default `20`)
  - Cards per opponent (default `1`)
  - Trials (default `5000`)
- In card mode:
  - If card is joined, odds game type is locked to board game type
  - If card is not joined, odds drawer allows choosing game type

### Card mode
- Full-width 5x5 bingo card with FREE center
- Card values are randomized by column ranges (B/I/N/G/O) and preserved on refresh
- Re-roll and auto-sync are icon-only controls with tooltips
- Card mode joins the available board session directly (no seed entry required)
- Manual marking rules:
  - Unjoined card: arbitrary non-FREE marking allowed
  - Joined card: only called numbers are clickable
- Joined winning card shows winner flashing + confetti on that card view only
- Subsequent bingos in the same round are supported; flashing prioritizes newly identified winning patterns
- Board winner state is driven only by joined card sessions (unjoined cards are isolated)

### Board security
- Board mode is PIN-protected with timed session expiry
- Board controls require a valid board token
- Board PIN has firmware default and can be changed in Board settings
- Auth loss/expiry in board mode prompts unlock in place (no forced mode switch)
- Card mode settings only show `BINGO UI Colors`

### UI-only color customization (does **not** affect LEDs)
- B/I/N/G/O web UI color themes:
  - Default, Rainbow, Warm Sunset, Cool Blue, High Contrast, Custom
- Custom per-letter colors (applied only when theme is `Custom`)
- Action button colors are derived from letter colors:
  - Draw next uses `N`
  - Winner uses `G`

## API endpoints (high level)

- `GET /api/state`
- `POST /draw`
- `POST /call`
- `POST /undo`
- `POST /reset`
- `POST /calling-style`
- `POST /game-type`
- `POST /declare-winner`
- `POST /clear-winner`
- `POST /brightness`
- `POST /theme`
- `POST /color`
- `POST /vibrance`
- `POST /letter-colors`
- `POST /letter-header-color`
- `POST /game-type-color`
- `POST /led-test`
- `POST /auth/board/unlock`
- `POST /auth/board/lock`
- `POST /auth/board/refresh`
- `POST /board/pin`
- `POST /card/join`
- `POST /card/mark`
- `POST /card/leave`
- `GET /api/card-state`
- `GET /ws` (websocket upgrade endpoint for realtime state + card events)

### WebSocket subscription scope

- Frontend clients send a `/ws` subscription envelope (`type: "subscribe"`) with mode:
  - `board` for Board mode clients
  - `card` with `cardId` for joined Card mode clients
  - `none` when card is not joined
- Backend pushes board snapshots/winner state only to:
  - Board subscribers
  - Card subscribers whose `cardId` is currently joined
- `card_state` events are pushed only to the matching joined card (plus board subscribers)

See `AGENTS.md` for full endpoint behavior and payload details.

## Persistence

### ESP32 NVS
Persists LED/game preferences such as brightness, vibrance, theme, color mode, static color, header color, game-type indicator color, custom B/I/N/G/O colors, game type, and calling style.

Also persists a runtime game snapshot (`NVS_GAME_STATE`):
- call order
- current number
- remaining pool
- game-established flag
- board seed

### Browser localStorage
- `bingo-theme` (light/dark mode)
- `bingo-gameType` (mock API)
- `bingo-callingStyle` (mock API)
- `bingo-brightness` (mock API brightness mirror)
- `bingo-led-vibrance` (mock API vibrance mirror)
- `bingo-ui-colors` (UI-only BINGO letter theme/colors)
- `bingo-auto-seconds` (automatic-calling interval)
- `bingo-board-token` (board auth token)
- `bingo-board-token-expiry` (board token expiry)
- `bingo-card-id` (joined card session id)
- `bingo-card-state` (persisted local card values/marks)

### Browser sessionStorage
- `bingo-app-mode` (last selected view mode for current tab/session)

Odds drawer Monte Carlo settings are currently session-local (not persisted to localStorage).

## Build & deploy

### Frontend build
```bash
cd frontend
npm install
npm run build   # outputs to ../data/
```

### Firmware build/upload
Requires [PlatformIO](https://platformio.org/):

```bash
pio run -e esp32dev
pio run -e esp32dev --target upload
pio run -e esp32dev --target uploadfs
```

### One-command workflow (recommended)
From repo root, use the included `Makefile` shortcuts:

```bash
make deploy      # build frontend + upload firmware + upload SPIFFS
make fw-upload   # firmware only
make fs-upload   # SPIFFS only
make monitor     # serial monitor
```

Optional port/env overrides:

```bash
make deploy PIO_PORT=/dev/cu.usbserial-0001
make fw-upload PIO_ENV=esp32dev PIO_PORT=/dev/cu.usbserial-0001
```

### Device usage
1. Power ESP32
2. Connect to WiFi `BINGO` (password `washisnameo`)
3. Open `http://bingo.local` (fallback: `http://192.168.4.1`)

## Local development

```bash
cd frontend
npm run dev
```

- Vite proxies API calls to `192.168.4.1`
- If ESP32 is unavailable, frontend auto-falls back to the in-memory mock API after timeout

## Repo layout

```text
src/main.cpp                Firmware (ESP32)
include/config.h            Pins, AP credentials, NVS keys
include/led_map.h           Physical LED mapping
platformio.ini              PlatformIO project config
data/                       Frontend build output served by SPIFFS
frontend/                   React + TypeScript app source
frontend/src/lib/odds.ts    Monte Carlo odds engine for Odds drawer
```
