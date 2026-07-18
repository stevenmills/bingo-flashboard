# ESP32-S3 N16R8 Wiring

This project targets a **44-pin ESP32-S3-WROOM-1 N16R8** development board in the **ESP32-S3-DevKitC-1** layout ([reference board](https://www.amazon.com/dp/B0F5QCK6X5)): dual USB-C, **16 MB** flash, **8 MB** PSRAM.

| Spec | Value |
|---|---|
| Module | ESP32-S3-WROOM-1 **N16R8** |
| Flash | 16 MB (octal) |
| PSRAM | 8 MB (octal) |
| USB | Dual USB-C (UART/JTAG + USB OTG) |
| Header | **44 pins** — 22 per side (J1 left, J3 right) |

Pin assignments for the bingo flashboard are in `include/config.h`.

> **Use the numeric GPIO labels printed on your board** (e.g. `4`, `16`, `17`, `2`). This layout follows the Espressif DevKitC-1 header map — it is **not** the same as classic 30-pin ESP32 or 38-pin ESP32 DevKit boards. Official pin tables: [ESP32-S3-DevKitC-1 user guide](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/index.html).

## Power

| Connection | Silkscreen | Header | Notes |
|---|---|---|---|
| **USB-C (UART)** | — | Edge | Primary power + `pio upload` / serial monitor |
| **USB-C (OTG)** | — | Edge | Native USB — leave unconnected unless you use USB device mode |
| **Common GND** | `G` | J1 pin 22 or J3 pins 1/21/22 | Tie to 12V (−) and strip GND |
| **3V3 out** | `3V3` | J1 pins 1–2 | 3.3V regulated output — not for the strip |
| **5V in** | `5V` | J1 pin 21 | 5V input when not using USB |
| **12V (+)** | — | — | **Never** connect to ESP32 header pins |

## Bingo connections (use silkscreen GPIO numbers)

| Function | GPIO | **Silkscreen** | Header | Connect to |
|---|---|---|---|---|
| **LED data** | **4** | **`4`** | J1 | WS2811 strip **DIN** |
| **Button 1** | **16** | **`16`** | J1 | Momentary switch → **GND** |
| **Button 2** | **17** | **`17`** | J1 | Momentary switch → **GND** |
| **Status LED** | **2** | **`2`** | J3 | Header GPIO (see note below) |
| **Ground** | — | **`G`** | J1 or J3 | 12V (−) + strip GND |

Firmware uses **internal pull-ups** on the buttons.

**Status LED note:** Firmware blinks **GPIO 2** on the **`2`** header pin (J3). Most N16R8 DevKitC-1 boards also have an **addressable RGB LED** on **GPIO48** (older v1.0) or **GPIO38** (v1.1) — that RGB LED is **not** driven by the stock firmware.

### Button actions (firmware)

| Button | Silkscreen | GPIO | Short press | Long press |
|---|---|---|---|---|
| **Button 1** | `16` | 16 | Cycle game type (pre-game / during winner) | Reset game (during active game) |
| **Button 2** | `17` | 17 | Draw next number (automatic mode only) | Winner / keep-going flow |

## WS2811 strip (105 LEDs, 12V)

```
12V supply (+)  ──────────────────────►  Strip +12V / VCC
12V supply (−)  ──┬──────────────────►  Strip GND
                  │
ESP32 GND (J1/J3) ┘
ESP32 GPIO 4      ──────────────────────►  Strip DIN   (silkscreen 4, J1)
```

- **105 LEDs** total (80 flashboard + 25 game-type matrix).
- Color order: **RGB** (WS2811), set by `LED_COLOR_ORDER` in `include/config.h`.
- Strip output: **FastLED 3.7.8** (RMT4) on GPIO 4. Build disables the core’s builtin RGB RMT claim so the strip can use it.
- **12V must power the strip** (USB only powers the ESP32). Common GND is required; DIN alone will not light anything.

## Pin diagram (DevKitC-1 layout, USB at bottom)

Read **top → bottom** on each side. Silkscreen shows the **GPIO number** (not `D4` / `RX2` style labels).

```
                    ┌─────────────────────┐
              3V3  ─┤                     ├─ G
              3V3  ─┤                     ├─ TX    ◄── GPIO 43 — USB UART, avoid
              RST  ─┤                     ├─ RX    ◄── GPIO 44 — USB UART, avoid
                4  ─┤                     ├─ 1
                5  ─┤                     ├─ 2     ◄── STATUS (GPIO 2) — header only
                6  ─┤                     ├─ 42
                7  ─┤   ESP32-S3-WROOM-1  ├─ 41
               15  ─┤                     ├─ 40
               16  ─┤                     ├─ 39
               17  ─┤                     ├─ 38    ◄── onboard RGB (v1.1 boards)
               18  ─┤                     ├─ 37    ◄── octal flash/PSRAM — do not use
                8  ─┤                     ├─ 36    ◄── octal flash/PSRAM — do not use
                3  ─┤                     ├─ 35    ◄── octal flash/PSRAM — do not use
               46  ─┤                     ├─ 0     ◄── BOOT strapping
                9  ─┤                     ├─ 45    ◄── strapping
               10  ─┤                     ├─ 48    ◄── onboard RGB (v1.0 boards)
               11  ─┤                     ├─ 47
               12  ─┤                     ├─ 21
               13  ─┤                     ├─ 20    ◄── USB D+ — avoid
               14  ─┤                     ├─ 19    ◄── USB D− — avoid
               5V  ─┤                     ├─ G
                G  ─┤                     ├─ G
                    └─────────────────────┘
              [BOOT] [USB-C UART] [USB-C OTG] [RST]
```

Left header = **J1** (pins listed on the left above). Right header = **J3**.

### Quick wiring cheat sheet

```
J1: G (pin 22) or J3: G     ──────► 12V supply (−) and strip GND
J1: 4 (GPIO 4)              ──────► strip DIN
J1: 16 (GPIO 16)            ──────► Button 1 ──► GND
J1: 17 (GPIO 17)            ──────► Button 2 ──► GND
J3: 2 (GPIO 2)              ────── optional external status LED (firmware default)
```

All four bingo signals use **J1** for data + buttons; status uses **J3** pin `2`.

## Pins to avoid

| Silkscreen | GPIO | Reason |
|---|---|---|
| `TX` / `RX` | 43, 44 | USB-UART bridge (flashing / monitor) |
| `0` | 0 | Boot strapping — use onboard **BOOT** button to flash |
| `3` | 3 | Strapping |
| `45`, `46` | 45, 46 | Strapping |
| `35`–`37` | 35–37 | Octal flash/PSRAM bus on **N16R8** — not for external wiring |
| `48` or `38` | 48 / 38 | Onboard addressable RGB LED (revision-dependent) |
| `19`, `20` | 19, 20 | Native USB D− / D+ |

## Onboard controls & LEDs

| Item | Notes |
|---|---|
| **USB-C (UART)** | Power + `pio run -t upload` / serial monitor |
| **USB-C (OTG)** | Native USB device port — not needed for this project |
| **RST button** | Hardware reset |
| **BOOT button** | Hold **BOOT**, tap **RST** (or hold BOOT while plugging in) to enter download mode |
| **RGB LED** | Addressable LED on GPIO48 (v1.0) or GPIO38 (v1.1) — not used by stock firmware |
| **GPIO 2 header** | Simple digital status blink in firmware (`STATUS_LED_*` in `config.h`) |

If the status LED polarity seems inverted, set `STATUS_LED_ACTIVE_LOW` to `1` in `include/config.h`.

## PlatformIO target

```ini
board = esp32-s3-devkitc-1   ; 44-pin DevKitC-1 layout, N16R8 (16 MB flash + 8 MB PSRAM)
```

```bash
pio run -e esp32s3 --target upload
pio run -e esp32s3 --target uploadfs
```

On macOS the UART port is often `/dev/cu.usbmodem*` (not `usbserial-*`).

## Not this board?

Classic **ESP32** (30-pin WROOM-32) and **ESP32-S3** DevKit boards share **GPIO numbers** for this project (4, 16, 17, 2) but **header positions and silkscreen labels differ**. Always wire by the label printed next to the pin on **your** board.
