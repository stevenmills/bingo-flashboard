# Bingo Flashboard

ESP32-driven **105-LED 12 V WS2811** bingo flashboard with WiFi AP and web UI. Plan: `.cursor/plans/arduino_bingo_led_board_179bac68.plan.md`.

## Hardware

- **ESP32** (e.g. DevKit C)
- **WS2811** strip, 105 LEDs, 12 V supply, single data line
- **Button**: momentary, between GPIO and GND (internal pull-up)

Configure in `include/config.h`: `DATA_PIN`, `BUTTON_PIN`, `NUM_LEDS` (105), `AP_SSID` ("BINGO"), `AP_PASSWORD` ("washisnameo").

## Build and upload

Requires [PlatformIO](https://platformio.org/).

```bash
# Install dependencies and build
pio run

# Upload firmware
pio run --target upload

# Upload filesystem (data/index.html, data/tailwind.css) to SPIFFS
pio run --target uploadfs
```

Then connect to WiFi **BINGO** (password: washisnameo) and open **http://192.168.4.1**.

## Project layout

- `src/main.cpp` – sketch (FastLED, state, API, button, NVS)
- `include/config.h` – pins and AP credentials
- `include/led_map.h` – logical number/letter/game-type → physical strip index
- `data/index.html` – web UI
- `data/tailwind.css` – minimal utility CSS (no CDN, works offline)

## Features

- **80 LEDs** flashboard (letters B,I,N,G,O + numbers 1–75 in custom physical order) + **25 LEDs** game-type 5×5 matrix
- **Calling**: automatic (button + Draw next) or manual (letter + number in UI)
- **Game types**: Traditional, Four corners, Postage stamp, Cover all (persisted in NVS)
- **Winner**: Declare winner → gold sparkle; then Keep going (clear winner, optional change game type) or Reset
- **Settings**: brightness, theme, static color (NVS)
- **UI**: responsive, horizontal board preview, verify column, reset/winner confirmations
