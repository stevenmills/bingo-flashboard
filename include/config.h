#ifndef CONFIG_H
#define CONFIG_H

// Target board: ESP32-S3-WROOM-1 N16R8 (44-pin DevKitC-1 layout). Wiring: WIRING.md
// Silkscreen: 4=GPIO4, 16=GPIO16, 18=GPIO18 (17 dead/unwired on some screw-terminal carriers), 2=GPIO2 (J3).

#define DATA_PIN      4   // Silkscreen 4 (J1) → WS2811 DIN
#define BUTTON1_PIN   16  // Silkscreen 16 (J1) → game type / reset
#define BUTTON2_PIN   18  // Silkscreen 18 (J1) → draw / winner (use 18; silkscreen 17 often open on these carriers)
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
#define NVS_UI_COLOR_THEME "ut"
#define NVS_UI_COLOR_B "ucb"
#define NVS_UI_COLOR_I "uci"
#define NVS_UI_COLOR_N "ucn"
#define NVS_UI_COLOR_G "ucg"
#define NVS_UI_COLOR_O "uco"
#define NVS_GAME_TYPE "gt"
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
#define NVS_WEBHOOK_URL "wnu"
#define NVS_WEBHOOK_BINGO_URL "wbu"  // legacy; migrated into wnu + flags
#define NVS_WEBHOOK_FLAGS "wf"
#define NVS_WEBHOOK_USER "whu"
#define NVS_WEBHOOK_PASSWORD "whp"
#define NVS_MQTT_ENABLED "me"
#define NVS_MQTT_HOST "mh"
#define NVS_MQTT_PORT "mp"
#define NVS_MQTT_USER "mu"
#define NVS_MQTT_PASSWORD "mw"
#define NVS_MQTT_TOPIC "mt"
#define NVS_MQTT_TLS "mtt"
#define NVS_MQTT_FLAGS "mf"
#define NVS_WIFI_SSID "ws"
#define NVS_WIFI_PASSWORD "wp"
#define NVS_GIF_MODE_ENABLED "gme"
#define NVS_NUMBER_GIF_MAP "ngm"
#define NVS_CRASH_LOG "cl"
#define NVS_LAST_RESET_REASON "lrr"

#define WIFI_STA_CONNECT_TIMEOUT_MS 15000UL
#define WIFI_SSID_MAX_LEN 32
#define WIFI_PASSWORD_MAX_LEN 64
#define WEBHOOK_URL_MAX_LEN 256
#define WEBHOOK_USER_MAX_LEN 32
#define WEBHOOK_PASSWORD_MAX_LEN 64
#define MQTT_HOST_MAX_LEN 64
#define MQTT_USER_MAX_LEN 32
#define MQTT_PASSWORD_MAX_LEN 64
#define MQTT_TOPIC_MAX_LEN 96
#define MQTT_DEFAULT_PORT 1883

/** Shared outbound event bitflags (webhooks + MQTT). */
#define OUT_FLAG_NUMBER_CALLED         (1u << 0)
#define OUT_FLAG_NUMBER_UNDONE         (1u << 1)
#define OUT_FLAG_WINNER_DECLARED       (1u << 2)
#define OUT_FLAG_WINNER_CLEARED        (1u << 3)
#define OUT_FLAG_GAME_STARTED          (1u << 4)
#define OUT_FLAG_GAME_TYPE_CHANGED     (1u << 5)
#define OUT_FLAG_CALLING_STYLE_CHANGED (1u << 6)
#define OUT_FLAG_DEFAULT (OUT_FLAG_NUMBER_CALLED | OUT_FLAG_WINNER_DECLARED)

/** Per-number GIF URL cap (CDN links are often long). */
#define GIF_URL_MAX_LEN 256
/** Sparse JSON map blob max size in NVS. */
#define GIF_MAP_BLOB_MAX 6144

#endif
