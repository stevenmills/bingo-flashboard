#ifndef CONFIG_H
#define CONFIG_H

// Target board: ESP32-S3-WROOM-1 N16R8 (44-pin DevKitC-1 layout). Wiring: WIRING.md
// Silkscreen: 4=GPIO4, 16=GPIO16, 17=GPIO17, 2=GPIO2 (J3 header — not onboard RGB).

#define DATA_PIN      4   // Silkscreen 4 (J1) → WS2811 DIN
#define BUTTON1_PIN   16  // Silkscreen 16 (J1) → game type / reset
#define BUTTON2_PIN   17  // Silkscreen 17 (J1) → draw / winner
#define NUM_LEDS      105
#define LED_COLOR_ORDER RGB
#define STATUS_LED_ENABLED 1
#define STATUS_LED_PIN 2
// 0 = HIGH turns LED on. 1 = LOW turns LED on (inverted external LED wiring).
#define STATUS_LED_ACTIVE_LOW 0
// Two quick blips (HIGH then LOW drive) at boot — helps if polarity/board wiring differs.
#define STATUS_LED_BOOT_PROBE 1

#define AP_SSID       "BINGO"
#define AP_PASSWORD   "washisnameo"
#define BOARD_DEFAULT_PIN "1975"
// Long-lived board session (7 days). Token is also persisted in NVS so it survives reboot.
#define BOARD_AUTH_TTL_MS 604800000UL
// Unlock PIN brute-force protection: N failures → lockout window.
#define BOARD_UNLOCK_MAX_FAILURES 5
#define BOARD_UNLOCK_LOCKOUT_MS 30000UL

#define NVS_NAMESPACE "bingo"
#define NVS_BRIGHTNESS "br"
#define NVS_THEME     "theme"
#define NVS_COLOR_MODE "cm"
#define NVS_STATIC_COLOR "sc"
#define NVS_LED_VIBRANCE "lv"
#define NVS_LED_HEADER_COLOR "hc"
#define NVS_GAME_TYPE_LED_COLOR "gc"
#define NVS_SCREENSAVER_ENABLED "se"
#define NVS_SCREENSAVER_TEXT "st"
#define NVS_SCREENSAVER_SPEED "ss"
#define NVS_SCREENSAVER_TYPE "sy"
#define NVS_SCREENSAVER_COLOR "sr"
#define NVS_AUTO_CALL_SECONDS "ac"
#define NVS_LED_COLOR_B "lb"
#define NVS_LED_COLOR_I "li"
#define NVS_LED_COLOR_N "ln"
#define NVS_LED_COLOR_G "lg"
#define NVS_LED_COLOR_O "lo"
#define NVS_GAME_TYPE "gt"
#define NVS_GAME_STYLE "gst"
#define NVS_CALLING_STYLE "cs"
#define NVS_BOARD_PIN "bp"
#define NVS_DEVICE_ID "di"
#define NVS_BOARD_TOKEN "bt"
#define NVS_BOARD_TOKEN_REMAINING "brm"
#define NVS_GAME_STATE "gs"
#define NVS_LETTER_FULL_MODE "lfm"
#define NVS_CURRENT_NUM_EFFECT "cne"
#define NVS_CURRENT_NUM_COLOR "cnc"
#define NVS_CALLED_NUM_BANNER "cnb"
#define NVS_WINNER_EFFECT "we"
#define NVS_WEBHOOK_NUMBER_URL "wnu"
#define NVS_WEBHOOK_BINGO_URL "wbu"
#define NVS_WIFI_SSID "ws"
#define NVS_WIFI_PASSWORD "wp"

#define WIFI_STA_CONNECT_TIMEOUT_MS 15000UL
#define WIFI_SSID_MAX_LEN 32
#define WIFI_PASSWORD_MAX_LEN 64
#define WEBHOOK_URL_MAX_LEN 256

#endif
