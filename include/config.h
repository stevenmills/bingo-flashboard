#ifndef CONFIG_H
#define CONFIG_H

#define DATA_PIN      4
#define BUTTON1_PIN   16
#define BUTTON2_PIN   17
#define NUM_LEDS      105
#define LED_COLOR_ORDER RGB
#define STATUS_LED_ENABLED 1
#define STATUS_LED_PIN 2
#define STATUS_LED_COUNT 1
#define STATUS_LED_COLOR_ORDER GRB

#define AP_SSID       "BINGO"
#define AP_PASSWORD   "washisnameo"
#define BOARD_DEFAULT_PIN "1975"
#define CARD_JOIN_PIN "BINGO"
#define BOARD_AUTH_TTL_MS 1800000UL

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
#define NVS_CALLING_STYLE "cs"
#define NVS_BOARD_PIN "bp"
#define NVS_GAME_STATE "gs"
#define NVS_LED_BOARD_ORDER "lo"
#define NVS_WIFI_SSID "ws"
#define NVS_WIFI_PASSWORD "wp"

#define WIFI_STA_CONNECT_TIMEOUT_MS 15000UL
#define WIFI_SSID_MAX_LEN 32
#define WIFI_PASSWORD_MAX_LEN 64

#endif
