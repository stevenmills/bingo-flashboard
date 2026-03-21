#ifndef CONFIG_H
#define CONFIG_H

#define DATA_PIN      4
#define BUTTON_PIN    0
#define NUM_LEDS      105
#define LED_COLOR_ORDER RGB
#define STATUS_LED_ENABLED 1
#define STATUS_LED_PIN 48
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
#define NVS_LED_COLOR_B "lb"
#define NVS_LED_COLOR_I "li"
#define NVS_LED_COLOR_N "ln"
#define NVS_LED_COLOR_G "lg"
#define NVS_LED_COLOR_O "lo"
#define NVS_GAME_TYPE "gt"
#define NVS_CALLING_STYLE "cs"
#define NVS_BOARD_PIN "bp"
#define NVS_GAME_STATE "gs"

#endif
