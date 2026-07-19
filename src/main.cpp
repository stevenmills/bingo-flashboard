/**
 * Bingo Flashboard – ESP32-S3 N16R8 + 105-LED WS2811 + WiFi AP
 * Plan: arduino_bingo_led_board_179bac68.plan.md
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include <SPIFFS.h>
#include <nvs.h>
#include <nvs_flash.h>
#include <ctype.h>
#include <string.h>
#include "mbedtls/md.h"
#include "driver/gpio.h"
#include "config.h"
#include "led_map.h"
#include "game_types.generated.h"

// --- LED strip ---
CRGB leds[NUM_LEDS];
uint8_t brightness = 255;
const uint8_t DEFAULT_BRIGHTNESS = 255;
uint8_t ledVibrance = 75;  // 0..100
const uint8_t DEFAULT_LED_VIBRANCE = 75;
bool screensaverEnabled = false;
// Screensaver types:
// 0=text, 1=rainbow, 2=solid, 3=fire_matrix, 4=pacifica, 5=pride,
// 6=twinkle_fox, 7=cylon, 8=noise_palette, 9=sinelon, 10=juggle,
// 11=confetti, 12=fire2012, 13=sparkle (gold winner shimmer)
uint8_t screensaverType = 1;  // rainbow
uint8_t winnerEffectType = 13;  // sparkle
char screensaverText[81] = "BINGO";
uint32_t screensaverColor = 0x4E7A27;
uint16_t screensaverSpeedMs = 230;
unsigned long screensaverLastStepMs = 0;
int screensaverOffsetCols = 0;
int8_t screensaverCylonDir = 1;
uint8_t screensaverHue = 0;
CRGB screensaverBuf[NUM_LEDS];
uint8_t screensaverNoise[21][5];
uint16_t screensaverNoiseX = 0;
uint16_t screensaverNoiseY = 0;
uint16_t screensaverNoiseZ = 0;
uint8_t screensaverFireHeat[21][5];
CRGBPalette16 screensaverTwinklePal;
CRGBPalette16 screensaverTwinkleTarget;
bool screensaverTwinklePalInit = false;
enum WinnerAnimPhase : uint8_t { WINNER_PHASE_BOARD = 0, WINNER_PHASE_SCROLL = 1 };
WinnerAnimPhase winnerAnimPhase = WINNER_PHASE_BOARD;
bool winnerAnimActive = false;
unsigned long winnerPhaseStartedMs = 0;
unsigned long winnerScrollLastStepMs = 0;
int winnerScrollOffsetCols = 0;
bool winnerScrollShownThisRound = false;
const unsigned long WINNER_BOARD_PHASE_MS = 2000;
const uint16_t WINNER_SCROLL_SPEED_MS = 90;
bool autoCallingEnabled = false;
bool autoCallingHold = false;          // Pause countdown while board UI plays call-out audio
bool autoCallingWaitForAudio = false;  // Board UI has caller sound live
static bool deferResetPersistence = false;
uint16_t autoCallingSeconds = 10;
unsigned long autoCallingNextDrawMs = 0;
unsigned long autoCallingHoldSinceMs = 0;

// --- Game state ---
bool called[76];  // 1..75; [0] unused
int currentNumber = 0;       // 0 = none
bool pool[76];    // pool[i] = available for draw (1..75)
int poolCount = 75;
int callOrder[75]; // Chronological list of called numbers
int callOrderCount = 0;
static char callingStyleBuf[12] = "automatic";
const char* callingStyle = callingStyleBuf;
bool gameEstablished = false;
static char gameTypeBuf[GAME_TYPE_ID_MAX + 1] = "cover_all";
const char* gameType = gameTypeBuf;
int gameTypeIdx = 4; // cover_all in generated catalog; refreshed on load/select
int survivorCount = 0;
int eliminatedCount = 0;
unsigned long battleshipChaseStartMs = 0;
bool winnerDeclared = false;
bool manualWinnerDeclared = false;
bool winnerSuppressed = false;
bool pendingWinnerActivation = false;
bool pendingWinnerEventBump = false;
int winnerCount = 0;
uint32_t winnerEventId = 0;
uint16_t boardSeed = 1000; // 4-digit game/board join code
int themeId = 0;  // 0..n
static char colorModeBuf[8] = "theme";
const char* colorMode = colorModeBuf;
uint32_t staticColor = 0x00FF00;  // RGB for FastLED
uint32_t letterHeaderColor = 0xFFD8A8;  // Warm white — BINGO header LEDs
uint32_t gameTypeLedColor = 0xFFD8A8;  // Warm white default for game type indicator LEDs
uint32_t currentNumberColor = 0xFFFFFF;  // Current-number beacon color
bool calledNumberBannerEnabled = false;
int calledNumberBannerNumber = 0;
unsigned long calledNumberBannerUntilMs = 0;
static char letterFullModeBuf[16] = "on";  // on | off | number_theme
const char* letterFullMode = letterFullModeBuf;
static char currentNumberEffectBuf[12] = "flash";  // flash | pulse | strobe
const char* currentNumberEffect = currentNumberEffectBuf;
unsigned long letterHeaderPreviewUntilMs = 0;
// Custom hardware LED colors for B/I/N/G/O.
uint32_t customLetterColors[5] = {
  0x3B82F6, // B
  0xEF4444, // I
  0x10B981, // N
  0xF59E0B, // G
  0xA855F7, // O
};
static char boardPinBuf[12] = BOARD_DEFAULT_PIN;
/** Stable per-board id used as HMAC salt for printable-card authenticity. */
static char deviceIdBuf[33] = "";

// --- LED board section layout (fixed left-to-right: letters, numbers, game type) ---
// sectionStartCol is indexed by section id: [GAME_TYPE, LETTERS, NUMBERS].
uint8_t boardSectionOrder[3] = {SEC_LETTERS, SEC_NUMBERS, SEC_GAME_TYPE};
int sectionStartCol[3] = {16, 0, 1};

// --- WiFi STA credentials ---
static char staSsidBuf[WIFI_SSID_MAX_LEN + 1] = "";
static char staPasswordBuf[WIFI_PASSWORD_MAX_LEN + 1] = "";
bool wifiStaConnected = false;
static bool pendingBoardRestart = false;
static unsigned long pendingBoardRestartAtMs = 0;

/** Enable AP+STA when on the softAP so scanNetworks() can run without dropping clients. */
static void ensureWifiScanRadio() {
  if (wifiStaConnected) return;
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
}

// --- Outbound webhooks (STA only) ---
static char webhookNumberUrlBuf[WEBHOOK_URL_MAX_LEN + 1] = "";
static char webhookBingoUrlBuf[WEBHOOK_URL_MAX_LEN + 1] = "";
enum WebhookKind : uint8_t { WH_NONE = 0, WH_NUMBER = 1, WH_BINGO = 2 };
struct WebhookJob {
  WebhookKind kind;
  uint8_t number;
  uint8_t winnerCount;
  uint32_t winnerEventId;
};
const int WEBHOOK_QUEUE_SIZE = 6;
WebhookJob webhookQueue[WEBHOOK_QUEUE_SIZE];
uint8_t webhookQueueHead = 0;
uint8_t webhookQueueTail = 0;
uint8_t webhookQueueCount = 0;
bool webhookRequestInFlight = false;

// --- Board auth ---
static char boardAuthToken[33] = "";
unsigned long boardAuthExpiryMs = 0;
static uint8_t boardUnlockFailCount = 0;
static unsigned long boardUnlockLockoutUntilMs = 0;

// --- Shared card sessions ---
const int MAX_CARD_SESSIONS = 32;
struct CardSession {
  bool active;
  char cardId[17];
  int numbers[25];   // 0 = FREE (center) or blank; 1–75 = number
  bool marks[25];
  bool winner;
  bool eliminated;         // Battleship: sunk
  uint32_t claimedPatternMasks[GAME_TYPE_COUNT];
};
CardSession cardSessions[MAX_CARD_SESSIONS];

const int MAX_WS_SUBSCRIPTIONS = 16;
struct WsSubscription {
  bool active;
  uint32_t clientId;
  bool boardMode;
  bool boardAuthOk;
  char cardId[17];
};
WsSubscription wsSubscriptions[MAX_WS_SUBSCRIPTIONS];

// State payload can include up to 75 called numbers; keep generous JSON headroom.
const size_t STATE_JSON_DOC_CAPACITY = 4096;
const size_t STATE_WS_ENV_DOC_CAPACITY = 4608;

// --- LED board test mode ---
bool ledTestMode = false;
int ledTestPhase = 0;          // 0=letters, 1=numbers, 2=game_type, 3=all
int ledTestStepIdx = 0;
unsigned long ledTestLastStepMs = 0;
unsigned long ledTestPhaseStartedMs = 0;
const unsigned long LED_TEST_STEP_MS = 120;
const unsigned long LED_TEST_ALL_HOLD_MS = 1600;

// --- Physical buttons ---
const unsigned long DEBOUNCE_MS = 50;
const unsigned long LONG_PRESS_MS = 700;

struct ButtonState {
  uint8_t pin;
  uint8_t rawState;
  uint8_t stableState;
  unsigned long lastRawChangeMs;
  unsigned long pressStartMs;
  bool longHandled;
};

ButtonState button1 = { BUTTON1_PIN, HIGH, HIGH, 0, 0, false };
ButtonState button2 = { BUTTON2_PIN, HIGH, HIGH, 0, 0, false };

// --- Pattern cycling for game types with multiple display orientations ---
int patternIdx = 0;
unsigned long lastPatternChange = 0;
const unsigned long PATTERN_CYCLE_MS = 1500;

const GameTypeDef* currentGameTypeDef() {
  if (gameTypeIdx < 0 || gameTypeIdx >= GAME_TYPE_COUNT) {
    gameTypeIdx = findGameTypeIndex(gameType);
  }
  if (gameTypeIdx < 0) gameTypeIdx = findGameTypeIndex("cover_all");
  return gameTypeDefAt(gameTypeIdx);
}

bool isBattleshipGameType() {
  if (strcmp(gameType, "battleship") == 0) return true;
  const GameTypeDef* def = currentGameTypeDef();
  return def && def->elimination;
}

bool applyGameTypeId(const char* gt) {
  int idx = findGameTypeIndex(gt);
  if (idx < 0) return false;
  strncpy(gameTypeBuf, GAME_TYPE_TABLE[idx].id, sizeof(gameTypeBuf) - 1);
  gameTypeBuf[sizeof(gameTypeBuf) - 1] = '\0';
  gameTypeIdx = idx;
  patternIdx = 0;
  lastPatternChange = millis();
  if (GAME_TYPE_TABLE[idx].elimination || strcmp(gameTypeBuf, "battleship") == 0) {
    battleshipChaseStartMs = millis();
  } else {
    battleshipChaseStartMs = 0;
  }
  return true;
}

// --- NVS ---
nvs_handle nvs;

// Persisted runtime game state (separate from saveNvsSettings()).
const uint32_t GAME_STATE_MAGIC = 0xB1A00001;
const uint16_t GAME_STATE_VERSION = 1;
struct PersistedGameState {
  uint32_t magic;
  uint16_t version;
  uint16_t boardSeed;
  uint8_t gameEstablished;
  uint8_t callOrderCount;
  uint8_t currentNumber;
  uint8_t reserved;
  uint8_t callOrder[75];
};

// --- Server ---
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
uint32_t wsSeq = 0;

// --- Forward declarations ---
void updateAllLeds();
void loadNvs();
void saveNvsSettings();
bool saveNvsWifiCredentials();
void saveNvsGameTypeOnly();
void saveNvsCallingStyleOnly();
void saveNvsScreensaverEnabledOnly();
void setupWiFi();
void startMdns();
void saveGameStateSnapshot();
bool loadGameStateSnapshot();
void flushDeferredResetWork();
int drawNext();
void doReset();
void applyAutoCallingEnabled(bool enabled);
void applyGameTypeToMatrix();
void initLedTestSequence();
void resetLedTestSequence();
void updateLedTestMode();
bool isBoardAuthValid();
bool requireBoardAuth(AsyncWebServerRequest* req);
bool boardUnlockIsLockedOut();
void registerBoardUnlockFailure();
void clearBoardUnlockFailures();
void issueBoardAuthToken();
void ensureBoardAuthToken();
void syncWinnerDeclared();
void startCalledNumberBanner(int n);
void clearCalledNumberBanner();
bool calledNumberBannerActive();
void clearCalledNumberBannerRegion();
void renderCalledNumberBannerFrame(int n);
char bingoLetterForNumber(int n);
void recomputeCardWinners();
int letterIndex(char letter);
CRGB customLetterColorForLetter(char letter);
CRGB boostVividForStrip(CRGB rgb);
CRGB solidColorForStrip();
CRGB headerLetterColorForStrip();
CRGB gameTypeIndicatorColorForStrip();
CRGB colorForCalledNumber(int n);
CRGB colorForLetter(char letter);
CRGB goldShimmerColor(uint8_t salt);
CRGB screensaverPixelColor(int x, int y);
void resetScreensaverAnim();
void disableScreensaverForDraw();
void applyScreensaverEnabled(bool enabled);
void renderTextScreensaver();
void renderRainbowScreensaver();
void renderSolidScreensaver();
void renderFireMatrixScreensaver();
void renderPacificaScreensaver();
void renderPrideScreensaver();
void renderTwinkleFoxScreensaver();
void renderCylonScreensaver();
void renderNoisePaletteScreensaver();
void renderSinelonScreensaver();
void renderJuggleScreensaver();
void renderConfettiScreensaver();
void renderFire2012Screensaver();
void renderSparkleScreensaver();
void renderEffectFrame(uint8_t type);
void renderScreensaverFrame();
void enqueueWebhookNumberCalled(int number);
void enqueueWebhookBingo(int triggeringNumber);
void processWebhookQueue();
void syncSessionMarksFreeOnly(CardSession& s);
void screensaverBufToLeds();
void clearScreensaverBuf(CRGB color = CRGB::Black);
void renderWinnerShimmerAll();
void renderGameBoardFrame();
bool renderWinnerScrollFrame(const char* text);
String normalizedPin(const char* raw);
String buildStateJson();
void broadcastStateWs(const char* type = "snapshot");
String buildCardStateJson(const CardSession& s);
void broadcastCardStateWs(const CardSession& s, const char* type = "card_state");
void broadcastAllCardStatesWs(const char* type = "card_state");
void sendWsCommandResult(AsyncWebSocketClient* client, const String& requestId, bool ok, int status,
                         const String& dataJson = "{}", const char* error = nullptr);
void handleWsCommand(AsyncWebSocketClient* client, JsonObject obj);
void clearWsSubscription(WsSubscription& sub);
void clearAllWsSubscriptions();
void removeWsSubscription(uint32_t clientId);
void setWsSubscription(uint32_t clientId, bool boardMode, bool boardAuthOk, const char* cardId);
bool wsCanReceiveState(uint32_t clientId);
bool wsCanReceiveCardState(uint32_t clientId, const char* cardId);
uint32_t uniformRandomBelow(uint32_t maxExclusive);
void handleButton1ShortPress();
void handleButton1LongPress();
void handleButton2ShortPress();
void handleButton2LongPress();
void updateButtonState(ButtonState& b, void (*onShortPress)(), void (*onLongPress)());

uint32_t uniformRandomBelow(uint32_t maxExclusive) {
  if (maxExclusive <= 1) return 0;
  // Rejection sampling to avoid modulo bias.
  const uint32_t limit = UINT32_MAX - (UINT32_MAX % maxExclusive);
  uint32_t r = 0;
  do {
    r = esp_random();
  } while (r >= limit);
  return r % maxExclusive;
}

// Letter for number N (1-75)
char numberToLetter(int n) {
  if (n >= 1 && n <= 15) return 'B';
  if (n >= 16 && n <= 30) return 'I';
  if (n >= 31 && n <= 45) return 'N';
  if (n >= 46 && n <= 60) return 'G';
  if (n >= 61 && n <= 75) return 'O';
  return '?';
}

int letterIndex(char letter) {
  switch (letter) {
    case 'B': return 0;
    case 'I': return 1;
    case 'N': return 2;
    case 'G': return 3;
    case 'O': return 4;
    default: return -1;
  }
}

CRGB customLetterColorForLetter(char letter) {
  int idx = letterIndex(letter);
  if (idx < 0 || idx >= 5) return CRGB::Black;
  uint32_t c = customLetterColors[idx];
  CRGB rgb((c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF);
  return boostVividForStrip(rgb);
}

CRGB boostVividForStrip(CRGB rgb) {
  if (ledVibrance == 0) return rgb;
  // Increase saturation/brightness so selected colors read bolder on WS2811 strips.
  CHSV hsv = rgb2hsv_approximate(rgb);
  const uint8_t satBoost = (uint8_t)(((uint16_t)ledVibrance * 80u) / 100u);
  const uint8_t minValue = (uint8_t)(128u + (((uint16_t)ledVibrance * 107u) / 100u)); // 128..235
  const uint8_t topBoost = (uint8_t)(((uint16_t)ledVibrance * 24u) / 100u);
  hsv.s = qadd8(hsv.s, satBoost);
  hsv.v = hsv.v < minValue ? minValue : qadd8(hsv.v, topBoost);
  CRGB out(hsv);

  // Slight channel rebalance to counter common green-heavy perception.
  const uint16_t rScale = 100u + (((uint16_t)ledVibrance * 14u) / 100u); // 100..114
  const uint16_t gScale = 100u - (((uint16_t)ledVibrance * 12u) / 100u); // 100..88
  const uint16_t bScale = 100u + (((uint16_t)ledVibrance * 18u) / 100u); // 100..118
  uint16_t r = ((uint16_t)out.r * rScale) / 100u;
  uint16_t g = ((uint16_t)out.g * gScale) / 100u;
  uint16_t b = ((uint16_t)out.b * bScale) / 100u;
  if (r > 255u) r = 255u;
  if (g > 255u) g = 255u;
  if (b > 255u) b = 255u;
  return CRGB((uint8_t)r, (uint8_t)g, (uint8_t)b);
}

CRGB solidColorForStrip() {
  CRGB rgb((staticColor >> 16) & 0xFF, (staticColor >> 8) & 0xFF, staticColor & 0xFF);
  return boostVividForStrip(rgb);
}

CRGB headerLetterColorForStrip() {
  CRGB rgb((letterHeaderColor >> 16) & 0xFF, (letterHeaderColor >> 8) & 0xFF, letterHeaderColor & 0xFF);
  return boostVividForStrip(rgb);
}

CRGB gameTypeIndicatorColorForStrip() {
  CRGB rgb((gameTypeLedColor >> 16) & 0xFF, (gameTypeLedColor >> 8) & 0xFF, gameTypeLedColor & 0xFF);
  return boostVividForStrip(rgb);
}

static void glyph5x5(char c, uint8_t out[5]) {
  char ch = (char)toupper((unsigned char)c);
  switch (ch) {
    case 'A': { uint8_t p[5] = {0x0E,0x11,0x1F,0x11,0x11}; memcpy(out,p,5); return; }
    case 'B': { uint8_t p[5] = {0x1E,0x11,0x1E,0x11,0x1E}; memcpy(out,p,5); return; }
    case 'C': { uint8_t p[5] = {0x0E,0x11,0x10,0x11,0x0E}; memcpy(out,p,5); return; }
    case 'D': { uint8_t p[5] = {0x1C,0x12,0x11,0x12,0x1C}; memcpy(out,p,5); return; }
    case 'E': { uint8_t p[5] = {0x1F,0x10,0x1E,0x10,0x1F}; memcpy(out,p,5); return; }
    case 'F': { uint8_t p[5] = {0x1F,0x10,0x1E,0x10,0x10}; memcpy(out,p,5); return; }
    case 'G': { uint8_t p[5] = {0x0F,0x10,0x13,0x11,0x0F}; memcpy(out,p,5); return; }
    case 'H': { uint8_t p[5] = {0x11,0x11,0x1F,0x11,0x11}; memcpy(out,p,5); return; }
    case 'I': { uint8_t p[5] = {0x1F,0x04,0x04,0x04,0x1F}; memcpy(out,p,5); return; }
    case 'J': { uint8_t p[5] = {0x01,0x01,0x01,0x11,0x0E}; memcpy(out,p,5); return; }
    case 'K': { uint8_t p[5] = {0x11,0x12,0x1C,0x12,0x11}; memcpy(out,p,5); return; }
    case 'L': { uint8_t p[5] = {0x10,0x10,0x10,0x10,0x1F}; memcpy(out,p,5); return; }
    case 'M': { uint8_t p[5] = {0x11,0x1B,0x15,0x11,0x11}; memcpy(out,p,5); return; }
    case 'N': { uint8_t p[5] = {0x11,0x19,0x15,0x13,0x11}; memcpy(out,p,5); return; }
    case 'O': { uint8_t p[5] = {0x0E,0x11,0x11,0x11,0x0E}; memcpy(out,p,5); return; }
    case 'P': { uint8_t p[5] = {0x1E,0x11,0x1E,0x10,0x10}; memcpy(out,p,5); return; }
    case 'Q': { uint8_t p[5] = {0x0E,0x11,0x11,0x15,0x0E}; memcpy(out,p,5); return; }
    case 'R': { uint8_t p[5] = {0x1E,0x11,0x1E,0x12,0x11}; memcpy(out,p,5); return; }
    case 'S': { uint8_t p[5] = {0x0F,0x10,0x0E,0x01,0x1E}; memcpy(out,p,5); return; }
    case 'T': { uint8_t p[5] = {0x1F,0x04,0x04,0x04,0x04}; memcpy(out,p,5); return; }
    case 'U': { uint8_t p[5] = {0x11,0x11,0x11,0x11,0x0E}; memcpy(out,p,5); return; }
    case 'V': { uint8_t p[5] = {0x11,0x11,0x11,0x0A,0x04}; memcpy(out,p,5); return; }
    case 'W': { uint8_t p[5] = {0x11,0x11,0x15,0x1B,0x11}; memcpy(out,p,5); return; }
    case 'X': { uint8_t p[5] = {0x11,0x0A,0x04,0x0A,0x11}; memcpy(out,p,5); return; }
    case 'Y': { uint8_t p[5] = {0x11,0x0A,0x04,0x04,0x04}; memcpy(out,p,5); return; }
    case 'Z': { uint8_t p[5] = {0x1F,0x02,0x04,0x08,0x1F}; memcpy(out,p,5); return; }
    case '0': { uint8_t p[5] = {0x0E,0x11,0x11,0x11,0x0E}; memcpy(out,p,5); return; }
    case '1': { uint8_t p[5] = {0x04,0x0C,0x04,0x04,0x0E}; memcpy(out,p,5); return; }
    case '2': { uint8_t p[5] = {0x0E,0x11,0x02,0x04,0x1F}; memcpy(out,p,5); return; }
    case '3': { uint8_t p[5] = {0x1F,0x02,0x06,0x01,0x1E}; memcpy(out,p,5); return; }
    case '4': { uint8_t p[5] = {0x02,0x06,0x0A,0x1F,0x02}; memcpy(out,p,5); return; }
    case '5': { uint8_t p[5] = {0x1F,0x10,0x1E,0x01,0x1E}; memcpy(out,p,5); return; }
    case '6': { uint8_t p[5] = {0x07,0x08,0x1E,0x11,0x0E}; memcpy(out,p,5); return; }
    case '7': { uint8_t p[5] = {0x1F,0x01,0x02,0x04,0x08}; memcpy(out,p,5); return; }
    case '8': { uint8_t p[5] = {0x0E,0x11,0x0E,0x11,0x0E}; memcpy(out,p,5); return; }
    case '9': { uint8_t p[5] = {0x0E,0x11,0x0F,0x01,0x0E}; memcpy(out,p,5); return; }
    case '!': { uint8_t p[5] = {0x04,0x04,0x04,0x00,0x04}; memcpy(out,p,5); return; }
    case '?': { uint8_t p[5] = {0x0E,0x11,0x02,0x00,0x02}; memcpy(out,p,5); return; }
    case '-': { uint8_t p[5] = {0x00,0x00,0x1F,0x00,0x00}; memcpy(out,p,5); return; }
    case '.': { uint8_t p[5] = {0x00,0x00,0x00,0x00,0x04}; memcpy(out,p,5); return; }
    case ' ': { uint8_t p[5] = {0x00,0x00,0x00,0x00,0x00}; memcpy(out,p,5); return; }
    default:  { uint8_t p[5] = {0x1F,0x11,0x00,0x11,0x1F}; memcpy(out,p,5); return; }
  }
}

CRGB screensaverPixelColor(int x, int y) {
  bool savedWinner = winnerDeclared;
  winnerDeclared = false;
  int pseudoNumber = ((x + y * 21) % 75) + 1;
  CRGB c = colorForCalledNumber(pseudoNumber);
  winnerDeclared = savedWinner;
  return c;
}

void resetScreensaverAnim() {
  screensaverOffsetCols = 0;
  screensaverCylonDir = 1;
  screensaverHue = 0;
  screensaverLastStepMs = millis();
  screensaverNoiseX = random16();
  screensaverNoiseY = random16();
  screensaverNoiseZ = random16();
  memset(screensaverNoise, 0, sizeof(screensaverNoise));
  memset(screensaverFireHeat, 0, sizeof(screensaverFireHeat));
  fill_solid(screensaverBuf, NUM_LEDS, CRGB::Black);
  if (!screensaverTwinklePalInit) {
    screensaverTwinklePal = PartyColors_p;
    screensaverTwinkleTarget = PartyColors_p;
    screensaverTwinklePalInit = true;
  }
}

void disableScreensaverForDraw() {
  if (!screensaverEnabled) return;
  screensaverEnabled = false;
  resetScreensaverAnim();
  saveNvsScreensaverEnabledOnly();
}

void applyScreensaverEnabled(bool enabled) {
  screensaverEnabled = enabled;
  if (screensaverEnabled && ledTestMode) {
    ledTestMode = false;
    resetLedTestSequence();
  }
  resetScreensaverAnim();
  updateAllLeds();
  saveNvsScreensaverEnabledOnly();
  broadcastStateWs("screensaver_changed");
}

// Lower screensaverSpeedMs => faster animation (matches text scroll semantics).
uint8_t screensaverAnimRate() {
  uint16_t ms = screensaverSpeedMs;
  if (ms < 20) ms = 20;
  if (ms > 500) ms = 500;
  return (uint8_t)map(ms, 20, 500, 96, 8);
}

const char* screensaverTypeToString(uint8_t type) {
  switch (type) {
    case 1: return "rainbow";
    case 2: return "solid";
    case 3: return "fire_matrix";
    case 4: return "pacifica";
    case 5: return "pride";
    case 6: return "twinkle_fox";
    case 7: return "cylon";
    case 8: return "noise_palette";
    case 9: return "sinelon";
    case 10: return "juggle";
    case 11: return "confetti";
    case 12: return "fire2012";
    case 13: return "sparkle";
    default: return "text";
  }
}

int screensaverTypeFromString(const char* value) {
  if (!value) return 0;
  if (strcmp(value, "rainbow") == 0) return 1;
  if (strcmp(value, "solid") == 0) return 2;
  if (strcmp(value, "fire_matrix") == 0) return 3;
  if (strcmp(value, "pacifica") == 0) return 4;
  if (strcmp(value, "pride") == 0) return 5;
  if (strcmp(value, "twinkle_fox") == 0) return 6;
  if (strcmp(value, "cylon") == 0) return 7;
  if (strcmp(value, "noise_palette") == 0) return 8;
  if (strcmp(value, "sinelon") == 0) return 9;
  if (strcmp(value, "juggle") == 0) return 10;
  if (strcmp(value, "confetti") == 0) return 11;
  if (strcmp(value, "fire2012") == 0) return 12;
  if (strcmp(value, "sparkle") == 0) return 13;
  return 0;
}

void clearScreensaverBuf(CRGB color) {
  fill_solid(screensaverBuf, NUM_LEDS, color);
}

void screensaverBufToLeds() {
  for (int i = 0; i < NUM_LEDS; i++) {
    const int row = i / 21;
    const int col = i % 21;
    const int p = matrix21x5ToPhysical(row, col);
    if (p >= 0 && p < NUM_LEDS) leds[p] = screensaverBuf[i];
  }
}

void renderTextScreensaver() {
  const int width = 21;
  const int height = 5;
  const int glyphWidth = 5;
  const int spacing = 1;
  const int advance = glyphWidth + spacing;
  int textLen = (int)strlen(screensaverText);
  if (textLen <= 0) return;
  int contentWidth = textLen * advance;

  unsigned long now = millis();
  if ((now - screensaverLastStepMs) >= screensaverSpeedMs) {
    screensaverLastStepMs = now;
    screensaverOffsetCols = (screensaverOffsetCols + 1) % (contentWidth + width);
  }

  for (int row = 0; row < height; row++) {
    for (int col = 0; col < width; col++) {
      int p = matrix21x5ToPhysical(row, col);
      if (p < 0 || p >= NUM_LEDS) continue;
      int msgCol = col + screensaverOffsetCols - width;
      if (msgCol < 0 || msgCol >= contentWidth) {
        leds[p] = CRGB::Black;
        continue;
      }
      int charIndex = msgCol / advance;
      int glyphCol = msgCol % advance;
      if (charIndex < 0 || charIndex >= textLen || glyphCol >= glyphWidth) {
        leds[p] = CRGB::Black;
        continue;
      }
      uint8_t rows[5];
      glyph5x5(screensaverText[charIndex], rows);
      bool on = ((rows[row] >> (glyphWidth - 1 - glyphCol)) & 0x01) != 0;
      leds[p] = on ? screensaverPixelColor(col, row) : CRGB::Black;
    }
  }
}

void renderRainbowScreensaver() {
  const int width = 21;
  const int height = 5;
  const uint8_t timeOffset = beat8(screensaverAnimRate());
  for (int row = 0; row < height; row++) {
    for (int col = 0; col < width; col++) {
      int p = matrix21x5ToPhysical(row, col);
      if (p < 0 || p >= NUM_LEDS) continue;
      uint8_t hue = timeOffset + (uint8_t)(col * 12) + (uint8_t)(row * 24);
      leds[p] = CHSV(hue, 255, 200);
    }
  }
}

void renderSolidScreensaver() {
  const int width = 21;
  const int height = 5;
  CRGB base(
    (uint8_t)((screensaverColor >> 16) & 0xFF),
    (uint8_t)((screensaverColor >> 8) & 0xFF),
    (uint8_t)(screensaverColor & 0xFF)
  );
  const uint8_t pulse = beatsin8(screensaverAnimRate(), 160, 255);
  base.nscale8_video(pulse);
  const CRGB color = base;
  for (int row = 0; row < height; row++) {
    for (int col = 0; col < width; col++) {
      int p = matrix21x5ToPhysical(row, col);
      if (p < 0 || p >= NUM_LEDS) continue;
      leds[p] = color;
    }
  }
}

// Fire palette from FastLED FireMatrix example (Yaroslaw Turbin / ldirko).
DEFINE_GRADIENT_PALETTE(fireMatrixPal_gp){
  0,   0,   0,   0,   // black (space above fire)
  32,  255, 0,   0,   // red (tips of flames)
  190, 255, 255, 0,   // yellow (middle of flames)
  255, 255, 255, 255  // white (hottest part / base)
};

// Perlin-noise fire matrix (adapted from FastLED FireMatrix example).
// Visual coords: row 0 = top, row 4 = bottom. Flames rise from the bottom.
void renderFireMatrixScreensaver() {
  const int width = 21;
  const int height = 5;
  static CRGBPalette16 firePal = fireMatrixPal_gp;

  const uint32_t now = millis();
  // Lower screensaverSpeedMs => faster rise / pattern change.
  const uint8_t rate = screensaverAnimRate();  // 8..96
  const uint32_t ySpeed = now * (uint32_t)rate / 4UL;
  const uint16_t z = (uint16_t)(now / (uint32_t)map(rate, 8, 96, 40, 8));
  // Scale tuned for a wide, short 21x5 matrix.
  const uint16_t scale = 48;

  for (int row = 0; row < height; row++) {
    for (int col = 0; col < width; col++) {
      int p = matrix21x5ToPhysical(row, col);
      if (p < 0 || p >= NUM_LEDS) continue;

      // Fire-space j: 0 at bottom (hottest), height-1 at top (coolest).
      const int j = (height - 1) - row;
      const uint16_t x = (uint16_t)(col * scale);
      const uint32_t y = (uint32_t)(j * scale) + ySpeed;
      const uint16_t noise16 = inoise16((uint32_t)x << 8, y << 8, (uint32_t)z << 8);
      const uint8_t noiseVal = (uint8_t)(noise16 >> 8);

      // Fade palette index toward black toward the top of the board.
      // Cap below 255 so the short matrix still shows flame color on upper rows.
      const uint8_t subtraction = (uint8_t)((j * 200) / (height - 1));
      const uint8_t paletteIndex = qsub8(noiseVal, subtraction);
      leds[p] = ColorFromPalette(firePal, paletteIndex, 255, LINEARBLEND);
    }
  }
}

// Pacifica — gentle ocean waves (Mark Kriegsman / Mary Corey March).
static CRGBPalette16 pacificaPalette1(
  0x000507, 0x000409, 0x00030B, 0x00030D, 0x000210, 0x000212, 0x000114, 0x000117,
  0x000019, 0x00001C, 0x000026, 0x000031, 0x00003B, 0x000046, 0x14554B, 0x28AA50
);
static CRGBPalette16 pacificaPalette2(
  0x000507, 0x000409, 0x00030B, 0x00030D, 0x000210, 0x000212, 0x000114, 0x000117,
  0x000019, 0x00001C, 0x000026, 0x000031, 0x00003B, 0x000046, 0x0C5F52, 0x19BE5F
);
static CRGBPalette16 pacificaPalette3(
  0x000208, 0x00030E, 0x000514, 0x00061A, 0x000820, 0x000927, 0x000B2D, 0x000C33,
  0x000E39, 0x001040, 0x001450, 0x001860, 0x001C70, 0x002080, 0x1040BF, 0x2060FF
);

void pacificaOneLayer(CRGBPalette16& p, uint16_t cistart, uint16_t wavescale, uint8_t bri, uint16_t ioff) {
  uint16_t ci = cistart;
  uint16_t waveangle = ioff;
  uint16_t wavescaleHalf = (wavescale / 2) + 20;
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    waveangle += 250;
    uint16_t s16 = sin16(waveangle) + 32768;
    uint16_t cs = scale16(s16, wavescaleHalf) + wavescaleHalf;
    ci += cs;
    uint16_t sindex16 = sin16(ci) + 32768;
    uint8_t sindex8 = scale16(sindex16, 240);
    screensaverBuf[i] += ColorFromPalette(p, sindex8, bri, LINEARBLEND);
  }
}

void renderPacificaScreensaver() {
  static uint16_t sCIStart1 = 0, sCIStart2 = 0, sCIStart3 = 0, sCIStart4 = 0;
  static uint32_t sLastMs = 0;
  uint32_t ms = millis();
  uint32_t deltams = ms - sLastMs;
  sLastMs = ms;

  // Speed slider scales wave motion.
  const uint8_t rate = screensaverAnimRate();
  deltams = (deltams * rate) / 40;
  if (deltams == 0) deltams = 1;

  uint16_t speedfactor1 = beatsin16(3, 179, 269);
  uint16_t speedfactor2 = beatsin16(4, 179, 269);
  uint32_t deltams1 = (deltams * speedfactor1) / 256;
  uint32_t deltams2 = (deltams * speedfactor2) / 256;
  uint32_t deltams21 = (deltams1 + deltams2) / 2;
  sCIStart1 += (deltams1 * beatsin88(1011, 10, 13));
  sCIStart2 -= (deltams21 * beatsin88(777, 8, 11));
  sCIStart3 -= (deltams1 * beatsin88(501, 5, 7));
  sCIStart4 -= (deltams2 * beatsin88(257, 4, 6));

  clearScreensaverBuf(CRGB(2, 6, 10));
  pacificaOneLayer(pacificaPalette1, sCIStart1, beatsin16(3, 11 * 256, 14 * 256), beatsin8(10, 70, 130), 0 - beat16(301));
  pacificaOneLayer(pacificaPalette2, sCIStart2, beatsin16(4, 6 * 256, 9 * 256), beatsin8(17, 40, 80), beat16(401));
  pacificaOneLayer(pacificaPalette3, sCIStart3, 6 * 256, beatsin8(9, 10, 38), 0 - beat16(503));
  pacificaOneLayer(pacificaPalette3, sCIStart4, 5 * 256, beatsin8(8, 10, 28), beat16(601));

  uint8_t basethreshold = beatsin8(9, 55, 65);
  uint8_t wave = beat8(7);
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    uint8_t threshold = scale8(sin8(wave), 20) + basethreshold;
    wave += 7;
    uint8_t l = screensaverBuf[i].getAverageLight();
    if (l > threshold) {
      uint8_t overage = l - threshold;
      uint8_t overage2 = qadd8(overage, overage);
      screensaverBuf[i] += CRGB(overage, overage2, qadd8(overage2, overage2));
    }
  }
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    screensaverBuf[i].blue = scale8(screensaverBuf[i].blue, 145);
    screensaverBuf[i].green = scale8(screensaverBuf[i].green, 200);
    screensaverBuf[i] |= CRGB(2, 5, 7);
  }
  screensaverBufToLeds();
}

// Pride2015 — animated rainbows (Mark Kriegsman).
void renderPrideScreensaver() {
  static uint16_t sPseudotime = 0;
  static uint16_t sLastMillis = 0;
  static uint16_t sHue16 = 0;

  uint8_t sat8 = beatsin88(87, 220, 250);
  uint8_t brightdepth = beatsin88(341, 96, 224);
  uint16_t brightnessthetainc16 = beatsin88(203, (25 * 256), (40 * 256));
  uint8_t msmultiplier = beatsin88(147, 23, 60);
  // Speed slider scales motion.
  msmultiplier = (uint8_t)scale8(msmultiplier, screensaverAnimRate() + 32);

  uint16_t hue16 = sHue16;
  uint16_t hueinc16 = beatsin88(113, 1, 3000);
  uint16_t ms = (uint16_t)millis();
  uint16_t deltams = ms - sLastMillis;
  sLastMillis = ms;
  sPseudotime += deltams * msmultiplier;
  sHue16 += deltams * beatsin88(400, 5, 9);
  uint16_t brightnesstheta16 = sPseudotime;

  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    hue16 += hueinc16;
    uint8_t hue8 = hue16 / 256;
    brightnesstheta16 += brightnessthetainc16;
    uint16_t b16 = sin16(brightnesstheta16) + 32768;
    uint16_t bri16 = (uint32_t)((uint32_t)b16 * (uint32_t)b16) / 65536;
    uint8_t bri8 = (uint32_t)(((uint32_t)bri16) * brightdepth) / 65536;
    bri8 += (255 - brightdepth);
    CRGB newcolor = CHSV(hue8, sat8, bri8);
    nblend(screensaverBuf[(NUM_LEDS - 1) - i], newcolor, 64);
  }
  screensaverBufToLeds();
}

// TwinkleFox — holiday twinkles (Mark Kriegsman), simplified with built-in palettes.
static uint8_t attackDecayWave8(uint8_t i) {
  if (i < 86) return i * 3;
  i -= 86;
  return 255 - (i + (i / 2));
}

static void coolLikeIncandescent(CRGB& c, uint8_t phase) {
  if (phase < 128) return;
  uint8_t cooling = (phase - 128) >> 4;
  c.g = qsub8(c.g, cooling);
  c.b = qsub8(c.b, cooling * 2);
}

static CRGB computeOneTwinkle(uint32_t ms, uint8_t salt, uint8_t speed, uint8_t density) {
  uint16_t ticks = ms >> (8 - speed);
  uint8_t fastcycle8 = (uint8_t)ticks;
  uint16_t slowcycle16 = (ticks >> 8) + salt;
  slowcycle16 += sin8((uint8_t)slowcycle16);
  slowcycle16 = (slowcycle16 * 2053) + 1384;
  uint8_t slowcycle8 = (uint8_t)((slowcycle16 & 0xFF) + (slowcycle16 >> 8));

  uint8_t bright = 0;
  if (((slowcycle8 & 0x0E) / 2) < density) {
    bright = attackDecayWave8(fastcycle8);
  }

  uint8_t hue = slowcycle8 - salt;
  if (bright == 0) return CRGB::Black;
  CRGB c = ColorFromPalette(screensaverTwinklePal, hue, bright, NOBLEND);
  coolLikeIncandescent(c, fastcycle8);
  return c;
}

void renderTwinkleFoxScreensaver() {
  if (!screensaverTwinklePalInit) {
    screensaverTwinklePal = PartyColors_p;
    screensaverTwinkleTarget = PartyColors_p;
    screensaverTwinklePalInit = true;
  }

  static uint8_t whichPalette = 0;
  static unsigned long lastPaletteMs = 0;
  const unsigned long now = millis();
  if (now - lastPaletteMs > 30000UL) {
    lastPaletteMs = now;
    whichPalette = (uint8_t)((whichPalette + 1) % 7);
    switch (whichPalette) {
      case 0: screensaverTwinkleTarget = PartyColors_p; break;
      case 1: screensaverTwinkleTarget = RainbowColors_p; break;
      case 2: screensaverTwinkleTarget = OceanColors_p; break;
      case 3: screensaverTwinkleTarget = LavaColors_p; break;
      case 4: screensaverTwinkleTarget = ForestColors_p; break;
      case 5: screensaverTwinkleTarget = CloudColors_p; break;
      default: screensaverTwinkleTarget = HeatColors_p; break;
    }
  }
  nblendPaletteTowardPalette(screensaverTwinklePal, screensaverTwinkleTarget, 12);

  // Map speed slider: rate 8..96 => twinkle speed 2..7, density 4..7
  const uint8_t rate = screensaverAnimRate();
  const uint8_t speed = (uint8_t)map(rate, 8, 96, 2, 7);
  const uint8_t density = (uint8_t)map(rate, 8, 96, 4, 7);

  uint16_t prng16 = 11337;
  uint32_t clock32 = now;
  for (int i = 0; i < NUM_LEDS; i++) {
    prng16 = (uint16_t)(prng16 * 2053) + 1384;
    uint16_t myclockoffset16 = prng16;
    prng16 = (uint16_t)(prng16 * 2053) + 1384;
    uint8_t myspeedmultiplierQ5_3 = (uint8_t)(((((prng16 & 0xFF) >> 4) + (prng16 & 0x0F)) & 0x0F) + 0x08);
    uint32_t myclock30 = (uint32_t)((clock32 * myspeedmultiplierQ5_3) >> 3) + myclockoffset16;
    uint8_t myunique8 = (uint8_t)(prng16 >> 8);
    screensaverBuf[i] = computeOneTwinkle(myclock30, myunique8, speed, density);
  }
  screensaverBufToLeds();
}

// Cylon / Larson scanner — full-column bounce across the 21-wide board.
void renderCylonScreensaver() {
  const int width = 21;
  const int height = 5;
  const uint8_t rate = screensaverAnimRate();
  const uint16_t stepMs = (uint16_t)map(rate, 8, 96, 90, 18);
  const unsigned long now = millis();
  if ((now - screensaverLastStepMs) >= stepMs) {
    screensaverLastStepMs = now;
    screensaverOffsetCols += screensaverCylonDir;
    if (screensaverOffsetCols >= width - 1) {
      screensaverOffsetCols = width - 1;
      screensaverCylonDir = -1;
    } else if (screensaverOffsetCols <= 0) {
      screensaverOffsetCols = 0;
      screensaverCylonDir = 1;
    }
    screensaverHue++;
  }

  for (int i = 0; i < NUM_LEDS; i++) screensaverBuf[i].nscale8(200);
  for (int row = 0; row < height; row++) {
    screensaverBuf[row * width + screensaverOffsetCols] = CHSV(screensaverHue, 255, 255);
  }
  screensaverBufToLeds();
}

// NoisePlusPalette — organic palette-mapped Perlin noise.
void renderNoisePaletteScreensaver() {
  const int width = 21;
  const int height = 5;
  static CRGBPalette16 currentPalette;
  static bool paletteInit = false;
  static uint8_t colorLoop = 1;
  static uint8_t ihue = 0;
  static uint8_t lastSecond = 99;
  static uint8_t scale = 40;

  if (!paletteInit) {
    currentPalette = OceanColors_p;
    paletteInit = true;
  }

  const uint8_t rate = screensaverAnimRate();
  uint8_t speed = (uint8_t)map(rate, 8, 96, 4, 40);

  uint8_t secondHand = (uint8_t)((millis() / 1000UL) % 60UL);
  if (lastSecond != secondHand) {
    lastSecond = secondHand;
    if (secondHand == 0) { currentPalette = RainbowColors_p; colorLoop = 1; scale = 30; }
    else if (secondHand == 10) { currentPalette = OceanColors_p; colorLoop = 0; scale = 50; }
    else if (secondHand == 20) { currentPalette = LavaColors_p; colorLoop = 0; scale = 40; }
    else if (secondHand == 30) { currentPalette = ForestColors_p; colorLoop = 0; scale = 60; }
    else if (secondHand == 40) { currentPalette = CloudColors_p; colorLoop = 0; scale = 30; }
    else if (secondHand == 50) { currentPalette = PartyColors_p; colorLoop = 1; scale = 30; }
  }

  uint8_t dataSmoothing = 0;
  if (speed < 50) dataSmoothing = 200 - (speed * 4);

  for (int col = 0; col < width; col++) {
    int ioffset = scale * col;
    for (int row = 0; row < height; row++) {
      int joffset = scale * row;
      uint8_t data = inoise8(screensaverNoiseX + ioffset, screensaverNoiseY + joffset, screensaverNoiseZ);
      data = qsub8(data, 16);
      data = qadd8(data, scale8(data, 39));
      if (dataSmoothing) {
        uint8_t olddata = screensaverNoise[col][row];
        data = scale8(olddata, dataSmoothing) + scale8(data, 256 - dataSmoothing);
      }
      screensaverNoise[col][row] = data;
    }
  }
  screensaverNoiseZ += speed;
  screensaverNoiseX += speed / 8;
  screensaverNoiseY -= speed / 16;

  for (int col = 0; col < width; col++) {
    for (int row = 0; row < height; row++) {
      uint8_t index = screensaverNoise[col][row];
      // Second noise sample for brightness (flipped axes, classic NoisePlusPalette trick).
      uint8_t bri = inoise8(
        screensaverNoiseY + (uint16_t)row * scale,
        screensaverNoiseX + (uint16_t)col * scale,
        screensaverNoiseZ
      );
      bri = qsub8(bri, 16);
      bri = qadd8(bri, scale8(bri, 39));
      if (colorLoop) index += ihue;
      if (bri > 127) bri = 255;
      else bri = dim8_raw(bri * 2);
      screensaverBuf[row * width + col] = ColorFromPalette(currentPalette, index, bri);
    }
  }
  ihue++;
  screensaverBufToLeds();
}

// Sinelon — colored comet with trails (DemoReel100).
void renderSinelonScreensaver() {
  const uint8_t rate = screensaverAnimRate();
  fadeToBlackBy(screensaverBuf, NUM_LEDS, (uint8_t)map(rate, 8, 96, 10, 40));
  int pos = beatsin16((uint8_t)map(rate, 8, 96, 6, 24), 0, NUM_LEDS - 1);
  screensaverBuf[pos] += CHSV(screensaverHue, 255, 192);
  EVERY_N_MILLISECONDS(20) { screensaverHue++; }
  screensaverBufToLeds();
}

// Juggle — multiple colored dots weaving (DemoReel100).
void renderJuggleScreensaver() {
  const uint8_t rate = screensaverAnimRate();
  fadeToBlackBy(screensaverBuf, NUM_LEDS, (uint8_t)map(rate, 8, 96, 10, 40));
  uint8_t dothue = 0;
  uint8_t baseBpm = (uint8_t)map(rate, 8, 96, 5, 14);
  for (int i = 0; i < 8; i++) {
    screensaverBuf[beatsin16(i + baseBpm, 0, NUM_LEDS - 1)] |= CHSV(dothue, 200, 255);
    dothue += 32;
  }
  screensaverBufToLeds();
}

// Confetti — random colored speckles (DemoReel100).
void renderConfettiScreensaver() {
  const uint8_t rate = screensaverAnimRate();
  fadeToBlackBy(screensaverBuf, NUM_LEDS, (uint8_t)map(rate, 8, 96, 6, 20));
  int pos = random16(NUM_LEDS);
  screensaverBuf[pos] += CHSV(screensaverHue + random8(64), 200, 255);
  EVERY_N_MILLISECONDS(20) { screensaverHue++; }
  screensaverBufToLeds();
}

// Fire2012WithPalette — classic heat-cell fire, one column at a time.
void renderFire2012Screensaver() {
  const int width = 21;
  const int height = 5;
  static CRGBPalette16 firePal;
  static bool firePalInit = false;
  if (!firePalInit) {
    firePal = HeatColors_p;
    firePalInit = true;
  }
  const uint8_t rate = screensaverAnimRate();
  const uint8_t cooling = (uint8_t)map(rate, 8, 96, 70, 40);
  const uint8_t sparking = (uint8_t)map(rate, 8, 96, 80, 160);

  random16_add_entropy(random16());

  for (int col = 0; col < width; col++) {
    // Step 1: cool
    for (int i = 0; i < height; i++) {
      screensaverFireHeat[col][i] = qsub8(
        screensaverFireHeat[col][i],
        random8(0, ((cooling * 10) / height) + 2)
      );
    }
    // Step 2: heat rises (index 0 = bottom)
    for (int k = height - 1; k >= 2; k--) {
      screensaverFireHeat[col][k] =
        (screensaverFireHeat[col][k - 1] + screensaverFireHeat[col][k - 2] + screensaverFireHeat[col][k - 2]) / 3;
    }
    // Step 3: spark at bottom
    if (random8() < sparking) {
      int y = random8(2);
      screensaverFireHeat[col][y] = qadd8(screensaverFireHeat[col][y], random8(160, 255));
    }
    // Step 4: map heat to colors (row 4 = bottom visually)
    for (int j = 0; j < height; j++) {
      uint8_t colorindex = scale8(screensaverFireHeat[col][j], 240);
      int row = (height - 1) - j;
      screensaverBuf[row * width + col] = ColorFromPalette(firePal, colorindex);
    }
  }
  screensaverBufToLeds();
}

void renderSparkleScreensaver() {
  renderWinnerShimmerAll();
}

void renderEffectFrame(uint8_t type) {
  switch (type) {
    case 1: renderRainbowScreensaver(); return;
    case 2: renderSolidScreensaver(); return;
    case 3: renderFireMatrixScreensaver(); return;
    case 4: renderPacificaScreensaver(); return;
    case 5: renderPrideScreensaver(); return;
    case 6: renderTwinkleFoxScreensaver(); return;
    case 7: renderCylonScreensaver(); return;
    case 8: renderNoisePaletteScreensaver(); return;
    case 9: renderSinelonScreensaver(); return;
    case 10: renderJuggleScreensaver(); return;
    case 11: renderConfettiScreensaver(); return;
    case 12: renderFire2012Screensaver(); return;
    case 13: renderSparkleScreensaver(); return;
    default: renderTextScreensaver(); return;
  }
}

void renderScreensaverFrame() {
  renderEffectFrame(screensaverType);
}

void renderWinnerShimmerAll() {
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i] = goldShimmerColor((uint8_t)(i * 13));
  }
}

char bingoLetterForNumber(int n) {
  if (n < 1 || n > 75) return '?';
  if (n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  return 'O';
}

void clearCalledNumberBanner() {
  calledNumberBannerUntilMs = 0;
  calledNumberBannerNumber = 0;
}

void startCalledNumberBanner(int n) {
  if (!calledNumberBannerEnabled || n < 1 || n > 75) {
    clearCalledNumberBanner();
    return;
  }
  calledNumberBannerNumber = n;
  calledNumberBannerUntilMs = millis() + 3000UL;
}

bool calledNumberBannerActive() {
  if (!calledNumberBannerEnabled || calledNumberBannerNumber < 1 || calledNumberBannerNumber > 75) {
    return false;
  }
  if (calledNumberBannerUntilMs == 0) return false;
  if ((long)(calledNumberBannerUntilMs - millis()) <= 0) {
    clearCalledNumberBanner();
    return false;
  }
  return true;
}

void clearCalledNumberBannerRegion() {
  // Clear both number and game-type columns (banner borrows game-type space).
  for (int sec = 0; sec < 3; sec++) {
    if (sec != SEC_NUMBERS && sec != SEC_GAME_TYPE) continue;
    const int startCol = sectionStartCol[sec];
    const int width = SECTION_WIDTH[sec];
    for (int row = 0; row < 5; row++) {
      for (int localCol = 0; localCol < width; localCol++) {
        int p = matrix21x5ToPhysical(row, startCol + localCol);
        if (p >= 0 && p < NUM_LEDS) leds[p] = CRGB::Black;
      }
    }
  }
}

/** Plot a full 5×5 glyph starting at an absolute board column. */
void plotBannerGlyph(char ch, int startAbsCol, CRGB color) {
  uint8_t rows[5];
  glyph5x5(ch, rows);
  const int glyphWidth = 5;
  for (int row = 0; row < 5; row++) {
    for (int col = 0; col < glyphWidth; col++) {
      bool on = ((rows[row] >> (glyphWidth - 1 - col)) & 0x01) != 0;
      if (!on) continue;
      int p = matrix21x5ToPhysical(row, startAbsCol + col);
      if (p >= 0 && p < NUM_LEDS) leds[p] = color;
    }
  }
}

/**
 * Draw letter+digits centered across the number + game-type sections (20 cols).
 * Letter column stays normal; after the banner timer, game type redraws as usual.
 */
void renderCalledNumberBannerFrame(int n) {
  char letter = bingoLetterForNumber(n);
  char digits[3];
  if (n >= 10) {
    digits[0] = (char)('0' + (n / 10));
    digits[1] = (char)('0' + (n % 10));
    digits[2] = '\0';
  } else {
    digits[0] = (char)('0' + n);
    digits[1] = '\0';
  }
  const int digitCount = (int)strlen(digits);
  const int glyphW = 5;
  const int gap = 1;  // between letter and digits, and between digits

  // Contiguous span covering both remapped sections (order: letters | numbers | game type).
  const int numsStart = sectionStartCol[SEC_NUMBERS];
  const int gtStart = sectionStartCol[SEC_GAME_TYPE];
  const int bannerStart =
    (numsStart < gtStart) ? numsStart : gtStart;
  const int bannerWidth = SECTION_WIDTH[SEC_NUMBERS] + SECTION_WIDTH[SEC_GAME_TYPE];

  // Letter + gaps + digits, all full 5-wide glyphs.
  int contentWidth = glyphW;
  contentWidth += gap;
  contentWidth += digitCount * glyphW;
  if (digitCount > 1) contentWidth += gap * (digitCount - 1);

  int startLocal = (bannerWidth - contentWidth) / 2;
  if (startLocal < 0) startLocal = 0;

  clearCalledNumberBannerRegion();
  CRGB color = colorForCalledNumber(n);

  int absCol = bannerStart + startLocal;
  plotBannerGlyph(letter, absCol, color);
  absCol += glyphW + gap;
  for (int i = 0; i < digitCount; i++) {
    if (i > 0) absCol += gap;
    plotBannerGlyph(digits[i], absCol, color);
    absCol += glyphW;
  }
}

void renderGameBoardFrame() {
  if (winnerDeclared) {
    renderWinnerShimmerAll();
    return;
  }

  // Battleship: inverted “sink” board — uncalled lit, called dark;
  // current keeps beacon; late round forces red strobe (render-only).
  const bool sinkLeds = strcmp(gameType, "battleship") == 0;
  const bool sinkThreat = sinkLeds && callOrderCount >= 38;

  const bool showBanner = calledNumberBannerActive();
  if (!showBanner) {
    for (int n = 1; n <= 75; n++) {
      if (sinkLeds) {
        if (called[n] && n != currentNumber) continue;
      } else {
        if (!called[n]) continue;
      }
      int p = numberToPhysical(n);
      if (p >= 0) {
        if (n == currentNumber) {
          uint32_t beaconColor = sinkThreat ? 0xFF0000u : currentNumberColor;
          const char* beaconEffect = sinkThreat ? "strobe" : currentNumberEffect;
          CRGB base((beaconColor >> 16) & 0xFF,
                    (beaconColor >> 8) & 0xFF,
                    beaconColor & 0xFF);
          uint8_t bri = 255;
          if (strcmp(beaconEffect, "pulse") == 0) {
            // Same tempo as flash (beat8(96)); gentle sine fade.
            bri = beatsin8(96, 24, 255);
          } else if (strcmp(beaconEffect, "strobe") == 0) {
            uint8_t phase = beat8(255);
            bri = (phase < 128) ? 255 : 0;
          } else {
            // flash (default)
            uint8_t phase = beat8(96);
            bri = (phase < 128) ? 255 : 24;
          }
          base.nscale8(bri);
          leds[p] = base;
        } else {
          leds[p] = colorForCalledNumber(n);
        }
      }
    }
  } else {
    renderCalledNumberBannerFrame(calledNumberBannerNumber);
  }

  // Letters: bingo — on when column has a call; full column uses letterFullMode.
  // Battleship sink — on while any number remains; off when column fully called.
  const char* letters = "BINGO";
  for (int col = 0; col < 5; col++) {
    int low = col * 15 + 1, high = col * 15 + 15;
    bool any = false;
    bool allFull = true;
    for (int n = low; n <= high; n++) {
      if (called[n]) any = true;
      else allFull = false;
    }
    bool preview = millis() < letterHeaderPreviewUntilMs;
    int letterP = letterToPhysical(letters[col]);
    if (letterP < 0) continue;
    if (preview) {
      leds[letterP] = colorForLetter(letters[col]);
    } else if (sinkLeds) {
      if (allFull) {
        leds[letterP] = CRGB::Black;
      } else {
        leds[letterP] = colorForLetter(letters[col]);
      }
    } else if (!any) {
      leds[letterP] = CRGB::Black;
    } else if (allFull) {
      if (strcmp(letterFullMode, "off") == 0) {
        leds[letterP] = CRGB::Black;
      } else if (strcmp(letterFullMode, "number_theme") == 0) {
        // Representative number in this column so theme/custom/solid match the board.
        leds[letterP] = colorForCalledNumber(low + 7);
      } else {
        leds[letterP] = colorForLetter(letters[col]);
      }
    } else {
      leds[letterP] = colorForLetter(letters[col]);
    }
  }
  // Game-type matrix is borrowed by the banner; restore it after the banner ends.
  if (!showBanner) applyGameTypeToMatrix();
}

bool renderWinnerScrollFrame(const char* text) {
  const int width = 21;
  const int height = 5;
  const int glyphWidth = 5;
  const int spacing = 1;
  const int advance = glyphWidth + spacing;
  int textLen = (int)strlen(text);
  if (textLen <= 0) return true;
  int contentWidth = textLen * advance;
  int totalTravel = contentWidth + width;

  unsigned long now = millis();
  if ((now - winnerScrollLastStepMs) >= WINNER_SCROLL_SPEED_MS) {
    winnerScrollLastStepMs = now;
    winnerScrollOffsetCols++;
  }

  renderWinnerShimmerAll();

  for (int row = 0; row < height; row++) {
    for (int col = 0; col < width; col++) {
      int p = matrix21x5ToPhysical(row, col);
      if (p < 0 || p >= NUM_LEDS) continue;
      int msgCol = col + winnerScrollOffsetCols - width;
      if (msgCol < 0 || msgCol >= contentWidth) continue;
      int charIndex = msgCol / advance;
      int glyphCol = msgCol % advance;
      if (charIndex < 0 || charIndex >= textLen || glyphCol >= glyphWidth) continue;
      uint8_t rows[5];
      glyph5x5(text[charIndex], rows);
      bool on = ((rows[row] >> (glyphWidth - 1 - glyphCol)) & 0x01) != 0;
      if (on) leds[p] = goldShimmerColor((uint8_t)(row * 23 + col * 11 + 200));
    }
  }

  return winnerScrollOffsetCols >= totalTravel;
}

bool isBoardAuthValid() {
  if (boardAuthToken[0] == '\0') return false;
  long remaining = (long)(boardAuthExpiryMs - millis());
  return remaining > 0;
}

void persistBoardAuthToken() {
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return;
  if (boardAuthToken[0] == '\0') {
    nvs_erase_key(nvs, NVS_BOARD_TOKEN);
    nvs_erase_key(nvs, NVS_BOARD_TOKEN_REMAINING);
  } else {
    nvs_set_str(nvs, NVS_BOARD_TOKEN, boardAuthToken);
    long remaining = (long)(boardAuthExpiryMs - millis());
    if (remaining < 0) remaining = 0;
    nvs_set_u32(nvs, NVS_BOARD_TOKEN_REMAINING, (uint32_t)remaining);
  }
  nvs_commit(nvs);
  nvs_close(nvs);
}

void clearBoardAuthToken() {
  boardAuthToken[0] = '\0';
  boardAuthExpiryMs = 0;
  persistBoardAuthToken();
}

void issueBoardAuthToken() {
  const char* hex = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    boardAuthToken[i] = hex[esp_random() & 0x0F];
  }
  boardAuthToken[32] = '\0';
  boardAuthExpiryMs = millis() + BOARD_AUTH_TTL_MS;
  persistBoardAuthToken();
}

/** Unlock may be called from multiple board UIs — keep one shared token so peers stay valid. */
void ensureBoardAuthToken() {
  if (isBoardAuthValid()) {
    boardAuthExpiryMs = millis() + BOARD_AUTH_TTL_MS;
    persistBoardAuthToken();
    return;
  }
  issueBoardAuthToken();
}

bool requireBoardAuth(AsyncWebServerRequest* req) {
  if (!isBoardAuthValid()) {
    req->send(401, "application/json", "{\"error\":\"board auth required\"}");
    return false;
  }
  if (!req->hasHeader("X-Board-Token")) {
    req->send(401, "application/json", "{\"error\":\"board token missing\"}");
    return false;
  }
  const AsyncWebHeader* tokenHdr = req->getHeader("X-Board-Token");
  if (!tokenHdr || tokenHdr->value() != boardAuthToken) {
    req->send(401, "application/json", "{\"error\":\"board token invalid\"}");
    return false;
  }
  return true;
}

bool boardUnlockIsLockedOut() {
  if (boardUnlockLockoutUntilMs == 0) return false;
  unsigned long now = millis();
  if ((long)(boardUnlockLockoutUntilMs - now) > 0) return true;
  boardUnlockLockoutUntilMs = 0;
  boardUnlockFailCount = 0;
  return false;
}

void registerBoardUnlockFailure() {
  if (boardUnlockFailCount < 255) boardUnlockFailCount++;
  if (boardUnlockFailCount >= BOARD_UNLOCK_MAX_FAILURES) {
    boardUnlockLockoutUntilMs = millis() + BOARD_UNLOCK_LOCKOUT_MS;
    boardUnlockFailCount = 0;
  }
}

void clearBoardUnlockFailures() {
  boardUnlockFailCount = 0;
  boardUnlockLockoutUntilMs = 0;
}

String normalizedPin(const char* raw) {
  String s = raw ? String(raw) : String("");
  s.trim();
  return s;
}

void clearCardSession(CardSession& s) {
  s.active = false;
  s.cardId[0] = '\0';
  for (int i = 0; i < 25; i++) {
    s.numbers[i] = 0;
    s.marks[i] = false;
  }
  s.winner = false;
  s.eliminated = false;
  for (int i = 0; i < GAME_TYPE_COUNT; i++) s.claimedPatternMasks[i] = 0;
}

CardSession* findCardSessionById(const char* cardId) {
  if (!cardId || !*cardId) return nullptr;
  for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
    if (cardSessions[i].active && strcmp(cardSessions[i].cardId, cardId) == 0) {
      return &cardSessions[i];
    }
  }
  return nullptr;
}

CardSession* allocateCardSession() {
  for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
    if (!cardSessions[i].active) {
      clearCardSession(cardSessions[i]);
      cardSessions[i].active = true;
      return &cardSessions[i];
    }
  }
  return nullptr;
}

void generateCardId(char* out, size_t len) {
  const char* hex = "0123456789abcdef";
  if (len < 17) return;
  for (int i = 0; i < 16; i++) out[i] = hex[esp_random() & 0x0F];
  out[16] = '\0';
}

void generateDeviceId(char* out, size_t len) {
  const char* hex = "0123456789abcdef";
  if (len < 33) return;
  for (int i = 0; i < 32; i++) out[i] = hex[esp_random() & 0x0F];
  out[32] = '\0';
}

void ensureDeviceIdLoaded() {
  if (deviceIdBuf[0] != '\0') return;
  generateDeviceId(deviceIdBuf, sizeof(deviceIdBuf));
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) == ESP_OK) {
    nvs_set_str(nvs, NVS_DEVICE_ID, deviceIdBuf);
    nvs_commit(nvs);
    nvs_close(nvs);
  }
}

/** Card HMAC: bingo-card-v2 (all 25 cells, blanks as 0) or legacy bingo (skip FREE). */
enum CardAuthKind : uint8_t { CARD_AUTH_V2 = 0, CARD_AUTH_LEGACY = 1 };

void buildCardAuthMessage(const int nums[25], CardAuthKind kind, uint8_t* out, size_t* outLen) {
  size_t n = 0;
  if (kind == CARD_AUTH_V2) {
    static const char* domain = "bingo-card-v2";
    while (domain[n]) {
      out[n] = (uint8_t)domain[n];
      n++;
    }
    out[n++] = 1;
    for (int idx = 0; idx < 25; idx++) {
      out[n++] = (uint8_t)idx;
      out[n++] = (uint8_t)(nums[idx] & 0xFF);
    }
  } else {
    for (int idx = 0; idx < 25; idx++) {
      if (idx == 12) continue;
      out[n++] = (uint8_t)idx;
      out[n++] = (uint8_t)(nums[idx] & 0xFF);
    }
  }
  *outLen = n;
}

bool hmacSha256Card(const int nums[25], CardAuthKind kind, uint8_t out[32]) {
  ensureDeviceIdLoaded();
  uint8_t msg[80];
  size_t msgLen = 0;
  buildCardAuthMessage(nums, kind, msg, &msgLen);
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!info) return false;
  return mbedtls_md_hmac(
           info,
           (const unsigned char*)deviceIdBuf,
           strlen(deviceIdBuf),
           msg,
           msgLen,
           out) == 0;
}

void bytesToHex(const uint8_t* in, size_t inLen, char* out, size_t outLen) {
  static const char* hex = "0123456789abcdef";
  if (outLen < inLen * 2 + 1) {
    out[0] = '\0';
    return;
  }
  for (size_t i = 0; i < inLen; i++) {
    out[i * 2] = hex[(in[i] >> 4) & 0x0F];
    out[i * 2 + 1] = hex[in[i] & 0x0F];
  }
  out[inLen * 2] = '\0';
}

int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool decodeHexToBytes(const char* in, uint8_t* out, size_t outLen) {
  if (!in) return false;
  size_t len = strlen(in);
  if (len != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    int hi = hexNibble(in[i * 2]);
    int lo = hexNibble(in[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return true;
}

bool verifyCardSignature(const int nums[25], const char* sig) {
  if (!sig || !*sig) return false;
  uint8_t got[16];
  if (!decodeHexToBytes(sig, got, 16)) return false;
  const CardAuthKind kinds[] = { CARD_AUTH_V2, CARD_AUTH_LEGACY };
  for (size_t k = 0; k < sizeof(kinds) / sizeof(kinds[0]); k++) {
    uint8_t mac[32];
    if (!hmacSha256Card(nums, kinds[k], mac)) continue;
    uint8_t diff = 0;
    for (int i = 0; i < 16; i++) diff |= (uint8_t)(mac[i] ^ got[i]);
    if (diff == 0) return true;
  }
  return false;
}

void clearWsSubscription(WsSubscription& sub) {
  sub.active = false;
  sub.clientId = 0;
  sub.boardMode = false;
  sub.boardAuthOk = false;
  sub.cardId[0] = '\0';
}

void clearAllWsSubscriptions() {
  for (int i = 0; i < MAX_WS_SUBSCRIPTIONS; i++) clearWsSubscription(wsSubscriptions[i]);
}

WsSubscription* findWsSubscription(uint32_t clientId) {
  for (int i = 0; i < MAX_WS_SUBSCRIPTIONS; i++) {
    if (wsSubscriptions[i].active && wsSubscriptions[i].clientId == clientId) return &wsSubscriptions[i];
  }
  return nullptr;
}

WsSubscription* ensureWsSubscription(uint32_t clientId) {
  WsSubscription* existing = findWsSubscription(clientId);
  if (existing) return existing;
  for (int i = 0; i < MAX_WS_SUBSCRIPTIONS; i++) {
    if (!wsSubscriptions[i].active) {
      wsSubscriptions[i].active = true;
      wsSubscriptions[i].clientId = clientId;
      wsSubscriptions[i].boardMode = false;
      wsSubscriptions[i].boardAuthOk = false;
      wsSubscriptions[i].cardId[0] = '\0';
      return &wsSubscriptions[i];
    }
  }
  return nullptr;
}

void removeWsSubscription(uint32_t clientId) {
  WsSubscription* sub = findWsSubscription(clientId);
  if (sub) clearWsSubscription(*sub);
}

void setWsSubscription(uint32_t clientId, bool boardMode, bool boardAuthOk, const char* cardId) {
  WsSubscription* sub = ensureWsSubscription(clientId);
  if (!sub) return;
  sub->boardMode = boardMode;
  sub->boardAuthOk = boardAuthOk;
  sub->cardId[0] = '\0';
  if (!boardMode && cardId && *cardId) {
    CardSession* card = findCardSessionById(cardId);
    if (card) {
      strncpy(sub->cardId, card->cardId, sizeof(sub->cardId) - 1);
      sub->cardId[sizeof(sub->cardId) - 1] = '\0';
    }
  }
}

bool canChangeGameTypeNow() {
  return !gameEstablished || winnerDeclared;
}

bool isBoardTokenValid(const char* token) {
  if (!isBoardAuthValid()) return false;
  if (!token || token[0] == '\0') return false;
  return strcmp(token, boardAuthToken) == 0;
}

bool validateBingoCardNumbers(const int nums[25]) {
  static const int colMin[5] = {1, 16, 31, 46, 61};
  static const int colMax[5] = {15, 30, 45, 60, 75};
  // FREE always at center; blanks (0) allowed elsewhere.
  if (nums[12] != 0) return false;
  bool seenGlobal[76] = {false};
  int populated = 0;
  for (int col = 0; col < 5; col++) {
    bool seenCol[15] = {false};
    for (int row = 0; row < 5; row++) {
      const int idx = row * 5 + col;
      const int n = nums[idx];
      if (n == 0) continue;
      if (n < colMin[col] || n > colMax[col]) return false;
      const int offset = n - colMin[col];
      if (offset < 0 || offset >= 15 || seenCol[offset] || seenGlobal[n]) return false;
      seenCol[offset] = true;
      seenGlobal[n] = true;
      populated++;
    }
  }
  return populated >= 1 && populated <= 25;
}

/** Content-addressed id from card numbers — QR payload is the identity; no print registry. */
void cardIdFromCardNumbers(const int nums[25], char* out, size_t len) {
  uint32_t h = 2166136261u;
  for (int i = 0; i < 25; i++) {
    h ^= (uint8_t)(nums[i] & 0xFF);
    h *= 16777619u;
  }
  snprintf(out, len, "c%08x", (unsigned)h);
}

void syncSessionMarksFromCalled(CardSession& s) {
  for (int i = 0; i < 25; i++) {
    if (i == 12) {
      s.marks[i] = true;
      continue;
    }
    const int n = s.numbers[i];
    s.marks[i] = (n >= 1 && n <= 75 && called[n]);
  }
}

void syncSessionMarksFreeOnly(CardSession& s) {
  for (int i = 0; i < 25; i++) {
    s.marks[i] = (i == 12);
  }
}

void enqueueWebhookJob(const WebhookJob& job) {
  if (webhookQueueCount >= WEBHOOK_QUEUE_SIZE) {
    // Drop oldest to keep the board responsive under bursty calls.
    webhookQueueHead = (uint8_t)((webhookQueueHead + 1) % WEBHOOK_QUEUE_SIZE);
    webhookQueueCount--;
  }
  webhookQueue[webhookQueueTail] = job;
  webhookQueueTail = (uint8_t)((webhookQueueTail + 1) % WEBHOOK_QUEUE_SIZE);
  webhookQueueCount++;
}

void enqueueWebhookNumberCalled(int number) {
  if (webhookNumberUrlBuf[0] == '\0') return;
  if (number < 1 || number > 75) return;
  WebhookJob job = {};
  job.kind = WH_NUMBER;
  job.number = (uint8_t)number;
  enqueueWebhookJob(job);
}

void enqueueWebhookBingo(int triggeringNumber) {
  if (webhookBingoUrlBuf[0] == '\0') return;
  WebhookJob job = {};
  job.kind = WH_BINGO;
  job.number = (triggeringNumber >= 1 && triggeringNumber <= 75) ? (uint8_t)triggeringNumber : 0;
  job.winnerCount = (uint8_t)((winnerCount < 0) ? 0 : (winnerCount > 255 ? 255 : winnerCount));
  job.winnerEventId = winnerEventId;
  enqueueWebhookJob(job);
}

bool postWebhookJson(const char* url, const String& body) {
  if (!url || url[0] == '\0' || !wifiStaConnected) return false;
  HTTPClient http;
  http.setTimeout(2500);
  http.setConnectTimeout(2000);
  bool began = false;
  if (strncmp(url, "https://", 8) == 0) {
    WiFiClientSecure client;
    client.setInsecure();
    began = http.begin(client, url);
  } else if (strncmp(url, "http://", 7) == 0) {
    began = http.begin(url);
  } else {
    return false;
  }
  if (!began) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "BingoFlashboard/1.0");
  const int code = http.POST(body);
  http.end();
  return code > 0 && code < 400;
}

void processWebhookQueue() {
  if (!wifiStaConnected || webhookQueueCount == 0 || webhookRequestInFlight) return;
  webhookRequestInFlight = true;
  WebhookJob job = webhookQueue[webhookQueueHead];
  webhookQueueHead = (uint8_t)((webhookQueueHead + 1) % WEBHOOK_QUEUE_SIZE);
  webhookQueueCount--;

  StaticJsonDocument<256> doc;
  String body;
  bool ok = false;
  if (job.kind == WH_NUMBER && webhookNumberUrlBuf[0] != '\0') {
    doc["event"] = "number_called";
    doc["number"] = job.number;
    char letter[2] = { bingoLetterForNumber(job.number), '\0' };
    doc["letter"] = letter;
    doc["calledCount"] = callOrderCount;
    doc["gameType"] = gameType;
    serializeJson(doc, body);
    ok = postWebhookJson(webhookNumberUrlBuf, body);
    (void)ok;
  } else if (job.kind == WH_BINGO && webhookBingoUrlBuf[0] != '\0') {
    doc["event"] = "bingo_identified";
    doc["winnerCount"] = job.winnerCount;
    doc["winnerEventId"] = job.winnerEventId;
    doc["gameType"] = gameType;
    if (job.number >= 1) doc["number"] = job.number;
    serializeJson(doc, body);
    ok = postWebhookJson(webhookBingoUrlBuf, body);
    (void)ok;
  }
  webhookRequestInFlight = false;
}

void resetSessionClaimedMasks(CardSession& s) {
  for (int i = 0; i < GAME_TYPE_COUNT; i++) s.claimedPatternMasks[i] = 0;
  s.eliminated = false;
}

bool wsCanReceiveState(uint32_t clientId) {
  WsSubscription* sub = findWsSubscription(clientId);
  if (!sub) return false;
  if (sub->boardMode) return sub->boardAuthOk;
  if (sub->cardId[0] == '\0') return false;
  return findCardSessionById(sub->cardId) != nullptr;
}

bool wsCanReceiveCardState(uint32_t clientId, const char* cardId) {
  WsSubscription* sub = findWsSubscription(clientId);
  if (!sub) return false;
  if (sub->boardMode) return sub->boardAuthOk;
  if (!cardId || !*cardId) return false;
  return strcmp(sub->cardId, cardId) == 0 && findCardSessionById(cardId) != nullptr;
}

bool isPatternCellSatisfied(const CardSession& s, int idx) {
  if (idx < 0 || idx >= 25) return false;
  if (idx == 12) return true;  // FREE center
  if (!s.marks[idx]) return false;
  int n = s.numbers[idx];
  if (n < 1 || n > 75) return false;
  return called[n];
}

bool maskFullySatisfied(const CardSession& s, uint32_t cellMask) {
  for (int i = 0; i < 25; i++) {
    if (!(cellMask & (1u << i))) continue;
    // Blank cells on sparse cards do not block the pattern.
    if (i != 12 && s.numbers[i] == 0) continue;
    if (!isPatternCellSatisfied(s, i)) return false;
  }
  return true;
}

int countCoveredCells(const CardSession& s) {
  int n = 0;
  for (int i = 0; i < 25; i++) if (isPatternCellSatisfied(s, i)) n++;
  return n;
}

uint32_t satisfiedMaskForCurrentGameType(const CardSession& s) {
  const GameTypeDef* def = currentGameTypeDef();
  if (!def) return 0;
  if (def->coveredThreshold > 0) {
    return countCoveredCells(s) >= def->coveredThreshold ? 1u : 0u;
  }
  uint32_t mask = 0;
  for (int a = 0; a < def->winCount && a < GAME_TYPE_MAX_WIN_ALTS; a++) {
    uint32_t cells = gameTypeWinMaskAt(def, a);
    if (maskFullySatisfied(s, cells)) mask |= (1u << a);
  }
  return mask;
}

uint32_t& claimedMaskForCurrentGameType(CardSession& s) {
  if (gameTypeIdx < 0 || gameTypeIdx >= GAME_TYPE_COUNT) {
    gameTypeIdx = findGameTypeIndex(gameType);
    if (gameTypeIdx < 0) gameTypeIdx = 0;
  }
  return s.claimedPatternMasks[gameTypeIdx];
}

bool cardAllPopulatedCalled(const CardSession& s) {
  int populated = 0;
  for (int i = 0; i < 25; i++) {
    int n = s.numbers[i];
    if (n < 1 || n > 75) continue;
    populated++;
    if (!called[n]) return false;
  }
  return populated > 0;
}

bool sessionHasWinningPattern(CardSession& s) {
  if (isBattleshipGameType()) return s.winner;
  const GameTypeDef* def = currentGameTypeDef();
  const uint32_t satisfied = satisfiedMaskForCurrentGameType(s);
  const uint32_t claimed = claimedMaskForCurrentGameType(s);
  const uint32_t available = satisfied & ~claimed;
  const int required = def ? def->requiredPatterns : 1;
  if (required > 1) {
    return __builtin_popcount((unsigned int)available) >= required;
  }
  return available != 0;
}

void claimCurrentWinningPatterns(CardSession& s) {
  if (isBattleshipGameType()) {
    // Keep-going: dismiss battleship prize for this session.
    claimedMaskForCurrentGameType(s) = 1u;
    s.winner = false;
    return;
  }
  uint32_t& claimed = claimedMaskForCurrentGameType(s);
  claimed |= satisfiedMaskForCurrentGameType(s);
}

void syncWinnerDeclared() {
  const bool want = !winnerSuppressed && (manualWinnerDeclared || (winnerCount > 0));
  if (!want) {
    winnerDeclared = false;
    pendingWinnerActivation = false;
    pendingWinnerEventBump = false;
    return;
  }
  // When the board is mid call-out (hold + wait-for-audio), defer winner mode so
  // the number finishes speaking before bingo audio / sparkle / dialog.
  if (autoCallingWaitForAudio && autoCallingHold && !winnerDeclared) {
    pendingWinnerActivation = true;
    return;
  }
  winnerDeclared = true;
  pendingWinnerActivation = false;
}

void flushPendingWinnerActivation() {
  if (!pendingWinnerActivation) return;
  pendingWinnerActivation = false;
  const bool want = !winnerSuppressed && (manualWinnerDeclared || (winnerCount > 0));
  if (!want) {
    pendingWinnerEventBump = false;
    winnerDeclared = false;
    return;
  }
  if (pendingWinnerEventBump) {
    winnerEventId++;
    pendingWinnerEventBump = false;
  }
  winnerDeclared = true;
}

int getActiveCardCount() {
  int count = 0;
  for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
    if (cardSessions[i].active) count++;
  }
  return count;
}

void recomputeCardWinners() {
  winnerCount = 0;
  survivorCount = 0;
  eliminatedCount = 0;
  bool hasNewWinnerEvent = false;

  if (isBattleshipGameType()) {
    int afloatBefore = 0;
    bool wasEliminated[MAX_CARD_SESSIONS];
    for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
      wasEliminated[i] = false;
      if (!cardSessions[i].active) continue;
      wasEliminated[i] = cardSessions[i].eliminated;
      if (!cardSessions[i].eliminated) afloatBefore++;
    }

    int justSunk[MAX_CARD_SESSIONS];
    int justSunkCount = 0;
    for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
      if (!cardSessions[i].active) continue;
      const bool sunk = cardAllPopulatedCalled(cardSessions[i]);
      if (sunk && !cardSessions[i].eliminated) {
        cardSessions[i].eliminated = true;
        justSunk[justSunkCount++] = i;
      }
      if (cardSessions[i].eliminated) eliminatedCount++;
      else survivorCount++;
    }

    for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
      if (!cardSessions[i].active) continue;
      const bool wasWinner = cardSessions[i].winner;
      bool win = false;
      if (claimedMaskForCurrentGameType(cardSessions[i]) == 0) {
        if (survivorCount == 1 && eliminatedCount >= 1 && !cardSessions[i].eliminated) {
          win = true;
        } else if (survivorCount == 0 && justSunkCount > 0) {
          // Final call sank all remaining ships → co-winners among just-sunk.
          for (int j = 0; j < justSunkCount; j++) {
            if (justSunk[j] == i) { win = true; break; }
          }
        }
      }
      cardSessions[i].winner = win;
      if (!wasWinner && win) hasNewWinnerEvent = true;
      if (win) winnerCount++;
    }
    (void)afloatBefore;
    (void)wasEliminated;
  } else {
    for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
      if (!cardSessions[i].active) continue;
      const bool wasWinner = cardSessions[i].winner;
      cardSessions[i].winner = sessionHasWinningPattern(cardSessions[i]);
      if (!wasWinner && cardSessions[i].winner) hasNewWinnerEvent = true;
      if (cardSessions[i].winner) winnerCount++;
    }
  }

  if (winnerSuppressed && hasNewWinnerEvent) {
    winnerSuppressed = false;
  }
  if (hasNewWinnerEvent) {
    if (autoCallingWaitForAudio && autoCallingHold && !winnerDeclared) {
      pendingWinnerEventBump = true;
    } else {
      winnerEventId++;
    }
    enqueueWebhookBingo(currentNumber);
  }
  syncWinnerDeclared();
}

// Game-type pattern: fill physical indices for current gameType
void getGameTypePhysicalIndices(int* out, int* count) {
  *count = 0;
  auto add = [&](int cell) {
    if (*count >= 25) return;
    int p = gameTypeCellToPhysical(cell);
    if (p >= 0) {
      for (int i = 0; i < *count; i++) if (out[i] == p) return;
      out[(*count)++] = p;
    }
  };

  if (strcmp(gameType, "battleship") == 0) {
    // Continuous chase 1→25 at PATTERN_CYCLE_MS per cell (loops like pattern orientations).
    if (battleshipChaseStartMs == 0) {
      battleshipChaseStartMs = millis();
    }
    const unsigned long ms = millis() - battleshipChaseStartMs;
    int cell = (int)((ms / PATTERN_CYCLE_MS) % 25UL) + 1;
    add(cell);
    return;
  }

  const GameTypeDef* def = currentGameTypeDef();
  if (!def || def->displayCount <= 0) return;
  int idx = patternIdx % def->displayCount;
  uint32_t cells = gameTypeDisplayMaskAt(def, idx);
  for (int bit = 0; bit < 25; bit++) {
    if (cells & (1u << bit)) add(bit + 1);
  }
}

// ─── Theme system ───────────────────────────────────────────────────
// 8 base palettes stored in RAM; 19 themes (8 static + 11 animated)
// reference these palettes via a lookup table.  All alphabetized.

const int NUM_PALETTES = 8;
CRGBPalette16 themePalettes[NUM_PALETTES];
// Palette indices: 0=Rainbow, 1=RainbowStripe, 2=Party, 3=Heat,
//                  4=Lava, 5=Ocean, 6=Forest, 7=Cloud

void initThemePalettes() {
  themePalettes[0] = RainbowColors_p;
  themePalettes[1] = RainbowStripeColors_p;
  themePalettes[2] = PartyColors_p;
  themePalettes[3] = HeatColors_p;
  themePalettes[4] = LavaColors_p;
  themePalettes[5] = OceanColors_p;
  themePalettes[6] = ForestColors_p;
  themePalettes[7] = CloudColors_p;
}

// Animation types
enum AnimType : uint8_t {
  ANIM_NONE = 0,
  ANIM_RAINBOW_CYCLE,   // 1  smooth color shift
  ANIM_BREATHE,         // 2  slow brightness pulse
  ANIM_CANDY_CHASE,     // 3  party palette chase
  ANIM_COLOR_WAVE,      // 4  sine wave ripple across columns
  ANIM_FIRE,            // 5  random flicker
  ANIM_GOLD_SHIMMER,    // 6  gold with random sparkle
  ANIM_HEARTBEAT,       // 7  double-pulse (lub-dub)
  ANIM_ICE_SHIMMER,     // 8  cool blue shimmer
  ANIM_NORTHERN_LIGHTS, // 9  slow organic drift
  ANIM_RETRO_ARCADE,    // 10 fast neon flash
  ANIM_SPARKLE,         // 11 random twinkle
};

// All 19 themes — alphabetical order
const int NUM_THEMES = 19;
const char* const THEME_NAMES[] = {
  "Animated Rainbow",  // 0
  "Breathe",           // 1
  "Candy",             // 2
  "Cloud",             // 3
  "Color Wave",        // 4
  "Fire",              // 5
  "Forest",            // 6
  "Gold Shimmer",      // 7
  "Heat",              // 8
  "Heartbeat",         // 9
  "Ice",               // 10
  "Lava",              // 11
  "Northern Lights",   // 12
  "Ocean",             // 13
  "Party",             // 14
  "Rainbow",           // 15
  "Rainbow Stripe",    // 16
  "Retro Arcade",      // 17
  "Sparkle",           // 18
};

// Base palette index (into themePalettes[]) for each theme
const uint8_t THEME_PALETTE[] = {
//  AR  Br  Ca  Cl  CW  Fi  Fo  GS  He  Hb  Ic  La  NL  Oc  Pa  Rn  RS  RA  Sp
    0,  0,  2,  7,  0,  3,  6,  0,  3,  4,  5,  4,  6,  5,  2,  0,  1,  2,  0,
};

// Animation type for each theme (ANIM_NONE = static palette)
const uint8_t THEME_ANIM[] = {
    1,  2,  3,  0,  4,  5,  0,  6,  0,  7,  8,  0,  9,  0,  0,  0,  0, 10, 11,
};

// ─── Heartbeat waveform ─────────────────────────────────────────────
// Double-pulse (lub-dub) then rest.  Phase 0–255 → brightness 0–255.
uint8_t heartbeatWave(uint8_t phase) {
  if (phase < 64) {
    return sin8(phase * 4);               // first beat (lub)
  }
  if (phase >= 80 && phase < 144) {
    return scale8(sin8((phase - 80) * 4), 180); // second beat (dub), softer
  }
  return 30;  // rest — dim baseline glow
}

// ─── Color helpers ──────────────────────────────────────────────────
CRGB goldShimmerColor(uint8_t salt) {
  CRGB gold = CRGB(255, 200, 50);
  const uint8_t twinkle = random8() + salt;
  gold.nscale8(twinkle < 40 ? 255 : random8(150, 235));
  return gold;
}

CRGB colorForCalledNumber(int n) {
  if (winnerDeclared) {
    return goldShimmerColor((uint8_t)(n * 7));
  }
  if (strcmp(colorMode, "solid") == 0) {
    return solidColorForStrip();
  }
  if (strcmp(colorMode, "custom") == 0) {
    return customLetterColorForLetter(numberToLetter(n));
  }

  int t = themeId % NUM_THEMES;
  uint8_t pal = THEME_PALETTE[t];
  uint8_t anim = THEME_ANIM[t];
  uint8_t index = map(n, 1, 75, 0, 255);

  switch (anim) {
    case ANIM_NONE:
      return ColorFromPalette(themePalettes[pal], index, 255, LINEARBLEND);

    case ANIM_RAINBOW_CYCLE: {
      uint8_t off = beat8(30);
      return ColorFromPalette(themePalettes[pal], index + off, 255, LINEARBLEND);
    }
    case ANIM_BREATHE: {
      uint8_t bright = beatsin8(15, 80, 255);
      return ColorFromPalette(themePalettes[pal], index, bright, LINEARBLEND);
    }
    case ANIM_CANDY_CHASE: {
      uint8_t chase = beat8(40) + index;
      return ColorFromPalette(themePalettes[pal], chase, 255, LINEARBLEND);
    }
    case ANIM_COLOR_WAVE: {
      int col = (n - 1) / 15;  // 0–4 for B I N G O
      uint8_t wave = beatsin8(20, 0, 255, 0, col * 50);
      return ColorFromPalette(themePalettes[pal], index + wave, 255, LINEARBLEND);
    }
    case ANIM_FIRE: {
      uint8_t flicker = random8(180, 255);
      return ColorFromPalette(themePalettes[pal], index, flicker, LINEARBLEND);
    }
    case ANIM_GOLD_SHIMMER: {
      CRGB gold = CRGB(255, 200, 50);
      gold.nscale8(random8() < 30 ? 255 : random8(120, 200));
      return gold;
    }
    case ANIM_HEARTBEAT: {
      uint8_t bright = heartbeatWave(beat8(72));
      return ColorFromPalette(themePalettes[pal], index, bright, LINEARBLEND);
    }
    case ANIM_ICE_SHIMMER: {
      uint8_t shimmer = beatsin8(25, 140, 255, 0, n * 7);
      return ColorFromPalette(themePalettes[pal], index, shimmer, LINEARBLEND);
    }
    case ANIM_NORTHERN_LIGHTS: {
      uint8_t drift = beat8(8);
      uint8_t bright = beatsin8(12, 160, 255, 0, n * 5);
      return ColorFromPalette(themePalettes[pal], index + drift, bright, LINEARBLEND);
    }
    case ANIM_RETRO_ARCADE: {
      uint8_t pulse = beat8(120);
      uint8_t bright = pulse < 128 ? 255 : 100;
      return ColorFromPalette(themePalettes[pal], index + beat8(60), bright, LINEARBLEND);
    }
    case ANIM_SPARKLE: {
      uint8_t bright = random8() < 40 ? 255 : random8(60, 160);
      return ColorFromPalette(themePalettes[pal], index, bright, LINEARBLEND);
    }
    default:
      return ColorFromPalette(themePalettes[pal], index, 255, LINEARBLEND);
  }
}

CRGB colorForLetter(char letter) {
  if (winnerDeclared) {
    return goldShimmerColor((uint8_t)letter);
  }
  // BINGO header LEDs use a dedicated color independent of active number theme.
  return headerLetterColorForStrip();
}

void applyGameTypeToMatrix() {
  int indices[25];
  int n = 0;
  getGameTypePhysicalIndices(indices, &n);
  CRGB indicatorColor = gameTypeIndicatorColorForStrip();
  // Clear only the physical LEDs that belong to logical game-type cells.
  // Mapping is no longer guaranteed to be a contiguous index range.
  for (int cell = 1; cell <= 25; cell++) {
    int p = gameTypeCellToPhysical(cell);
    if (p >= 0 && p < NUM_LEDS) leds[p] = CRGB::Black;
  }
  for (int i = 0; i < n; i++) leds[indices[i]] = indicatorColor;
}

void lightLedTestLetters(CRGB color) {
  const char* letters = "BINGO";
  for (int i = 0; i < 5; i++) {
    int p = letterToPhysical(letters[i]);
    if (p >= 0 && p < NUM_LEDS) leds[p] = color;
  }
}

void lightLedTestNumbers(CRGB color) {
  for (int n = 1; n <= 75; n++) {
    int p = numberToPhysical(n);
    if (p >= 0 && p < NUM_LEDS) leds[p] = color;
  }
}

void lightLedTestGameType(CRGB color) {
  for (int cell = 1; cell <= 25; cell++) {
    int p = gameTypeCellToPhysical(cell);
    if (p >= 0 && p < NUM_LEDS) leds[p] = color;
  }
}

void lightLedTestAllSections() {
  // Distinct colors so each section is obvious while lit together.
  lightLedTestLetters(CRGB::Red);
  lightLedTestNumbers(CRGB::Lime);
  lightLedTestGameType(CRGB::Blue);
}

void initLedTestSequence() {
  // Sequence is phase-driven; no flat index list needed.
}

void resetLedTestSequence() {
  ledTestPhase = 0;
  ledTestStepIdx = 0;
  ledTestLastStepMs = millis();
  ledTestPhaseStartedMs = millis();
}

void updateLedTestMode() {
  unsigned long now = millis();
  const CRGB letterColor = CRGB::Red;
  const CRGB numberColor = CRGB::Lime;
  const CRGB gameTypeColor = CRGB::Blue;

  // Phase 3: all sections lit together (hold, then restart cycle — no pulse finale).
  if (ledTestPhase == 3) {
    lightLedTestAllSections();
    if ((now - ledTestPhaseStartedMs) >= LED_TEST_ALL_HOLD_MS) {
      ledTestPhase = 0;
      ledTestStepIdx = 0;
      ledTestLastStepMs = now;
      ledTestPhaseStartedMs = now;
    }
    return;
  }

  if ((now - ledTestLastStepMs) >= LED_TEST_STEP_MS) {
    ledTestLastStepMs = now;
    ledTestStepIdx++;

    int phaseLen = 5;
    if (ledTestPhase == 1) phaseLen = 75;
    else if (ledTestPhase == 2) phaseLen = 25;

    if (ledTestStepIdx >= phaseLen) {
      ledTestPhase++;
      ledTestStepIdx = 0;
      ledTestPhaseStartedMs = now;
      if (ledTestPhase > 3) {
        ledTestPhase = 0;
        ledTestPhaseStartedMs = now;
      }
    }
  }

  if (ledTestPhase == 0) {
    // Letters alone — B I N G O in order.
    const char* letters = "BINGO";
    int idx = ledTestStepIdx;
    if (idx < 0) idx = 0;
    if (idx > 4) idx = 4;
    int p = letterToPhysical(letters[idx]);
    if (p >= 0 && p < NUM_LEDS) leds[p] = letterColor;
  } else if (ledTestPhase == 1) {
    // Numbers alone — 1..75 in order.
    int n = ledTestStepIdx + 1;
    if (n < 1) n = 1;
    if (n > 75) n = 75;
    int p = numberToPhysical(n);
    if (p >= 0 && p < NUM_LEDS) leds[p] = numberColor;
  } else if (ledTestPhase == 2) {
    // Game-type matrix alone — cells 1..25 in order.
    int cell = ledTestStepIdx + 1;
    if (cell < 1) cell = 1;
    if (cell > 25) cell = 25;
    int p = gameTypeCellToPhysical(cell);
    if (p >= 0 && p < NUM_LEDS) leds[p] = gameTypeColor;
  }
}

void updateAllLeds() {
  FastLED.clear();
  FastLED.setBrightness(brightness ? brightness : DEFAULT_BRIGHTNESS);

  if (ledTestMode) {
    updateLedTestMode();
    return;
  }

  if (screensaverEnabled) {
    renderScreensaverFrame();
    return;
  }

  if (!winnerDeclared) {
    winnerAnimActive = false;
    winnerAnimPhase = WINNER_PHASE_BOARD;
    winnerScrollOffsetCols = 0;
    winnerScrollShownThisRound = false;
  } else {
    unsigned long now = millis();
    if (!winnerAnimActive) {
      winnerAnimActive = true;
      winnerAnimPhase = WINNER_PHASE_BOARD;
      winnerPhaseStartedMs = now;
      winnerScrollLastStepMs = now;
      winnerScrollOffsetCols = 0;
      winnerScrollShownThisRound = false;
    }

    if (winnerAnimPhase == WINNER_PHASE_BOARD) {
      renderEffectFrame(winnerEffectType);
      if (!winnerScrollShownThisRound && (now - winnerPhaseStartedMs) >= WINNER_BOARD_PHASE_MS) {
        winnerAnimPhase = WINNER_PHASE_SCROLL;
        winnerScrollLastStepMs = now;
        winnerScrollOffsetCols = 0;
      }
      return;
    }

    if (renderWinnerScrollFrame("WINNER")) {
      winnerAnimPhase = WINNER_PHASE_BOARD;
      winnerPhaseStartedMs = now;
      winnerScrollOffsetCols = 0;
      winnerScrollShownThisRound = true;
    }
    return;
  }

  renderGameBoardFrame();
}

#if STATUS_LED_ENABLED
void setStatusLed(bool on) {
  digitalWrite(STATUS_LED_PIN, STATUS_LED_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
}

void initStatusLed() {
  gpio_reset_pin((gpio_num_t)STATUS_LED_PIN);
  pinMode(STATUS_LED_PIN, OUTPUT);
  setStatusLed(false);
}

void blinkStatusLedBootProbe() {
#if STATUS_LED_BOOT_PROBE
  pinMode(STATUS_LED_PIN, OUTPUT);
  for (int i = 0; i < 2; i++) {
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(120);
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(120);
  }
  delay(150);
  for (int i = 0; i < 2; i++) {
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(120);
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(120);
  }
  setStatusLed(false);
#else
  (void)0;
#endif
}
#endif

bool autoCallingCanDrawNow() {
  return autoCallingEnabled &&
         !autoCallingHold &&
         strcmp(callingStyle, "automatic") == 0 &&
         !winnerDeclared &&
         poolCount > 0;
}

uint32_t autoCallingRemainingMsNow() {
  if (!autoCallingEnabled || strcmp(callingStyle, "automatic") != 0) return 0;
  // Countdown keeps running while audio plays (hold only blocks the next draw).
  if (autoCallingNextDrawMs == 0) return 0;
  unsigned long now = millis();
  if (now >= autoCallingNextDrawMs) return 0;
  return (uint32_t)(autoCallingNextDrawMs - now);
}

void setAutoCallingHold(bool hold) {
  if (autoCallingHold == hold) return;
  autoCallingHold = hold;
  if (hold) {
    autoCallingHoldSinceMs = millis();
    broadcastStateWs("auto_calling_changed");
    return;
  }
  // Do not reschedule the interval — if the deadline already passed while audio
  // played, the next loop iteration draws immediately.
  autoCallingHoldSinceMs = 0;
  const bool hadPendingWinner = pendingWinnerActivation;
  flushPendingWinnerActivation();
  broadcastStateWs(hadPendingWinner ? "winner_changed" : "auto_calling_changed");
}

/** Enable/disable auto-call. Play immediately draws (like Draw next), then arms the interval. */
void applyAutoCallingEnabled(bool enabled) {
  autoCallingEnabled = enabled;
  autoCallingHold = false;
  autoCallingHoldSinceMs = 0;
  if (!enabled) {
    autoCallingNextDrawMs = 0;
    broadcastStateWs("auto_calling_changed");
    return;
  }

  // Play = draw now, then count down to the following call.
  if (!winnerDeclared && poolCount > 0) {
    if (!gameEstablished) gameEstablished = true;
    int n = drawNext();
    if (n < 0) {
      autoCallingEnabled = false;
      autoCallingNextDrawMs = 0;
      broadcastStateWs("auto_calling_changed");
      return;
    }
    autoCallingNextDrawMs = millis() + (unsigned long)autoCallingSeconds * 1000UL;
    if (autoCallingWaitForAudio) {
      autoCallingHold = true;
      autoCallingHoldSinceMs = millis();
    }
  } else {
    autoCallingNextDrawMs = millis() + (unsigned long)autoCallingSeconds * 1000UL;
  }
  broadcastStateWs("auto_calling_changed");
}

int drawNext() {
  if (poolCount <= 0) return -1;
  disableScreensaverForDraw();
  if (!gameEstablished) gameEstablished = true;
  int idx = (int)uniformRandomBelow((uint32_t)poolCount);
  int k = 0;
  for (int n = 1; n <= 75; n++) {
    if (!pool[n]) continue;
    if (k == idx) {
      pool[n] = false;
      poolCount--;
      called[n] = true;
      currentNumber = n;
      startCalledNumberBanner(n);
      winnerSuppressed = false;
      if (callOrderCount < 75) {
        callOrder[callOrderCount++] = n;
      }
      recomputeCardWinners();
      saveGameStateSnapshot();
      updateAllLeds();
      enqueueWebhookNumberCalled(n);
      broadcastStateWs("number_called");
      broadcastAllCardStatesWs("card_state");
      return n;
    }
    k++;
  }
  return -1;
}

bool undoLastCall() {
  if (callOrderCount <= 0) return false;

  int last = callOrder[--callOrderCount];
  if (last < 1 || last > 75 || !called[last]) return false;

  called[last] = false;
  if (!pool[last]) {
    pool[last] = true;
    poolCount++;
  }
  currentNumber = (callOrderCount > 0) ? callOrder[callOrderCount - 1] : 0;
  clearCalledNumberBanner();
  manualWinnerDeclared = false;
  // Undo keeps the current game session active, even at zero calls.
  gameEstablished = true;
  recomputeCardWinners();
  saveGameStateSnapshot();
  updateAllLeds();
  broadcastStateWs("number_undone");
  broadcastAllCardStatesWs("card_state");
  return true;
}

void doReset() {
  if (ledTestMode) {
    ledTestMode = false;
    resetLedTestSequence();
  }
  winnerAnimActive = false;
  winnerAnimPhase = WINNER_PHASE_BOARD;
  winnerScrollOffsetCols = 0;
  winnerScrollShownThisRound = false;
  patternIdx = 0;
  lastPatternChange = millis();
  autoCallingEnabled = false;
  autoCallingHold = false;
  autoCallingWaitForAudio = false;
  autoCallingNextDrawMs = 0;
  autoCallingHoldSinceMs = 0;

  for (int i = 1; i <= 75; i++) {
    pool[i] = true;
    called[i] = false;
  }
  poolCount = 75;
  callOrderCount = 0;
  currentNumber = 0;
  clearCalledNumberBanner();
  boardSeed = (uint16_t)random(1000, 10000);
  gameEstablished = false;
  manualWinnerDeclared = false;
  winnerSuppressed = false;
  winnerEventId = 0;
  pendingWinnerActivation = false;
  pendingWinnerEventBump = false;
  for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
    if (!cardSessions[i].active) continue;
    for (int c = 0; c < 25; c++) cardSessions[i].marks[c] = (c == 12);
    cardSessions[i].winner = false;
    for (int m = 0; m < GAME_TYPE_COUNT; m++) cardSessions[i].claimedPatternMasks[m] = 0;
  }
  winnerCount = 0;
  syncWinnerDeclared();
  updateAllLeds();
  broadcastStateWs("game_reset");
  deferResetPersistence = true;
}

void flushDeferredResetWork() {
  if (!deferResetPersistence) return;
  deferResetPersistence = false;
  saveGameStateSnapshot();
  broadcastAllCardStatesWs("card_state");
}

void saveGameStateSnapshot() {
  PersistedGameState snap{};
  snap.magic = GAME_STATE_MAGIC;
  snap.version = GAME_STATE_VERSION;
  snap.boardSeed = boardSeed;
  snap.gameEstablished = gameEstablished ? 1 : 0;
  snap.callOrderCount = (uint8_t)callOrderCount;
  snap.currentNumber = (uint8_t)((currentNumber >= 0 && currentNumber <= 75) ? currentNumber : 0);
  for (int i = 0; i < callOrderCount && i < 75; i++) {
    snap.callOrder[i] = (uint8_t)callOrder[i];
  }

  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return;
  nvs_set_blob(nvs, NVS_GAME_STATE, &snap, sizeof(snap));
  nvs_commit(nvs);
  nvs_close(nvs);
}

bool loadGameStateSnapshot() {
  PersistedGameState snap{};
  size_t len = sizeof(snap);
  if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs) != ESP_OK) return false;
  esp_err_t err = nvs_get_blob(nvs, NVS_GAME_STATE, &snap, &len);
  nvs_close(nvs);
  if (err != ESP_OK || len != sizeof(snap)) return false;
  if (snap.magic != GAME_STATE_MAGIC || snap.version != GAME_STATE_VERSION) return false;
  if (snap.callOrderCount > 75) return false;

  for (int i = 1; i <= 75; i++) {
    called[i] = false;
    pool[i] = true;
  }
  callOrderCount = 0;

  for (int i = 0; i < snap.callOrderCount; i++) {
    int n = snap.callOrder[i];
    if (n < 1 || n > 75) return false;
    if (called[n]) return false;
    called[n] = true;
    pool[n] = false;
    callOrder[callOrderCount++] = n;
  }

  poolCount = 75 - callOrderCount;
  currentNumber = (callOrderCount > 0) ? callOrder[callOrderCount - 1] : 0;
  if (snap.currentNumber >= 1 && snap.currentNumber <= 75 && called[snap.currentNumber]) {
    currentNumber = snap.currentNumber;
  }
  boardSeed = (snap.boardSeed >= 1000) ? snap.boardSeed : (uint16_t)random(1000, 10000);
  gameEstablished = (snap.gameEstablished != 0) || (callOrderCount > 0);

  // Winner/card-session runtime state is intentionally not restored on reboot.
  manualWinnerDeclared = false;
  winnerSuppressed = false;
  winnerEventId = 0;
  winnerCount = 0;
  syncWinnerDeclared();
  return true;
}

void startMdns() {
  if (MDNS.begin("bingo")) {
    MDNS.addService("http", "tcp", 80);
    Serial.println("mDNS started: http://bingo.local");
  } else {
    Serial.println("mDNS start failed");
  }
}

void setupWiFi() {
  if (staSsidBuf[0] != '\0') {
    Serial.printf("Attempting WiFi STA: %s\n", staSsidBuf);
    WiFi.mode(WIFI_STA);
    WiFi.begin(staSsidBuf, staPasswordBuf);
    const unsigned long startMs = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < WIFI_STA_CONNECT_TIMEOUT_MS) {
      delay(250);
      Serial.print(".");
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
      wifiStaConnected = true;
      Serial.print("STA connected, IP: ");
      Serial.println(WiFi.localIP());
      startMdns();
      return;
    }
    Serial.println("STA connect failed, falling back to AP");
    WiFi.disconnect(true);
    delay(100);
  }

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  wifiStaConnected = false;
  Serial.println("AP started: " AP_SSID " – open http://192.168.4.1");
  startMdns();
}

void loadNvs() {
  // Always apply fixed visual order before any NVS read. After a fresh erase the
  // "bingo" namespace may not exist yet, so nvs_open fails and we must not skip this.
  boardSectionOrder[0] = SEC_LETTERS;
  boardSectionOrder[1] = SEC_NUMBERS;
  boardSectionOrder[2] = SEC_GAME_TYPE;
  recomputeSectionStarts();

  if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs) != ESP_OK) return;
  uint8_t br;
  if (nvs_get_u8(nvs, NVS_BRIGHTNESS, &br) == ESP_OK) brightness = br;
  uint8_t lv;
  if (nvs_get_u8(nvs, NVS_LED_VIBRANCE, &lv) == ESP_OK) {
    ledVibrance = (lv <= 100) ? lv : DEFAULT_LED_VIBRANCE;
  }
  uint8_t se;
  if (nvs_get_u8(nvs, NVS_SCREENSAVER_ENABLED, &se) == ESP_OK) screensaverEnabled = (se != 0);
  uint8_t sty;
  if (nvs_get_u8(nvs, NVS_SCREENSAVER_TYPE, &sty) == ESP_OK) {
    if (sty <= 13) screensaverType = sty;
  }
  uint8_t wet;
  if (nvs_get_u8(nvs, NVS_WINNER_EFFECT, &wet) == ESP_OK) {
    if (wet <= 13) winnerEffectType = wet;
  }
  uint32_t scr;
  if (nvs_get_u32(nvs, NVS_SCREENSAVER_COLOR, &scr) == ESP_OK) screensaverColor = scr;
  uint16_t ss;
  if (nvs_get_u16(nvs, NVS_SCREENSAVER_SPEED, &ss) == ESP_OK) {
    if (ss < 20) ss = 20;
    if (ss > 500) ss = 500;
    screensaverSpeedMs = ss;
  }
  uint16_t ac;
  if (nvs_get_u16(nvs, NVS_AUTO_CALL_SECONDS, &ac) == ESP_OK) {
    if (ac < 1) ac = 1;
    if (ac > 600) ac = 600;
    autoCallingSeconds = ac;
  }
  size_t stLen = sizeof(screensaverText);
  if (nvs_get_str(nvs, NVS_SCREENSAVER_TEXT, screensaverText, &stLen) != ESP_OK) {
    strncpy(screensaverText, "BINGO", sizeof(screensaverText) - 1);
    screensaverText[sizeof(screensaverText) - 1] = '\0';
  }
  if (nvs_get_i32(nvs, NVS_THEME, (int32_t*)&themeId) == ESP_OK) {}
  uint32_t sc;
  if (nvs_get_u32(nvs, NVS_STATIC_COLOR, &sc) == ESP_OK) staticColor = sc;
  uint32_t hc;
  if (nvs_get_u32(nvs, NVS_LED_HEADER_COLOR, &hc) == ESP_OK) letterHeaderColor = hc;
  uint32_t gc;
  if (nvs_get_u32(nvs, NVS_GAME_TYPE_LED_COLOR, &gc) == ESP_OK) gameTypeLedColor = gc;
  size_t len = sizeof(gameTypeBuf);
  if (nvs_get_str(nvs, NVS_GAME_TYPE, gameTypeBuf, &len) != ESP_OK) {
    strcpy(gameTypeBuf, "cover_all");
  }
  // Migrate old housey-only type ids (and any invalid id) → cover_all.
  // Keep battleship / four_corners when present in the bingo catalog.
  if (strcmp(gameTypeBuf, "full_house") == 0 ||
      strcmp(gameTypeBuf, "line") == 0 ||
      strcmp(gameTypeBuf, "two_lines") == 0 ||
      !isValidGameTypeId(gameTypeBuf)) {
    strcpy(gameTypeBuf, "cover_all");
  }
  applyGameTypeId(gameTypeBuf);
  size_t csLen = sizeof(callingStyleBuf);
  if (nvs_get_str(nvs, NVS_CALLING_STYLE, callingStyleBuf, &csLen) == ESP_OK) {
    if (strcmp(callingStyleBuf, "automatic") != 0 && strcmp(callingStyleBuf, "manual") != 0)
      strcpy(callingStyleBuf, "automatic");
  }
  uint8_t cm;
  if (nvs_get_u8(nvs, NVS_COLOR_MODE, &cm) == ESP_OK) {
    if (cm == 1) strcpy(colorModeBuf, "solid");
    else if (cm == 2) strcpy(colorModeBuf, "custom");
    else strcpy(colorModeBuf, "theme");
  }
  uint32_t customB;
  if (nvs_get_u32(nvs, NVS_LED_COLOR_B, &customB) == ESP_OK) customLetterColors[0] = customB;
  uint32_t customI;
  if (nvs_get_u32(nvs, NVS_LED_COLOR_I, &customI) == ESP_OK) customLetterColors[1] = customI;
  uint32_t customN;
  if (nvs_get_u32(nvs, NVS_LED_COLOR_N, &customN) == ESP_OK) customLetterColors[2] = customN;
  uint32_t customG;
  if (nvs_get_u32(nvs, NVS_LED_COLOR_G, &customG) == ESP_OK) customLetterColors[3] = customG;
  uint32_t customO;
  if (nvs_get_u32(nvs, NVS_LED_COLOR_O, &customO) == ESP_OK) customLetterColors[4] = customO;
  size_t bpLen = sizeof(boardPinBuf);
  if (nvs_get_str(nvs, NVS_BOARD_PIN, boardPinBuf, &bpLen) != ESP_OK) {
    strncpy(boardPinBuf, BOARD_DEFAULT_PIN, sizeof(boardPinBuf) - 1);
    boardPinBuf[sizeof(boardPinBuf) - 1] = '\0';
  } else {
    String loadedPin = normalizedPin(boardPinBuf);
    if (loadedPin.length() < 4 || loadedPin.length() >= sizeof(boardPinBuf)) {
      strncpy(boardPinBuf, BOARD_DEFAULT_PIN, sizeof(boardPinBuf) - 1);
      boardPinBuf[sizeof(boardPinBuf) - 1] = '\0';
    } else {
      loadedPin.toCharArray(boardPinBuf, sizeof(boardPinBuf));
    }
  }
  size_t diLen = sizeof(deviceIdBuf);
  if (nvs_get_str(nvs, NVS_DEVICE_ID, deviceIdBuf, &diLen) != ESP_OK || deviceIdBuf[0] == '\0') {
    deviceIdBuf[0] = '\0';
  }
  // Restore board session token across reboots (preserve remaining TTL, do not re-arm full 7 days).
  size_t btLen = sizeof(boardAuthToken);
  if (nvs_get_str(nvs, NVS_BOARD_TOKEN, boardAuthToken, &btLen) == ESP_OK && boardAuthToken[0] != '\0') {
    uint32_t remainingMs = 0;
    if (nvs_get_u32(nvs, NVS_BOARD_TOKEN_REMAINING, &remainingMs) == ESP_OK && remainingMs > 0) {
      boardAuthExpiryMs = millis() + remainingMs;
    } else {
      boardAuthToken[0] = '\0';
      boardAuthExpiryMs = 0;
    }
  } else {
    boardAuthToken[0] = '\0';
    boardAuthExpiryMs = 0;
  }
  size_t lfmLen = sizeof(letterFullModeBuf);
  if (nvs_get_str(nvs, NVS_LETTER_FULL_MODE, letterFullModeBuf, &lfmLen) == ESP_OK) {
    if (strcmp(letterFullModeBuf, "off") != 0 &&
        strcmp(letterFullModeBuf, "number_theme") != 0 &&
        strcmp(letterFullModeBuf, "on") != 0) {
      strcpy(letterFullModeBuf, "on");
    }
  }
  size_t cneLen = sizeof(currentNumberEffectBuf);
  if (nvs_get_str(nvs, NVS_CURRENT_NUM_EFFECT, currentNumberEffectBuf, &cneLen) == ESP_OK) {
    // Migrate legacy "insane" id → "strobe".
    if (strcmp(currentNumberEffectBuf, "insane") == 0) {
      strcpy(currentNumberEffectBuf, "strobe");
    } else if (strcmp(currentNumberEffectBuf, "pulse") != 0 &&
        strcmp(currentNumberEffectBuf, "strobe") != 0 &&
        strcmp(currentNumberEffectBuf, "flash") != 0) {
      strcpy(currentNumberEffectBuf, "flash");
    }
  }
  uint32_t cnc;
  if (nvs_get_u32(nvs, NVS_CURRENT_NUM_COLOR, &cnc) == ESP_OK) currentNumberColor = cnc;
  uint8_t cnb = 0;
  if (nvs_get_u8(nvs, NVS_CALLED_NUM_BANNER, &cnb) == ESP_OK) calledNumberBannerEnabled = (cnb != 0);
  size_t ssidLen = sizeof(staSsidBuf);
  if (nvs_get_str(nvs, NVS_WIFI_SSID, staSsidBuf, &ssidLen) != ESP_OK) {
    staSsidBuf[0] = '\0';
  }
  size_t passLen = sizeof(staPasswordBuf);
  if (nvs_get_str(nvs, NVS_WIFI_PASSWORD, staPasswordBuf, &passLen) != ESP_OK) {
    staPasswordBuf[0] = '\0';
  }
  size_t wnuLen = sizeof(webhookNumberUrlBuf);
  if (nvs_get_str(nvs, NVS_WEBHOOK_NUMBER_URL, webhookNumberUrlBuf, &wnuLen) != ESP_OK) {
    webhookNumberUrlBuf[0] = '\0';
  }
  size_t wbuLen = sizeof(webhookBingoUrlBuf);
  if (nvs_get_str(nvs, NVS_WEBHOOK_BINGO_URL, webhookBingoUrlBuf, &wbuLen) != ESP_OK) {
    webhookBingoUrlBuf[0] = '\0';
  }
  nvs_close(nvs);
}

void saveNvsSettings() {
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return;
  nvs_set_u8(nvs, NVS_BRIGHTNESS, brightness);
  nvs_set_u8(nvs, NVS_LED_VIBRANCE, ledVibrance);
  nvs_set_u8(nvs, NVS_SCREENSAVER_ENABLED, screensaverEnabled ? 1 : 0);
  nvs_set_u8(nvs, NVS_SCREENSAVER_TYPE, screensaverType);
  nvs_set_u8(nvs, NVS_WINNER_EFFECT, winnerEffectType);
  nvs_set_u32(nvs, NVS_SCREENSAVER_COLOR, screensaverColor);
  nvs_set_u16(nvs, NVS_SCREENSAVER_SPEED, screensaverSpeedMs);
  nvs_set_u16(nvs, NVS_AUTO_CALL_SECONDS, autoCallingSeconds);
  nvs_set_i32(nvs, NVS_THEME, themeId);
  nvs_set_u32(nvs, NVS_STATIC_COLOR, staticColor);
  nvs_set_u32(nvs, NVS_LED_HEADER_COLOR, letterHeaderColor);
  nvs_set_u32(nvs, NVS_GAME_TYPE_LED_COLOR, gameTypeLedColor);
  uint8_t mode = 0;
  if (strcmp(colorMode, "solid") == 0) mode = 1;
  else if (strcmp(colorMode, "custom") == 0) mode = 2;
  nvs_set_u8(nvs, NVS_COLOR_MODE, mode);
  nvs_set_u32(nvs, NVS_LED_COLOR_B, customLetterColors[0]);
  nvs_set_u32(nvs, NVS_LED_COLOR_I, customLetterColors[1]);
  nvs_set_u32(nvs, NVS_LED_COLOR_N, customLetterColors[2]);
  nvs_set_u32(nvs, NVS_LED_COLOR_G, customLetterColors[3]);
  nvs_set_u32(nvs, NVS_LED_COLOR_O, customLetterColors[4]);
  nvs_set_str(nvs, NVS_GAME_TYPE, gameType);
  nvs_erase_key(nvs, "gst");
  nvs_set_str(nvs, NVS_BOARD_PIN, boardPinBuf);
  if (deviceIdBuf[0] != '\0') nvs_set_str(nvs, NVS_DEVICE_ID, deviceIdBuf);
  nvs_set_str(nvs, NVS_SCREENSAVER_TEXT, screensaverText);
  nvs_set_str(nvs, NVS_LETTER_FULL_MODE, letterFullModeBuf);
  nvs_set_str(nvs, NVS_CURRENT_NUM_EFFECT, currentNumberEffectBuf);
  nvs_set_u32(nvs, NVS_CURRENT_NUM_COLOR, currentNumberColor);
  nvs_set_u8(nvs, NVS_CALLED_NUM_BANNER, calledNumberBannerEnabled ? 1 : 0);
  nvs_set_str(nvs, NVS_WIFI_SSID, staSsidBuf);
  nvs_set_str(nvs, NVS_WIFI_PASSWORD, staPasswordBuf);
  nvs_set_str(nvs, NVS_WEBHOOK_NUMBER_URL, webhookNumberUrlBuf);
  nvs_set_str(nvs, NVS_WEBHOOK_BINGO_URL, webhookBingoUrlBuf);
  nvs_commit(nvs);
  nvs_close(nvs);
}

/** Persist STA credentials alone — avoids silent failure when a full settings write hits NVS pressure. */
bool saveNvsWifiCredentials() {
  nvs_handle handle;
  esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
  if (err != ESP_OK) {
    Serial.printf("WiFi NVS open failed: %s\n", esp_err_to_name(err));
    return false;
  }
  err = nvs_set_str(handle, NVS_WIFI_SSID, staSsidBuf);
  if (err != ESP_OK) {
    Serial.printf("WiFi NVS set ssid failed: %s\n", esp_err_to_name(err));
    nvs_close(handle);
    return false;
  }
  err = nvs_set_str(handle, NVS_WIFI_PASSWORD, staPasswordBuf);
  if (err != ESP_OK) {
    Serial.printf("WiFi NVS set password failed: %s\n", esp_err_to_name(err));
    nvs_close(handle);
    return false;
  }
  err = nvs_commit(handle);
  nvs_close(handle);
  if (err != ESP_OK) {
    Serial.printf("WiFi NVS commit failed: %s\n", esp_err_to_name(err));
    return false;
  }
  Serial.printf("WiFi NVS saved ssid=\"%s\" configured=%d\n", staSsidBuf, staSsidBuf[0] != '\0');
  return true;
}

void saveNvsGameTypeOnly() {
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return;
  nvs_set_str(nvs, NVS_GAME_TYPE, gameType);
  nvs_erase_key(nvs, "gst");
  nvs_commit(nvs);
  nvs_close(nvs);
}

void saveNvsCallingStyleOnly() {
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return;
  nvs_set_str(nvs, NVS_CALLING_STYLE, callingStyle);
  nvs_commit(nvs);
  nvs_close(nvs);
}

void saveNvsScreensaverEnabledOnly() {
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return;
  nvs_set_u8(nvs, NVS_SCREENSAVER_ENABLED, screensaverEnabled ? 1 : 0);
  nvs_commit(nvs);
  nvs_close(nvs);
}

void populateStateJson(JsonObject doc) {
  doc["current"] = currentNumber;
  doc["remaining"] = poolCount;
  doc["boardSeed"] = boardSeed;
  doc["gameType"] = gameType;
  doc["callingStyle"] = callingStyle;
  doc["gameEstablished"] = gameEstablished;
  // While call-out audio is holding, hide pending winners so board UI/LEDs wait.
  doc["winnerDeclared"] = winnerDeclared;
  doc["manualWinnerDeclared"] = manualWinnerDeclared;
  doc["winnerEventId"] = winnerEventId;
  doc["winnerCount"] = pendingWinnerActivation ? 0 : winnerCount;
  doc["survivorCount"] = survivorCount;
  doc["eliminatedCount"] = eliminatedCount;
  const int activeCards = getActiveCardCount();
  doc["cardCount"] = activeCards;
  doc["playerCount"] = activeCards;
  doc["ledTestMode"] = ledTestMode;
  doc["boardAccessRequired"] = true;
  doc["boardAuthValid"] = isBoardAuthValid();
  doc["screensaverEnabled"] = screensaverEnabled;
  doc["screensaverActive"] = screensaverEnabled && !ledTestMode;
  doc["screensaverType"] = screensaverTypeToString(screensaverType);
  doc["screensaverText"] = screensaverText;
  doc["screensaverSpeedMs"] = screensaverSpeedMs;
  char screensaverHex[8];
  snprintf(screensaverHex, sizeof(screensaverHex), "#%06X", screensaverColor);
  doc["screensaverColor"] = screensaverHex;
  doc["autoCallingEnabled"] = autoCallingEnabled;
  doc["autoCallingHold"] = autoCallingHold;
  doc["autoCallingSeconds"] = autoCallingSeconds;
  doc["autoCallingRemainingMs"] = autoCallingRemainingMsNow();
  doc["theme"] = themeId;
  doc["brightness"] = brightness;
  doc["ledVibrance"] = ledVibrance;
  doc["colorMode"] = colorMode;
  doc["patternIndex"] = patternIdx;
  char hex[8];
  snprintf(hex, sizeof(hex), "#%06X", staticColor);
  doc["staticColor"] = hex;
  char headerHex[8];
  snprintf(headerHex, sizeof(headerHex), "#%06X", letterHeaderColor);
  doc["ledHeaderColor"] = headerHex;
  char gameTypeHex[8];
  snprintf(gameTypeHex, sizeof(gameTypeHex), "#%06X", gameTypeLedColor);
  doc["ledGameTypeColor"] = gameTypeHex;
  JsonObject ledLetterObj = doc.createNestedObject("ledLetterColors");
  char ledHex[8];
  snprintf(ledHex, sizeof(ledHex), "#%06X", customLetterColors[0]); ledLetterObj["B"] = ledHex;
  snprintf(ledHex, sizeof(ledHex), "#%06X", customLetterColors[1]); ledLetterObj["I"] = ledHex;
  snprintf(ledHex, sizeof(ledHex), "#%06X", customLetterColors[2]); ledLetterObj["N"] = ledHex;
  snprintf(ledHex, sizeof(ledHex), "#%06X", customLetterColors[3]); ledLetterObj["G"] = ledHex;
  snprintf(ledHex, sizeof(ledHex), "#%06X", customLetterColors[4]); ledLetterObj["O"] = ledHex;
  doc["letterFullMode"] = letterFullMode;
  doc["currentNumberEffect"] = currentNumberEffect;
  char currentNumHex[8];
  snprintf(currentNumHex, sizeof(currentNumHex), "#%06X", currentNumberColor);
  doc["currentNumberColor"] = currentNumHex;
  doc["calledNumberBanner"] = calledNumberBannerEnabled;
  doc["winnerEffect"] = screensaverTypeToString(winnerEffectType);
  doc["webhookNumberConfigured"] = (webhookNumberUrlBuf[0] != '\0');
  doc["webhookBingoConfigured"] = (webhookBingoUrlBuf[0] != '\0');
  doc["wifiSsid"] = staSsidBuf;
  doc["wifiConfigured"] = (staSsidBuf[0] != '\0');
  doc["wifiConnected"] = wifiStaConnected;
  doc["wifiMode"] = wifiStaConnected ? "sta" : "ap";
  JsonArray arr = doc.createNestedArray("called");
  for (int i = 0; i < callOrderCount; i++) {
    int n = callOrder[i];
    if (n >= 1 && n <= 75 && called[n]) arr.add(n);
  }
}

String buildStateJson() {
  DynamicJsonDocument doc(STATE_JSON_DOC_CAPACITY);
  populateStateJson(doc.to<JsonObject>());
  String buf;
  serializeJson(doc, buf);
  return buf;
}

void broadcastStateWs(const char* type) {
  DynamicJsonDocument env(STATE_WS_ENV_DOC_CAPACITY);
  env["type"] = type ? type : "snapshot";
  env["seq"] = ++wsSeq;
  env["seed"] = boardSeed;
  env["ts"] = millis();
  populateStateJson(env.createNestedObject("data"));
  String payload;
  serializeJson(env, payload);
  for (int i = 0; i < MAX_WS_SUBSCRIPTIONS; i++) {
    if (!wsSubscriptions[i].active) continue;
    if (!wsCanReceiveState(wsSubscriptions[i].clientId)) continue;
    ws.text(wsSubscriptions[i].clientId, payload);
  }
}

void broadcastPatternIndexWs() {
  StaticJsonDocument<192> env;
  env["type"] = "pattern_index_changed";
  env["seq"] = ++wsSeq;
  env["seed"] = boardSeed;
  env["ts"] = millis();
  env["data"]["patternIndex"] = patternIdx;
  String payload;
  serializeJson(env, payload);
  for (int i = 0; i < MAX_WS_SUBSCRIPTIONS; i++) {
    if (!wsSubscriptions[i].active) continue;
    if (!wsCanReceiveState(wsSubscriptions[i].clientId)) continue;
    ws.text(wsSubscriptions[i].clientId, payload);
  }
}

void broadcastAutoCallingProgressWs() {
  StaticJsonDocument<256> env;
  env["type"] = "auto_calling_tick";
  env["seq"] = ++wsSeq;
  env["seed"] = boardSeed;
  env["ts"] = millis();
  JsonObject data = env.createNestedObject("data");
  data["autoCallingRemainingMs"] = autoCallingRemainingMsNow();
  data["autoCallingHold"] = autoCallingHold;
  data["autoCallingEnabled"] = autoCallingEnabled;
  String payload;
  serializeJson(env, payload);
  for (int i = 0; i < MAX_WS_SUBSCRIPTIONS; i++) {
    if (!wsSubscriptions[i].active) continue;
    if (!wsCanReceiveState(wsSubscriptions[i].clientId)) continue;
    ws.text(wsSubscriptions[i].clientId, payload);
  }
}

String buildCardStateJson(const CardSession& s) {
  StaticJsonDocument<512> doc;
  doc["cardId"] = s.cardId;
  doc["winner"] = s.winner;
  doc["winnerCount"] = winnerCount;
  doc["winnerEventId"] = winnerEventId;
  JsonArray marks = doc.createNestedArray("marks");
  for (int i = 0; i < 25; i++) marks.add(s.marks[i]);
  String buf;
  serializeJson(doc, buf);
  return buf;
}

void broadcastCardStateWs(const CardSession& s, const char* type) {
  if (!s.active) return;
  StaticJsonDocument<768> env;
  env["type"] = type ? type : "card_state";
  env["seq"] = ++wsSeq;
  env["seed"] = boardSeed;
  env["ts"] = millis();
  String cardJson = buildCardStateJson(s);
  DynamicJsonDocument nested(512);
  deserializeJson(nested, cardJson);
  env["data"] = nested.as<JsonObject>();
  String payload;
  serializeJson(env, payload);
  for (int i = 0; i < MAX_WS_SUBSCRIPTIONS; i++) {
    if (!wsSubscriptions[i].active) continue;
    if (!wsCanReceiveCardState(wsSubscriptions[i].clientId, s.cardId)) continue;
    ws.text(wsSubscriptions[i].clientId, payload);
  }
}

void broadcastAllCardStatesWs(const char* type) {
  for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
    if (!cardSessions[i].active) continue;
    broadcastCardStateWs(cardSessions[i], type);
  }
}

void sendWsCommandResult(AsyncWebSocketClient* client, const String& requestId, bool ok, int status,
                         const String& dataJson, const char* error) {
  if (!client) return;
  DynamicJsonDocument env(STATE_WS_ENV_DOC_CAPACITY);
  env["type"] = "command_result";
  env["requestId"] = requestId;
  env["ok"] = ok;
  env["status"] = status;
  if (ok) {
    DynamicJsonDocument nested(STATE_JSON_DOC_CAPACITY);
    if (deserializeJson(nested, dataJson) == DeserializationError::Ok) {
      env["data"] = nested.as<JsonVariant>();
    } else {
      env.createNestedObject("data");
    }
  } else {
    env["error"] = error ? error : "error";
  }
  String out;
  serializeJson(env, out);
  client->text(out);
}

void handleWsCommand(AsyncWebSocketClient* client, JsonObject obj) {
  const String requestId = obj["requestId"] | "";
  const String action = obj["action"] | "";
  const String token = obj["token"] | "";
  JsonObject payload = obj["payload"].as<JsonObject>();

  auto requireBoardToken = [&](const char*& err) -> bool {
    if (!isBoardAuthValid()) { err = "board auth required"; return false; }
    if (token.length() == 0 || token != String(boardAuthToken)) { err = "board token invalid"; return false; }
    return true;
  };

  if (action == "get_state") {
    sendWsCommandResult(client, requestId, true, 200, buildStateJson());
    return;
  }

  if (action == "draw") {
    const char* err = nullptr;
    if (!requireBoardToken(err)) { sendWsCommandResult(client, requestId, false, 401, "{}", err); return; }
    if (strcmp(callingStyle, "manual") == 0) { sendWsCommandResult(client, requestId, false, 400, "{}", "manual mode"); return; }
    if (strcmp(callingStyle, "manual") != 0 && !gameEstablished) gameEstablished = true;
    int n = drawNext();
    if (n < 0) { sendWsCommandResult(client, requestId, false, 400, "{}", "pool empty"); return; }
    sendWsCommandResult(client, requestId, true, 200, buildStateJson());
    return;
  }

  if (action == "reset") {
    const char* err = nullptr;
    if (!requireBoardToken(err)) { sendWsCommandResult(client, requestId, false, 401, "{}", err); return; }
    doReset();
    sendWsCommandResult(client, requestId, true, 200, "{}");
    return;
  }

  if (action == "undo") {
    const char* err = nullptr;
    if (!requireBoardToken(err)) { sendWsCommandResult(client, requestId, false, 401, "{}", err); return; }
    if (!undoLastCall()) { sendWsCommandResult(client, requestId, false, 400, "{}", "nothing to undo"); return; }
    sendWsCommandResult(client, requestId, true, 200, buildStateJson());
    return;
  }

  if (action == "set_calling_style") {
    const char* err = nullptr;
    if (!requireBoardToken(err)) { sendWsCommandResult(client, requestId, false, 401, "{}", err); return; }
    if (gameEstablished) { sendWsCommandResult(client, requestId, false, 409, "{}", "game established"); return; }
    const char* cs = payload["callingStyle"] | "";
    if (strcmp(cs, "automatic") != 0 && strcmp(cs, "manual") != 0) {
      sendWsCommandResult(client, requestId, false, 400, "{}", "invalid");
      return;
    }
    strncpy(callingStyleBuf, cs, sizeof(callingStyleBuf) - 1);
    callingStyleBuf[sizeof(callingStyleBuf) - 1] = '\0';
    if (strcmp(callingStyle, "manual") == 0) {
      autoCallingEnabled = false;
      autoCallingHold = false;
      autoCallingWaitForAudio = false;
      autoCallingNextDrawMs = 0;
      autoCallingHoldSinceMs = 0;
    }
    saveNvsCallingStyleOnly();
    broadcastStateWs("calling_style_changed");
    sendWsCommandResult(client, requestId, true, 200, "{}");
    return;
  }

  if (action == "call_number") {
    const char* err = nullptr;
    if (!requireBoardToken(err)) { sendWsCommandResult(client, requestId, false, 401, "{}", err); return; }
    if (strcmp(callingStyle, "manual") != 0) { sendWsCommandResult(client, requestId, false, 400, "{}", "not manual"); return; }
    int num = payload["number"] | 0;
    if (num < 1 || num > 75) { sendWsCommandResult(client, requestId, false, 400, "{}", "invalid number"); return; }
    if (called[num]) { sendWsCommandResult(client, requestId, false, 400, "{}", "already called"); return; }
    if (!gameEstablished) gameEstablished = true;
    called[num] = true;
    if (pool[num]) { pool[num] = false; poolCount--; }
    currentNumber = num;
    startCalledNumberBanner(num);
    winnerSuppressed = false;
    if (callOrderCount < 75) callOrder[callOrderCount++] = num;
    recomputeCardWinners();
    saveGameStateSnapshot();
    updateAllLeds();
    enqueueWebhookNumberCalled(num);
    broadcastStateWs("number_called");
    broadcastAllCardStatesWs("card_state");
    sendWsCommandResult(client, requestId, true, 200, buildStateJson());
    return;
  }

  if (action == "set_game_type") {
    const char* err = nullptr;
    if (!requireBoardToken(err)) { sendWsCommandResult(client, requestId, false, 401, "{}", err); return; }
    if (!canChangeGameTypeNow()) {
      sendWsCommandResult(client, requestId, false, 409, "{}", "game in progress");
      return;
    }
    const char* gt = payload["gameType"] | "";
    if (!applyGameTypeId(gt)) {
      sendWsCommandResult(client, requestId, false, 400, "{}", "invalid");
      return;
    }
    recomputeCardWinners();
    updateAllLeds();
    broadcastStateWs("game_type_changed");
    broadcastAllCardStatesWs("card_state");
    saveNvsGameTypeOnly();
    sendWsCommandResult(client, requestId, true, 200, "{}");
    return;
  }

  if (action == "set_game_selection") {
    const char* err = nullptr;
    if (!requireBoardToken(err)) { sendWsCommandResult(client, requestId, false, 401, "{}", err); return; }
    if (!canChangeGameTypeNow()) {
      sendWsCommandResult(client, requestId, false, 409, "{}", "game in progress");
      return;
    }
    const char* gt = payload["gameType"] | "";
    if (!applyGameTypeId(gt)) {
      sendWsCommandResult(client, requestId, false, 400, "{}", "invalid");
      return;
    }
    recomputeCardWinners();
    updateAllLeds();
    broadcastStateWs("game_type_changed");
    broadcastAllCardStatesWs("card_state");
    saveNvsGameTypeOnly();
    sendWsCommandResult(client, requestId, true, 200, "{}");
    return;
  }

  if (action == "declare_winner") {
    const char* err = nullptr;
    if (!requireBoardToken(err)) { sendWsCommandResult(client, requestId, false, 401, "{}", err); return; }
    winnerSuppressed = false;
    manualWinnerDeclared = true;
    winnerEventId++;
    syncWinnerDeclared();
    enqueueWebhookBingo(currentNumber);
    broadcastStateWs("winner_changed");
    broadcastAllCardStatesWs("card_state");
    sendWsCommandResult(client, requestId, true, 200, "{}");
    return;
  }

  if (action == "clear_winner") {
    const char* err = nullptr;
    if (!requireBoardToken(err)) { sendWsCommandResult(client, requestId, false, 401, "{}", err); return; }
    manualWinnerDeclared = false;
    winnerSuppressed = true;
    for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
      if (!cardSessions[i].active) continue;
      claimCurrentWinningPatterns(cardSessions[i]);
    }
    recomputeCardWinners();
    updateAllLeds();
    broadcastStateWs("winner_changed");
    broadcastAllCardStatesWs("card_state");
    sendWsCommandResult(client, requestId, true, 200, "{}");
    return;
  }

  if (action == "join_card") {
    JsonArray nums = payload["numbers"].as<JsonArray>();
    if (!nums || nums.size() != 25) {
      sendWsCommandResult(client, requestId, false, 400, "{}", "numbers[25] required");
      return;
    }
    const char* requestedId = payload["cardId"] | "";
    CardSession* s = findCardSessionById(requestedId);
    if (!s) s = allocateCardSession();
    if (!s) {
      sendWsCommandResult(client, requestId, false, 503, "{}", "card capacity reached");
      return;
    }
    if (s->cardId[0] == '\0') generateCardId(s->cardId, sizeof(s->cardId));
    int cardNums[25];
    for (int i = 0; i < 25; i++) {
      cardNums[i] = nums[i].isNull() ? 0 : nums[i].as<int>();
    }
    if (!validateBingoCardNumbers(cardNums)) {
      sendWsCommandResult(client, requestId, false, 400, "{}", "invalid card numbers");
      return;
    }
    for (int i = 0; i < 25; i++) {
      s->numbers[i] = cardNums[i];
      s->marks[i] = (i == 12);
    }
    s->winner = false;
    resetSessionClaimedMasks(*s);
    recomputeCardWinners();
    broadcastStateWs("card_joined");
    broadcastCardStateWs(*s, "card_state");
    StaticJsonDocument<256> doc;
    doc["cardId"] = s->cardId;
    doc["winner"] = s->winner;
    doc["winnerCount"] = winnerCount;
    doc["winnerEventId"] = winnerEventId;
    String out;
    serializeJson(doc, out);
    sendWsCommandResult(client, requestId, true, 200, out);
    return;
  }

  if (action == "mark_card_cell") {
    const char* cardId = payload["cardId"] | "";
    int cellIndex = payload["cellIndex"] | -1;
    bool marked = payload["marked"] | false;
    CardSession* s = findCardSessionById(cardId);
    if (!s) { sendWsCommandResult(client, requestId, false, 404, "{}", "card not found"); return; }
    if (cellIndex < 0 || cellIndex >= 25 || cellIndex == 12) {
      sendWsCommandResult(client, requestId, false, 400, "{}", "invalid cell");
      return;
    }
    s->marks[cellIndex] = marked;
    recomputeCardWinners();
    broadcastStateWs("card_mark_changed");
    broadcastCardStateWs(*s, "card_state");
    StaticJsonDocument<192> doc;
    doc["cardId"] = s->cardId;
    doc["winner"] = s->winner;
    doc["winnerCount"] = winnerCount;
    doc["winnerEventId"] = winnerEventId;
    String out;
    serializeJson(doc, out);
    sendWsCommandResult(client, requestId, true, 200, out);
    return;
  }

  if (action == "leave_card") {
    const char* cardId = payload["cardId"] | "";
    CardSession* s = findCardSessionById(cardId);
    if (!s) { sendWsCommandResult(client, requestId, false, 404, "{}", "card not found"); return; }
    clearCardSession(*s);
    recomputeCardWinners();
    broadcastStateWs("card_left");
    broadcastAllCardStatesWs("card_state");
    sendWsCommandResult(client, requestId, true, 200, "{}");
    return;
  }

  if (action == "get_card_state") {
    const char* cardId = payload["cardId"] | "";
    CardSession* s = findCardSessionById(cardId);
    if (!s) { sendWsCommandResult(client, requestId, false, 404, "{}", "card not found"); return; }
    StaticJsonDocument<384> doc;
    doc["cardId"] = s->cardId;
    doc["winner"] = s->winner;
    doc["winnerCount"] = winnerCount;
    doc["winnerEventId"] = winnerEventId;
    JsonArray marks = doc.createNestedArray("marks");
    for (int i = 0; i < 25; i++) marks.add(s->marks[i]);
    String out;
    serializeJson(doc, out);
    sendWsCommandResult(client, requestId, true, 200, out);
    return;
  }

  sendWsCommandResult(client, requestId, false, 400, "{}", "unknown action");
}

void sendStateJson(AsyncWebServerRequest* req) {
  req->send(200, "application/json", buildStateJson());
}

void setup() {
  Serial.begin(115200);
#if STATUS_LED_ENABLED
  initStatusLed();
#endif
  randomSeed(esp_random());
  for (int i = 0; i < MAX_CARD_SESSIONS; i++) clearCardSession(cardSessions[i]);
  clearAllWsSubscriptions();

  esp_err_t nvsErr = nvs_flash_init();
  if (nvsErr == ESP_ERR_NVS_NO_FREE_PAGES || nvsErr == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    Serial.printf("NVS init %s — erasing and reinit\n", esp_err_to_name(nvsErr));
    nvs_flash_erase();
    nvsErr = nvs_flash_init();
  }
  if (nvsErr != ESP_OK) {
    Serial.printf("NVS init failed: %s\n", esp_err_to_name(nvsErr));
  }
  loadNvs();
  Serial.printf("WiFi NVS loaded ssid=\"%s\" configured=%d\n", staSsidBuf, staSsidBuf[0] != '\0');
  ensureDeviceIdLoaded();
  // Never leave the strip dead from a zeroed NVS brightness (looks like a wiring failure).
  if (brightness == 0) {
    brightness = DEFAULT_BRIGHTNESS;
    Serial.println("LED brightness was 0 in NVS — restored to default 255");
  }

  initThemePalettes();
  initLedTestSequence();

  // Claim GPIO 4 before FastLED/RMT; max drive helps 3.3V → WS2811 DIN.
  gpio_reset_pin((gpio_num_t)DATA_PIN);
  gpio_set_direction((gpio_num_t)DATA_PIN, GPIO_MODE_OUTPUT);
  gpio_set_drive_capability((gpio_num_t)DATA_PIN, GPIO_DRIVE_CAP_3);
  digitalWrite(DATA_PIN, LOW);
  delay(50);

  FastLED.addLeds<WS2811, DATA_PIN, LED_COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(255);
  FastLED.clear(true);

  // Boot prove-out: R/G/B/W so any wiring that works is obvious regardless of color order.
  const CRGB bootColors[] = {CRGB::Red, CRGB::Green, CRGB::Blue, CRGB::White};
  for (size_t c = 0; c < sizeof(bootColors) / sizeof(bootColors[0]); c++) {
    fill_solid(leds, NUM_LEDS, bootColors[c]);
    FastLED.show();
    delay(300);
  }
  FastLED.clear(true);
  FastLED.setBrightness(brightness);
  Serial.printf("LED strip: WS2811/RGB %d px GPIO %d (FastLED 3.7.8 RMT4), br=%u\n",
                NUM_LEDS, DATA_PIN, (unsigned)brightness);
  pinMode(BUTTON1_PIN, INPUT_PULLUP);
  pinMode(BUTTON2_PIN, INPUT_PULLUP);
  button1.rawState = button1.stableState = digitalRead(BUTTON1_PIN);
  button2.rawState = button2.stableState = digitalRead(BUTTON2_PIN);
  button1.lastRawChangeMs = button2.lastRawChangeMs = millis();
  if (!loadGameStateSnapshot()) {
    doReset();
  }
  updateAllLeds();
  FastLED.show();

#if STATUS_LED_ENABLED
  blinkStatusLedBootProbe();
  setStatusLed(true);
  Serial.println("Status LED: core boot OK (GPIO 2, before WiFi)");
#endif

  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS mount failed");
  } else {
    size_t fileCount = 0;
    File root = SPIFFS.open("/");
    if (root && root.isDirectory()) {
      File f = root.openNextFile();
      while (f) {
        fileCount++;
        f = root.openNextFile();
      }
    }
    const bool hasIndex = SPIFFS.exists("/index.html");
    Serial.printf("SPIFFS: %u files, index.html %s, used %u / total %u\n",
                  (unsigned)fileCount,
                  hasIndex ? "OK" : "MISSING",
                  (unsigned)SPIFFS.usedBytes(),
                  (unsigned)SPIFFS.totalBytes());
    if (!hasIndex) {
      Serial.println("SPIFFS UI missing — run: make fs-upload   (or make deploy)");
    }
  }

  setupWiFi();

  // Serve all static files from SPIFFS (Vite build output with hashed names)
  server.serveStatic("/", SPIFFS, "/").setDefaultFile("index.html");

  // Captive-portal probes: return success so phones don't show a bare "Not found" splash on join.
  server.on("/generate_204", HTTP_GET, [](AsyncWebServerRequest* req) { req->send(204); });
  server.on("/gen_204", HTTP_GET, [](AsyncWebServerRequest* req) { req->send(204); });
  server.on("/hotspot-detect.html", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "text/html", "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
  });
  server.on("/library/test/success.html", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "text/html", "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
  });
  server.on("/ncsi.txt", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "text/plain", "Microsoft NCSI");
  });
  server.on("/connecttest.txt", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "text/plain", "Microsoft Connect Test");
  });

  // SPA fallback + clear recovery hint when the filesystem image was never uploaded.
  server.onNotFound([](AsyncWebServerRequest* req) {
    if (req->method() == HTTP_GET && SPIFFS.exists("/index.html")) {
      const String& url = req->url();
      if (!url.startsWith("/api/") && !url.startsWith("/ws") && url.indexOf('.') < 0) {
        req->send(SPIFFS, "/index.html", "text/html");
        return;
      }
    }
    if (req->method() == HTTP_GET && !SPIFFS.exists("/index.html")) {
      req->send(503, "text/html",
                "<!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">"
                "<title>Bingo Flashboard</title></head><body style=\"font-family:system-ui;padding:2rem;max-width:36rem\">"
                "<h1>Web UI not on device</h1>"
                "<p>Firmware is running, but the SPIFFS filesystem (React UI + caller audio) is empty or missing "
                "<code>index.html</code>.</p>"
                "<p>From the project repo, with the board on USB:</p>"
                "<pre style=\"background:#f4f4f4;padding:1rem;overflow:auto\">make fs-upload\n"
                "# or full redeploy:\nmake deploy</pre>"
                "<p>Then open <a href=\"/\">http://192.168.4.1</a> or <a href=\"http://bingo.local/\">http://bingo.local</a>.</p>"
                "</body></html>");
      return;
    }
    req->send(404, "text/plain", "Not found");
  });

  ws.onEvent([](AsyncWebSocket* serverWs, AsyncWebSocketClient* client, AwsEventType type,
                void* arg, uint8_t* data, size_t len) {
    (void)serverWs;
    if (type == WS_EVT_CONNECT && client) {
      setWsSubscription(client->id(), false, false, "");
      return;
    }

    if (type == WS_EVT_DISCONNECT && client) {
      removeWsSubscription(client->id());
      return;
    }

    if (type == WS_EVT_DATA && client && arg && data && len > 0) {
      AwsFrameInfo* info = reinterpret_cast<AwsFrameInfo*>(arg);
      if (!info || info->opcode != WS_TEXT || !info->final || info->index != 0 || info->len != len) {
        return;
      }
      DynamicJsonDocument doc(2048);
      if (deserializeJson(doc, data, len) != DeserializationError::Ok) return;
      JsonObject obj = doc.as<JsonObject>();
      const char* msgType = obj["type"] | "";
      if (strcmp(msgType, "subscribe") == 0) {
        const char* mode = obj["mode"] | "none";
        const char* cardId = obj["cardId"] | "";
        const char* token = obj["boardToken"] | "";
        bool boardMode = strcmp(mode, "board") == 0;
        const bool boardAuthOk = boardMode && isBoardTokenValid(token);
        if (boardMode && !boardAuthOk) boardMode = false;
        setWsSubscription(client->id(), boardMode, boardAuthOk, cardId);

        if (wsCanReceiveState(client->id())) {
          DynamicJsonDocument env(STATE_WS_ENV_DOC_CAPACITY);
          env["type"] = "snapshot";
          env["seq"] = ++wsSeq;
          env["seed"] = boardSeed;
          env["ts"] = millis();
          populateStateJson(env.createNestedObject("data"));
          String payload;
          serializeJson(env, payload);
          client->text(payload);
        }

        if (boardAuthOk) {
          for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
            if (!cardSessions[i].active) continue;
            StaticJsonDocument<768> cardEnv;
            cardEnv["type"] = "card_state";
            cardEnv["seq"] = ++wsSeq;
            cardEnv["seed"] = boardSeed;
            cardEnv["ts"] = millis();
            String cardJson = buildCardStateJson(cardSessions[i]);
            DynamicJsonDocument cardNested(512);
            deserializeJson(cardNested, cardJson);
            cardEnv["data"] = cardNested.as<JsonObject>();
            String cardPayload;
            serializeJson(cardEnv, cardPayload);
            client->text(cardPayload);
          }
        } else {
          CardSession* joinedCard = findCardSessionById(cardId);
          if (joinedCard) {
            StaticJsonDocument<768> cardEnv;
            cardEnv["type"] = "card_state";
            cardEnv["seq"] = ++wsSeq;
            cardEnv["seed"] = boardSeed;
            cardEnv["ts"] = millis();
            String cardJson = buildCardStateJson(*joinedCard);
            DynamicJsonDocument cardNested(512);
            deserializeJson(cardNested, cardJson);
            cardEnv["data"] = cardNested.as<JsonObject>();
            String cardPayload;
            serializeJson(cardEnv, cardPayload);
            client->text(cardPayload);
          }
        }
        return;
      }
      if (strcmp(msgType, "command") != 0) return;
      handleWsCommand(client, obj);
    }
  });
  server.addHandler(&ws);

  server.on("/api/state", HTTP_GET, [](AsyncWebServerRequest* req) { sendStateJson(req); });
  server.on("/api/device-id", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    ensureDeviceIdLoaded();
    StaticJsonDocument<96> doc;
    doc["deviceId"] = deviceIdBuf;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  });

  server.on("/draw", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (strcmp(callingStyle, "manual") != 0 && !gameEstablished) gameEstablished = true;
    if (strcmp(callingStyle, "manual") == 0) { req->send(400, "application/json", "{\"error\":\"manual mode\"}"); return; }
    int n = drawNext();
    if (n < 0) { req->send(400, "application/json", "{\"error\":\"pool empty\"}"); return; }
    sendStateJson(req);
  });

  server.on("/reset", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    doReset();
    req->send(200, "application/json", "{}");
  });

  server.on("/undo", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!undoLastCall()) {
      req->send(400, "application/json", "{\"error\":\"nothing to undo\"}");
      return;
    }
    sendStateJson(req);
  });

  server.addHandler(new AsyncCallbackJsonWebHandler("/led-test", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    if (!obj.containsKey("enabled")) {
      req->send(400, "application/json", "{\"error\":\"enabled required\"}");
      return;
    }
    ledTestMode = obj["enabled"].as<bool>();
    if (ledTestMode) {
      resetLedTestSequence();
    } else {
      updateAllLeds();
    }
    broadcastStateWs("led_test_changed");
    sendStateJson(req);
  }));

  server.on("/screensaver", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!req->hasParam("enabled", true)) {
      req->send(400, "application/json", "{\"error\":\"enabled required\"}");
      return;
    }
    String value = req->getParam("enabled", true)->value();
    value.toLowerCase();
    const bool enabled = (value == "1" || value == "true" || value == "on");
    applyScreensaverEnabled(enabled);
    sendStateJson(req);
  });

  server.on("/screensaver-text", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    String text;
    if (req->hasParam("text", true)) text = req->getParam("text", true)->value();
    text.trim();
    if (text.length() == 0) text = "BINGO";
    if (text.length() >= (int)sizeof(screensaverText)) text = text.substring(0, sizeof(screensaverText) - 1);
    text.toCharArray(screensaverText, sizeof(screensaverText));
    resetScreensaverAnim();
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("screensaver_text_changed");
    req->send(200, "application/json", "{}");
  });

  server.on("/screensaver-speed", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (req->hasParam("value", true)) {
      int value = req->getParam("value", true)->value().toInt();
      if (value < 20) value = 20;
      if (value > 500) value = 500;
      screensaverSpeedMs = (uint16_t)value;
      saveNvsSettings();
      broadcastStateWs("screensaver_speed_changed");
    }
    req->send(200, "application/json", "{}");
  });

  server.on("/screensaver-type", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    String typeValue;
    if (req->hasParam("type", true)) typeValue = req->getParam("type", true)->value();
    else if (req->hasParam("type", false)) typeValue = req->getParam("type", false)->value();
    if (typeValue.length() == 0) {
      req->send(400, "application/json", "{\"error\":\"type required\"}");
      return;
    }
    int nextType = screensaverTypeFromString(typeValue.c_str());
    screensaverType = (uint8_t)nextType;
    resetScreensaverAnim();
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("screensaver_type_changed");
    req->send(200, "application/json", "{}");
  });

  server.on("/screensaver-color", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!req->hasParam("hex", true)) {
      req->send(400, "application/json", "{\"error\":\"hex required\"}");
      return;
    }
    String hex = req->getParam("hex", true)->value();
    hex.replace("#", "");
    screensaverColor = (uint32_t)strtoul(hex.c_str(), nullptr, 16);
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("screensaver_color_changed");
    req->send(200, "application/json", "{}");
  });

  server.on("/auto-calling", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (strcmp(callingStyle, "automatic") != 0) {
      req->send(400, "application/json", "{\"error\":\"automatic mode required\"}");
      return;
    }
    if (!req->hasParam("enabled", true)) {
      req->send(400, "application/json", "{\"error\":\"enabled required\"}");
      return;
    }
    String value = req->getParam("enabled", true)->value();
    value.toLowerCase();
    const bool enabled = (value == "1" || value == "true" || value == "on");
    applyAutoCallingEnabled(enabled);
    sendStateJson(req);
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/auto-calling", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    if (strcmp(callingStyle, "automatic") != 0) {
      req->send(400, "application/json", "{\"error\":\"automatic mode required\"}");
      return;
    }
    JsonObject obj = json.as<JsonObject>();
    if (!obj.containsKey("enabled")) {
      req->send(400, "application/json", "{\"error\":\"enabled required\"}");
      return;
    }
    applyAutoCallingEnabled(obj["enabled"].as<bool>());
    sendStateJson(req);
  }));

  server.on("/auto-calling-hold", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!req->hasParam("hold", true)) {
      req->send(400, "application/json", "{\"error\":\"hold required\"}");
      return;
    }
    String value = req->getParam("hold", true)->value();
    value.toLowerCase();
    setAutoCallingHold(value == "1" || value == "true" || value == "on");
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/auto-calling-hold", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    if (!obj.containsKey("hold")) {
      req->send(400, "application/json", "{\"error\":\"hold required\"}");
      return;
    }
    setAutoCallingHold(obj["hold"].as<bool>());
    req->send(200, "application/json", "{}");
  }));

  server.on("/auto-calling-wait-audio", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!req->hasParam("enabled", true)) {
      req->send(400, "application/json", "{\"error\":\"enabled required\"}");
      return;
    }
    String value = req->getParam("enabled", true)->value();
    value.toLowerCase();
    autoCallingWaitForAudio = (value == "1" || value == "true" || value == "on");
    if (!autoCallingWaitForAudio && autoCallingHold) {
      setAutoCallingHold(false);
    } else {
      broadcastStateWs("auto_calling_changed");
    }
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/auto-calling-wait-audio", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    if (!obj.containsKey("enabled")) {
      req->send(400, "application/json", "{\"error\":\"enabled required\"}");
      return;
    }
    autoCallingWaitForAudio = obj["enabled"].as<bool>();
    if (!autoCallingWaitForAudio && autoCallingHold) {
      setAutoCallingHold(false);
    } else {
      broadcastStateWs("auto_calling_changed");
    }
    req->send(200, "application/json", "{}");
  }));

  server.on("/auto-calling-seconds", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!req->hasParam("value", true)) {
      req->send(400, "application/json", "{\"error\":\"value required\"}");
      return;
    }
    int value = req->getParam("value", true)->value().toInt();
    if (value < 1) value = 1;
    if (value > 600) value = 600;
    autoCallingSeconds = (uint16_t)value;
    if (autoCallingEnabled) {
      autoCallingNextDrawMs = millis() + (unsigned long)autoCallingSeconds * 1000UL;
    }
    saveNvsSettings();
    broadcastStateWs("auto_calling_changed");
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/auto-calling-seconds", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    if (!obj.containsKey("value")) {
      req->send(400, "application/json", "{\"error\":\"value required\"}");
      return;
    }
    int value = obj["value"].as<int>();
    if (value < 1) value = 1;
    if (value > 600) value = 600;
    autoCallingSeconds = (uint16_t)value;
    if (autoCallingEnabled) {
      autoCallingNextDrawMs = millis() + (unsigned long)autoCallingSeconds * 1000UL;
    }
    saveNvsSettings();
    broadcastStateWs("auto_calling_changed");
    req->send(200, "application/json", "{}");
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/calling-style", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    if (gameEstablished) { req->send(409, "application/json", "{\"error\":\"game established\"}"); return; }
    JsonObject obj = json.as<JsonObject>();
    const char* cs = obj["callingStyle"];
    if (cs && (strcmp(cs, "automatic") == 0 || strcmp(cs, "manual") == 0)) {
      strncpy(callingStyleBuf, cs, sizeof(callingStyleBuf) - 1);
      callingStyleBuf[sizeof(callingStyleBuf) - 1] = '\0';
      if (strcmp(callingStyle, "manual") == 0) {
        autoCallingEnabled = false;
        autoCallingHold = false;
        autoCallingWaitForAudio = false;
        autoCallingNextDrawMs = 0;
        autoCallingHoldSinceMs = 0;
      }
      saveNvsCallingStyleOnly();
      broadcastStateWs("calling_style_changed");
      req->send(200, "application/json", "{}");
    } else req->send(400, "application/json", "{\"error\":\"invalid\"}");
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/call", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    if (strcmp(callingStyle, "manual") != 0) { req->send(400, "application/json", "{\"error\":\"not manual\"}"); return; }
    if (!gameEstablished) gameEstablished = true;
    JsonObject obj = json.as<JsonObject>();
    int num = obj["number"].as<int>();
    if (num < 1 || num > 75) { req->send(400, "application/json", "{\"error\":\"invalid number\"}"); return; }
    if (called[num]) { req->send(400, "application/json", "{\"error\":\"already called\"}"); return; }
    called[num] = true;
    if (pool[num]) { pool[num] = false; poolCount--; }
    currentNumber = num;
    startCalledNumberBanner(num);
    winnerSuppressed = false;
    if (callOrderCount < 75) {
      callOrder[callOrderCount++] = num;
    }
    recomputeCardWinners();
    saveGameStateSnapshot();
    updateAllLeds();
    enqueueWebhookNumberCalled(num);
    broadcastStateWs("number_called");
    broadcastAllCardStatesWs("card_state");
    sendStateJson(req);
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/game-type", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    if (!canChangeGameTypeNow()) {
      req->send(409, "application/json", "{\"error\":\"game in progress\"}");
      return;
    }
    JsonObject obj = json.as<JsonObject>();
    const char* gt = obj["gameType"];
    if (gt && applyGameTypeId(gt)) {
      recomputeCardWinners();
      updateAllLeds();
      req->send(200, "application/json", "{}");
      broadcastStateWs("game_type_changed");
      broadcastAllCardStatesWs("card_state");
      saveNvsGameTypeOnly();
    } else req->send(400, "application/json", "{\"error\":\"invalid\"}");
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/game-selection", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    if (!canChangeGameTypeNow()) {
      req->send(409, "application/json", "{\"error\":\"game in progress\"}");
      return;
    }
    JsonObject obj = json.as<JsonObject>();
    const char* gt = obj["gameType"] | "";
    if (applyGameTypeId(gt)) {
      recomputeCardWinners();
      updateAllLeds();
      req->send(200, "application/json", "{}");
      broadcastStateWs("game_type_changed");
      broadcastAllCardStatesWs("card_state");
      saveNvsGameTypeOnly();
    } else req->send(400, "application/json", "{\"error\":\"invalid\"}");
  }));

  server.on("/declare-winner", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    winnerSuppressed = false;
    manualWinnerDeclared = true;
    winnerEventId++;
    syncWinnerDeclared();
    enqueueWebhookBingo(currentNumber);
    broadcastStateWs("winner_changed");
    broadcastAllCardStatesWs("card_state");
    req->send(200, "application/json", "{}");
  });
  server.on("/clear-winner", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    manualWinnerDeclared = false;
    winnerSuppressed = true;
    for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
      if (!cardSessions[i].active) continue;
      claimCurrentWinningPatterns(cardSessions[i]);
    }
    recomputeCardWinners();
    updateAllLeds();
    broadcastStateWs("winner_changed");
    broadcastAllCardStatesWs("card_state");
    req->send(200, "application/json", "{}");
  });

  server.on("/brightness", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (req->hasParam("value", true)) {
      int v = req->getParam("value", true)->value().toInt();
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      brightness = (uint8_t)v;
      FastLED.setBrightness(brightness ? brightness : DEFAULT_BRIGHTNESS);
      saveNvsSettings();
      broadcastStateWs("brightness_changed");
    }
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/brightness", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    if (obj.containsKey("value")) {
      int v = obj["value"].as<int>();
      if (v >= 0 && v <= 255) {
        brightness = v;
        FastLED.setBrightness(brightness ? brightness : DEFAULT_BRIGHTNESS);
        saveNvsSettings();
        broadcastStateWs("brightness_changed");
      }
    }
    req->send(200, "application/json", "{}");
  }));

  server.on("/vibrance", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (req->hasParam("value", true)) {
      int v = req->getParam("value", true)->value().toInt();
      if (v < 0) v = 0;
      if (v > 100) v = 100;
      ledVibrance = (uint8_t)v;
      updateAllLeds();
      saveNvsSettings();
      broadcastStateWs("vibrance_changed");
    }
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/vibrance", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    if (obj.containsKey("value")) {
      int v = obj["value"].as<int>();
      if (v < 0) v = 0;
      if (v > 100) v = 100;
      ledVibrance = (uint8_t)v;
      updateAllLeds();
      saveNvsSettings();
      broadcastStateWs("vibrance_changed");
    }
    req->send(200, "application/json", "{}");
  }));

  server.on("/theme", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (req->hasParam("value", true)) themeId = req->getParam("value", true)->value().toInt();
    if (req->hasParam("id", true)) themeId = req->getParam("id", true)->value().toInt();
    strcpy(colorModeBuf, "theme");
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("theme_changed");
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/theme", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    if (obj.containsKey("theme")) themeId = obj["theme"].as<int>();
    else if (obj.containsKey("id")) themeId = obj["id"].as<int>();
    strcpy(colorModeBuf, "theme");
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("theme_changed");
    req->send(200, "application/json", "{}");
  }));

  server.on("/color", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    String hex;
    if (req->hasParam("hex", true)) hex = req->getParam("hex", true)->value();
    if (req->hasParam("color", true)) hex = req->getParam("color", true)->value();
    if (hex.length() >= 6) {
      if (hex.startsWith("#")) hex = hex.substring(1);
      staticColor = (uint32_t)strtoul(hex.c_str(), nullptr, 16);
      strcpy(colorModeBuf, "solid");
      updateAllLeds();
      saveNvsSettings();
      broadcastStateWs("color_changed");
    }
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/color", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    const char* hex = obj["hex"].as<const char*>();
    if (!hex || !*hex) hex = obj["color"].as<const char*>();
    if (hex && *hex) {
      String s(hex);
      if (s.startsWith("#")) s = s.substring(1);
      staticColor = (uint32_t)strtoul(s.c_str(), nullptr, 16);
      strcpy(colorModeBuf, "solid");
      updateAllLeds();
      saveNvsSettings();
      broadcastStateWs("color_changed");
    }
    req->send(200, "application/json", "{}");
  }));

  server.on("/letter-header-color", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    String hex;
    if (req->hasParam("hex", true)) hex = req->getParam("hex", true)->value();
    if (req->hasParam("color", true)) hex = req->getParam("color", true)->value();
    if (hex.length() >= 6) {
      if (hex.startsWith("#")) hex = hex.substring(1);
      letterHeaderColor = (uint32_t)strtoul(hex.c_str(), nullptr, 16);
      letterHeaderPreviewUntilMs = millis() + 1200;
      updateAllLeds();
      saveNvsSettings();
      broadcastStateWs("letter_header_color_changed");
    }
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/letter-header-color", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    const char* hex = obj["hex"].as<const char*>();
    if (!hex || !*hex) hex = obj["color"].as<const char*>();
    if (hex && *hex) {
      String s(hex);
      if (s.startsWith("#")) s = s.substring(1);
      letterHeaderColor = (uint32_t)strtoul(s.c_str(), nullptr, 16);
      letterHeaderPreviewUntilMs = millis() + 1200;
      updateAllLeds();
      saveNvsSettings();
      broadcastStateWs("letter_header_color_changed");
    }
    req->send(200, "application/json", "{}");
  }));

  server.on("/game-type-color", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    String hex;
    if (req->hasParam("hex", true)) hex = req->getParam("hex", true)->value();
    if (req->hasParam("color", true)) hex = req->getParam("color", true)->value();
    if (hex.length() >= 6) {
      if (hex.startsWith("#")) hex = hex.substring(1);
      gameTypeLedColor = (uint32_t)strtoul(hex.c_str(), nullptr, 16);
      updateAllLeds();
      saveNvsSettings();
      broadcastStateWs("game_type_color_changed");
    }
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/game-type-color", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    const char* hex = obj["hex"].as<const char*>();
    if (!hex || !*hex) hex = obj["color"].as<const char*>();
    if (hex && *hex) {
      String s(hex);
      if (s.startsWith("#")) s = s.substring(1);
      gameTypeLedColor = (uint32_t)strtoul(s.c_str(), nullptr, 16);
      updateAllLeds();
      saveNvsSettings();
      broadcastStateWs("game_type_color_changed");
    }
    req->send(200, "application/json", "{}");
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/letter-colors", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    const char* keys[5] = {"B", "I", "N", "G", "O"};
    uint32_t parsed[5];
    for (int i = 0; i < 5; i++) {
      const char* raw = obj[keys[i]].as<const char*>();
      if (!raw || !*raw) {
        req->send(400, "application/json", "{\"error\":\"B/I/N/G/O required\"}");
        return;
      }
      String s(raw);
      s.trim();
      if (s.startsWith("#")) s = s.substring(1);
      if (s.length() != 6) {
        req->send(400, "application/json", "{\"error\":\"invalid hex\"}");
        return;
      }
      char* endPtr = nullptr;
      uint32_t value = (uint32_t)strtoul(s.c_str(), &endPtr, 16);
      if (!endPtr || *endPtr != '\0') {
        req->send(400, "application/json", "{\"error\":\"invalid hex\"}");
        return;
      }
      parsed[i] = value;
    }
    for (int i = 0; i < 5; i++) customLetterColors[i] = parsed[i];
    strcpy(colorModeBuf, "custom");
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("letter_colors_changed");
    req->send(200, "application/json", "{}");
  }));

  // Public (no board token): /auth/board/unlock, /card/join|mark|sync-marks|leave|claim.
  // All other mutating game/LED/settings routes must call requireBoardAuth().
  server.addHandler(new AsyncCallbackJsonWebHandler("/auth/board/unlock", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (boardUnlockIsLockedOut()) {
      req->send(429, "application/json", "{\"error\":\"too many attempts\"}");
      return;
    }
    JsonObject obj = json.as<JsonObject>();
    String pin = normalizedPin(obj["pin"].as<const char*>());
    if (pin.length() == 0 || pin != String(boardPinBuf)) {
      registerBoardUnlockFailure();
      if (boardUnlockIsLockedOut()) {
        req->send(429, "application/json", "{\"error\":\"too many attempts\"}");
        return;
      }
      req->send(401, "application/json", "{\"error\":\"invalid pin\"}");
      return;
    }
    clearBoardUnlockFailures();
    ensureBoardAuthToken();
    broadcastStateWs("board_auth_changed");
    StaticJsonDocument<160> doc;
    doc["token"] = boardAuthToken;
    doc["ttlMs"] = BOARD_AUTH_TTL_MS;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  }));

  server.on("/auth/board/lock", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    clearBoardAuthToken();
    broadcastStateWs("board_auth_changed");
    req->send(200, "application/json", "{}");
  });

  server.on("/board/restart", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    // Respond first; loop() reboots after a short delay so the client gets the 200.
    pendingBoardRestart = true;
    pendingBoardRestartAtMs = millis() + 400UL;
    Serial.println("Board restart requested via API");
    req->send(200, "application/json", "{\"ok\":true}");
  });

  server.on("/auth/board/refresh", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    // Keep the same token; only extend TTL (and re-persist for reboot survival).
    boardAuthExpiryMs = millis() + BOARD_AUTH_TTL_MS;
    persistBoardAuthToken();
    broadcastStateWs("board_auth_changed");
    StaticJsonDocument<160> doc;
    doc["token"] = boardAuthToken;
    doc["ttlMs"] = BOARD_AUTH_TTL_MS;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  });

  server.addHandler(new AsyncCallbackJsonWebHandler("/board/pin", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    String currentPin = normalizedPin(obj["currentPin"].as<const char*>());
    String nextPin = normalizedPin(obj["nextPin"].as<const char*>());
    if (currentPin.length() == 0 || currentPin != String(boardPinBuf)) {
      req->send(400, "application/json", "{\"error\":\"current pin invalid\"}");
      return;
    }
    if (nextPin.length() < 4 || nextPin.length() >= sizeof(boardPinBuf)) {
      req->send(400, "application/json", "{\"error\":\"next pin invalid\"}");
      return;
    }
    nextPin.toCharArray(boardPinBuf, sizeof(boardPinBuf));
    saveNvsSettings();
    broadcastStateWs("board_pin_changed");
    req->send(200, "application/json", "{}");
  }));

  server.on("/letter-full-mode", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!req->hasParam("mode", true)) {
      req->send(400, "application/json", "{\"error\":\"mode required\"}");
      return;
    }
    String mode = req->getParam("mode", true)->value();
    mode.trim();
    if (mode != "on" && mode != "off" && mode != "number_theme") {
      req->send(400, "application/json", "{\"error\":\"invalid mode\"}");
      return;
    }
    strncpy(letterFullModeBuf, mode.c_str(), sizeof(letterFullModeBuf) - 1);
    letterFullModeBuf[sizeof(letterFullModeBuf) - 1] = '\0';
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("letter_full_mode_changed");
    req->send(200, "application/json", "{}");
  });

  server.addHandler(new AsyncCallbackJsonWebHandler("/letter-full-mode", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    const char* mode = obj["mode"].as<const char*>();
    if (!mode || (strcmp(mode, "on") != 0 && strcmp(mode, "off") != 0 && strcmp(mode, "number_theme") != 0)) {
      req->send(400, "application/json", "{\"error\":\"invalid mode\"}");
      return;
    }
    strncpy(letterFullModeBuf, mode, sizeof(letterFullModeBuf) - 1);
    letterFullModeBuf[sizeof(letterFullModeBuf) - 1] = '\0';
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("letter_full_mode_changed");
    req->send(200, "application/json", "{}");
  }));

  server.on("/current-number-effect", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!req->hasParam("effect", true)) {
      req->send(400, "application/json", "{\"error\":\"effect required\"}");
      return;
    }
    String effect = req->getParam("effect", true)->value();
    effect.trim();
    if (effect != "flash" && effect != "pulse" && effect != "strobe") {
      req->send(400, "application/json", "{\"error\":\"invalid effect\"}");
      return;
    }
    strncpy(currentNumberEffectBuf, effect.c_str(), sizeof(currentNumberEffectBuf) - 1);
    currentNumberEffectBuf[sizeof(currentNumberEffectBuf) - 1] = '\0';
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("current_number_effect_changed");
    req->send(200, "application/json", "{}");
  });

  server.addHandler(new AsyncCallbackJsonWebHandler("/current-number-effect", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    const char* effect = obj["effect"].as<const char*>();
    if (!effect || (strcmp(effect, "flash") != 0 && strcmp(effect, "pulse") != 0 && strcmp(effect, "strobe") != 0)) {
      req->send(400, "application/json", "{\"error\":\"invalid effect\"}");
      return;
    }
    strncpy(currentNumberEffectBuf, effect, sizeof(currentNumberEffectBuf) - 1);
    currentNumberEffectBuf[sizeof(currentNumberEffectBuf) - 1] = '\0';
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("current_number_effect_changed");
    req->send(200, "application/json", "{}");
  }));

  server.on("/called-number-banner", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!req->hasParam("enabled", true)) {
      req->send(400, "application/json", "{\"error\":\"enabled required\"}");
      return;
    }
    String value = req->getParam("enabled", true)->value();
    value.toLowerCase();
    calledNumberBannerEnabled = (value == "1" || value == "true" || value == "on");
    if (!calledNumberBannerEnabled) clearCalledNumberBanner();
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("called_number_banner_changed");
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/called-number-banner", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    if (!obj.containsKey("enabled")) {
      req->send(400, "application/json", "{\"error\":\"enabled required\"}");
      return;
    }
    calledNumberBannerEnabled = obj["enabled"].as<bool>();
    if (!calledNumberBannerEnabled) clearCalledNumberBanner();
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("called_number_banner_changed");
    req->send(200, "application/json", "{}");
  }));

  server.on("/winner-effect", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!req->hasParam("type", true)) {
      req->send(400, "application/json", "{\"error\":\"type required\"}");
      return;
    }
    String typeValue = req->getParam("type", true)->value();
    int nextType = screensaverTypeFromString(typeValue.c_str());
    winnerEffectType = (uint8_t)nextType;
    saveNvsSettings();
    broadcastStateWs("winner_effect_changed");
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/winner-effect", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    const char* typeValue = obj["type"] | "";
    int nextType = screensaverTypeFromString(typeValue);
    winnerEffectType = (uint8_t)nextType;
    saveNvsSettings();
    broadcastStateWs("winner_effect_changed");
    req->send(200, "application/json", "{}");
  }));

  server.on("/api/webhooks", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    StaticJsonDocument<640> doc;
    doc["numberCalledUrl"] = webhookNumberUrlBuf;
    doc["bingoUrl"] = webhookBingoUrlBuf;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/webhooks", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    const char* numberUrl = obj["numberCalledUrl"] | "";
    const char* bingoUrl = obj["bingoUrl"] | "";
    strncpy(webhookNumberUrlBuf, numberUrl, sizeof(webhookNumberUrlBuf) - 1);
    webhookNumberUrlBuf[sizeof(webhookNumberUrlBuf) - 1] = '\0';
    strncpy(webhookBingoUrlBuf, bingoUrl, sizeof(webhookBingoUrlBuf) - 1);
    webhookBingoUrlBuf[sizeof(webhookBingoUrlBuf) - 1] = '\0';
    saveNvsSettings();
    broadcastStateWs("webhooks_changed");
    req->send(200, "application/json", "{}");
  }));

  server.on("/current-number-color", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (!req->hasParam("hex", true) && !req->hasParam("color", true)) {
      req->send(400, "application/json", "{\"error\":\"hex required\"}");
      return;
    }
    String hex = req->hasParam("hex", true) ? req->getParam("hex", true)->value()
                                            : req->getParam("color", true)->value();
    hex.trim();
    if (hex.startsWith("#")) hex = hex.substring(1);
    if (hex.length() == 6) {
      currentNumberColor = (uint32_t)strtoul(hex.c_str(), nullptr, 16);
      updateAllLeds();
      saveNvsSettings();
      broadcastStateWs("current_number_color_changed");
    }
    req->send(200, "application/json", "{}");
  });

  server.addHandler(new AsyncCallbackJsonWebHandler("/current-number-color", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    const char* hex = obj["hex"].as<const char*>();
    if (!hex || !*hex) hex = obj["color"].as<const char*>();
    if (hex && *hex) {
      String s(hex);
      if (s.startsWith("#")) s = s.substring(1);
      if (s.length() == 6) {
        currentNumberColor = (uint32_t)strtoul(s.c_str(), nullptr, 16);
        updateAllLeds();
        saveNvsSettings();
        broadcastStateWs("current_number_color_changed");
      }
    }
    req->send(200, "application/json", "{}");
  }));

  // Async WiFi scan MUST be registered before `/wifi` — AsyncURIMatcher BackwardCompatible
  // treats `/wifi` as a prefix of `/wifi/scan`, so the JSON handler would steal this GET.
  server.on("/wifi/scan", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    const int16_t status = WiFi.scanComplete();
    if (status == WIFI_SCAN_RUNNING) {
      req->send(200, "application/json", "{\"status\":\"scanning\",\"networks\":[]}");
      return;
    }
    if (status >= 0) {
      // Dedupe by SSID, keep strongest RSSI.
      struct Net {
        String ssid;
        int32_t rssi;
        bool secure;
      };
      Net best[32];
      int bestCount = 0;
      for (int i = 0; i < status; i++) {
        String ssid = WiFi.SSID(i);
        ssid.trim();
        if (ssid.length() == 0 || ssid.length() > WIFI_SSID_MAX_LEN) continue;
        const int32_t rssi = WiFi.RSSI(i);
        const bool secure = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
        int found = -1;
        for (int j = 0; j < bestCount; j++) {
          if (best[j].ssid == ssid) {
            found = j;
            break;
          }
        }
        if (found >= 0) {
          if (rssi > best[found].rssi) {
            best[found].rssi = rssi;
            best[found].secure = secure;
          }
        } else if (bestCount < 32) {
          best[bestCount].ssid = ssid;
          best[bestCount].rssi = rssi;
          best[bestCount].secure = secure;
          bestCount++;
        }
      }
      // Sort strongest first (simple insertion).
      for (int i = 1; i < bestCount; i++) {
        Net key = best[i];
        int j = i - 1;
        while (j >= 0 && best[j].rssi < key.rssi) {
          best[j + 1] = best[j];
          j--;
        }
        best[j + 1] = key;
      }

      DynamicJsonDocument doc(4096);
      doc["status"] = "done";
      JsonArray nets = doc.createNestedArray("networks");
      for (int i = 0; i < bestCount; i++) {
        JsonObject n = nets.createNestedObject();
        n["ssid"] = best[i].ssid;
        n["rssi"] = best[i].rssi;
        n["secure"] = best[i].secure;
      }
      WiFi.scanDelete();
      String out;
      serializeJson(doc, out);
      req->send(200, "application/json", out);
      return;
    }

    // Not running / failed / never started — kick off an async scan.
    ensureWifiScanRadio();
    WiFi.scanDelete();
    const int started = WiFi.scanNetworks(/*async=*/true, /*show_hidden=*/false);
    if (started == WIFI_SCAN_FAILED) {
      req->send(500, "application/json", "{\"error\":\"scan failed\"}");
      return;
    }
    req->send(200, "application/json", "{\"status\":\"scanning\",\"networks\":[]}");
  });

  {
    auto* wifiHandler = new AsyncCallbackJsonWebHandler("/wifi", [](AsyncWebServerRequest* req, JsonVariant& json) {
      if (!requireBoardAuth(req)) return;
      if (json.isNull() || !json.is<JsonObject>()) {
        req->send(400, "application/json", "{\"error\":\"invalid json\"}");
        return;
      }
      JsonObject obj = json.as<JsonObject>();
      const char* ssidRaw = obj["ssid"] | "";
      String ssid = String(ssidRaw);
      ssid.trim();
      if (ssid.length() == 0) {
        staSsidBuf[0] = '\0';
        staPasswordBuf[0] = '\0';
      } else {
        if (ssid.length() > WIFI_SSID_MAX_LEN) {
          req->send(400, "application/json", "{\"error\":\"ssid too long\"}");
          return;
        }
        ssid.toCharArray(staSsidBuf, sizeof(staSsidBuf));
        // Only update password when the client sends the field (omit = keep existing).
        if (!obj["password"].isNull()) {
          const char* passwordRaw = obj["password"] | "";
          String password = String(passwordRaw);
          if (password.length() > WIFI_PASSWORD_MAX_LEN) {
            req->send(400, "application/json", "{\"error\":\"password too long\"}");
            return;
          }
          password.toCharArray(staPasswordBuf, sizeof(staPasswordBuf));
        } else if (staPasswordBuf[0] == '\0') {
          // First-time configure without a password — allow open networks only.
        }
      }
      if (!saveNvsWifiCredentials()) {
        req->send(500, "application/json", "{\"error\":\"nvs save failed\"}");
        return;
      }
      broadcastStateWs("wifi_changed");
      req->send(200, "application/json", "{\"restartRequired\":true}");
    });
    wifiHandler->setMethod(HTTP_POST);
    server.addHandler(wifiHandler);
  }

  server.addHandler(new AsyncCallbackJsonWebHandler("/card/join", [](AsyncWebServerRequest* req, JsonVariant& json) {
    JsonObject obj = json.as<JsonObject>();
    JsonArray nums = obj["numbers"].as<JsonArray>();
    if (!nums || nums.size() != 25) {
      req->send(400, "application/json", "{\"error\":\"numbers[25] required\"}");
      return;
    }

    const char* requestedId = obj["cardId"].as<const char*>();
    CardSession* s = findCardSessionById(requestedId);
    if (!s) s = allocateCardSession();
    if (!s) {
      req->send(503, "application/json", "{\"error\":\"card capacity reached\"}");
      return;
    }
    if (s->cardId[0] == '\0') generateCardId(s->cardId, sizeof(s->cardId));

    int cardNums[25];
    for (int i = 0; i < 25; i++) {
      cardNums[i] = nums[i].isNull() ? 0 : nums[i].as<int>();
    }
    if (!validateBingoCardNumbers(cardNums)) {
      req->send(400, "application/json", "{\"error\":\"invalid card numbers\"}");
      return;
    }
    for (int i = 0; i < 25; i++) {
      s->numbers[i] = cardNums[i];
      s->marks[i] = (i == 12);
    }
    s->winner = false;
    resetSessionClaimedMasks(*s);
    recomputeCardWinners();
    broadcastStateWs("card_joined");
    broadcastCardStateWs(*s, "card_state");

    StaticJsonDocument<256> doc;
    doc["cardId"] = s->cardId;
    doc["winner"] = s->winner;
    doc["winnerCount"] = winnerCount;
    doc["winnerEventId"] = winnerEventId;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  }));

  // Printed-card verify: numbers come only from the QR payload (self-contained; no print DB).
  server.addHandler(new AsyncCallbackJsonWebHandler("/card/claim", [](AsyncWebServerRequest* req, JsonVariant& json) {
    JsonObject obj = json.as<JsonObject>();
    JsonArray nums = obj["numbers"].as<JsonArray>();
    if (!nums || nums.size() != 25) {
      req->send(400, "application/json", "{\"error\":\"numbers[25] required\"}");
      return;
    }

    int cardNums[25];
    for (int i = 0; i < 25; i++) {
      cardNums[i] = nums[i].isNull() ? 0 : nums[i].as<int>();
    }
    if (!validateBingoCardNumbers(cardNums)) {
      req->send(400, "application/json", "{\"error\":\"invalid card numbers\"}");
      return;
    }

    const char* sig = obj["sig"].as<const char*>();
    if (!sig) sig = obj["signature"].as<const char*>();
    const bool authentic = verifyCardSignature(cardNums, sig);

    char contentId[17];
    cardIdFromCardNumbers(cardNums, contentId, sizeof(contentId));

    CardSession* s = findCardSessionById(contentId);
    if (!s) s = allocateCardSession();
    if (!s) {
      req->send(503, "application/json", "{\"error\":\"card capacity reached\"}");
      return;
    }

    strncpy(s->cardId, contentId, sizeof(s->cardId) - 1);
    s->cardId[sizeof(s->cardId) - 1] = '\0';
    for (int i = 0; i < 25; i++) s->numbers[i] = cardNums[i];
    resetSessionClaimedMasks(*s);
    const bool syncMarks = obj.containsKey("autoSync") ? obj["autoSync"].as<bool>() : true;
    if (syncMarks) syncSessionMarksFromCalled(*s);
    else syncSessionMarksFreeOnly(*s);
    recomputeCardWinners();
    broadcastStateWs("card_claimed");
    broadcastCardStateWs(*s, "card_state");

    StaticJsonDocument<448> doc;
    doc["cardId"] = s->cardId;
    doc["winner"] = s->winner;
    doc["winnerCount"] = winnerCount;
    doc["winnerEventId"] = winnerEventId;
    doc["authentic"] = authentic;
    JsonArray marksOut = doc.createNestedArray("marks");
    for (int i = 0; i < 25; i++) marksOut.add(s->marks[i]);
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/card/mark", [](AsyncWebServerRequest* req, JsonVariant& json) {
    JsonObject obj = json.as<JsonObject>();
    const char* cardId = obj["cardId"].as<const char*>();
    int cellIndex = obj["cellIndex"].as<int>();
    bool marked = obj["marked"].as<bool>();
    CardSession* s = findCardSessionById(cardId);
    if (!s) {
      req->send(404, "application/json", "{\"error\":\"card not found\"}");
      return;
    }
    if (cellIndex < 0 || cellIndex >= 25 || cellIndex == 12) {
      req->send(400, "application/json", "{\"error\":\"invalid cell\"}");
      return;
    }
    s->marks[cellIndex] = marked;
    recomputeCardWinners();
    broadcastStateWs("card_mark_changed");
    broadcastCardStateWs(*s, "card_state");
    StaticJsonDocument<128> doc;
    doc["winner"] = s->winner;
    doc["winnerCount"] = winnerCount;
    doc["winnerEventId"] = winnerEventId;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/card/sync-marks", [](AsyncWebServerRequest* req, JsonVariant& json) {
    JsonObject obj = json.as<JsonObject>();
    const char* cardId = obj["cardId"].as<const char*>();
    JsonArray marks = obj["marks"].as<JsonArray>();
    CardSession* s = findCardSessionById(cardId);
    if (!s) {
      req->send(404, "application/json", "{\"error\":\"card not found\"}");
      return;
    }
    if (!marks || marks.size() != 25) {
      req->send(400, "application/json", "{\"error\":\"marks[25] required\"}");
      return;
    }
    for (int i = 0; i < 25; i++) {
      s->marks[i] = (i == 12) ? true : marks[i].as<bool>();
    }
    recomputeCardWinners();
    broadcastStateWs("card_mark_changed");
    broadcastCardStateWs(*s, "card_state");
    StaticJsonDocument<128> doc;
    doc["cardId"] = s->cardId;
    doc["winner"] = s->winner;
    doc["winnerCount"] = winnerCount;
    doc["winnerEventId"] = winnerEventId;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/card/leave", [](AsyncWebServerRequest* req, JsonVariant& json) {
    JsonObject obj = json.as<JsonObject>();
    const char* cardId = obj["cardId"].as<const char*>();
    CardSession* s = findCardSessionById(cardId);
    if (!s) {
      req->send(404, "application/json", "{\"error\":\"card not found\"}");
      return;
    }
    clearCardSession(*s);
    recomputeCardWinners();
    broadcastStateWs("card_left");
    broadcastAllCardStatesWs("card_state");
    req->send(200, "application/json", "{}");
  }));

  server.on("/api/card-state", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!req->hasParam("cardId")) {
      req->send(400, "application/json", "{\"error\":\"cardId required\"}");
      return;
    }
    String cardId = req->getParam("cardId")->value();
    CardSession* s = findCardSessionById(cardId.c_str());
    if (!s) {
      req->send(404, "application/json", "{\"error\":\"card not found\"}");
      return;
    }
    StaticJsonDocument<512> doc;
    doc["cardId"] = s->cardId;
    doc["winner"] = s->winner;
    doc["winnerCount"] = winnerCount;
    doc["winnerEventId"] = winnerEventId;
    JsonArray marks = doc.createNestedArray("marks");
    for (int i = 0; i < 25; i++) marks.add(s->marks[i]);
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  });

  server.begin();
}

void handleButton1ShortPress() {
  if (!canChangeGameTypeNow()) return;

  int currentIdx = findGameTypeIndex(gameType);
  if (currentIdx < 0) currentIdx = 0;
  int nextIdx = (currentIdx + 1) % GAME_TYPE_COUNT;
  applyGameTypeId(GAME_TYPE_TABLE[nextIdx].id);
  recomputeCardWinners();
  updateAllLeds();
  broadcastStateWs("game_type_changed");
  broadcastAllCardStatesWs("card_state");
  saveNvsGameTypeOnly();
}

void handleButton1LongPress() {
  // Reset only during an active game.
  if (!gameEstablished) return;
  doReset();
}

void handleButton2ShortPress() {
  if (strcmp(callingStyle, "manual") == 0) return;
  if (!gameEstablished) gameEstablished = true;
  drawNext();
}

void handleButton2LongPress() {
  // Fresh manual game with nothing called yet: a winner is impossible.
  // Holding Draw switches to automatic and pulls the first number.
  // Do not start auto-calling — that stays UI-controlled.
  if (strcmp(callingStyle, "manual") == 0 && callOrderCount == 0) {
    strncpy(callingStyleBuf, "automatic", sizeof(callingStyleBuf) - 1);
    callingStyleBuf[sizeof(callingStyleBuf) - 1] = '\0';
    saveNvsCallingStyleOnly();
    if (!gameEstablished) gameEstablished = true;
    drawNext();
    broadcastStateWs("calling_style_changed");
    return;
  }

  if (winnerDeclared) {
    // Clear winner state ("keep going" semantics).
    manualWinnerDeclared = false;
    winnerSuppressed = true;
    for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
      if (!cardSessions[i].active) continue;
      claimCurrentWinningPatterns(cardSessions[i]);
    }
    recomputeCardWinners();
  } else {
    // Declare winner.
    winnerSuppressed = false;
    manualWinnerDeclared = true;
    winnerEventId++;
    syncWinnerDeclared();
    enqueueWebhookBingo(currentNumber);
  }
  updateAllLeds();
  broadcastStateWs("winner_changed");
  broadcastAllCardStatesWs("card_state");
}

void updateButtonState(ButtonState& b, void (*onShortPress)(), void (*onLongPress)()) {
  const unsigned long now = millis();
  uint8_t reading = digitalRead(b.pin);

  if (reading != b.rawState) {
    b.rawState = reading;
    b.lastRawChangeMs = now;
  }

  if ((now - b.lastRawChangeMs) < DEBOUNCE_MS) return;
  if (b.stableState == b.rawState) {
    if (b.stableState == LOW && !b.longHandled && (now - b.pressStartMs) >= LONG_PRESS_MS) {
      b.longHandled = true;
      if (onLongPress) onLongPress();
    }
    return;
  }

  const uint8_t prevStable = b.stableState;
  b.stableState = b.rawState;
  if (prevStable == HIGH && b.stableState == LOW) {
    b.pressStartMs = now;
    b.longHandled = false;
    // Any physical button exits LED test / screensaver.
    bool exitedLedTest = false;
    bool exitedScreensaver = false;
    if (ledTestMode) {
      ledTestMode = false;
      resetLedTestSequence();
      broadcastStateWs("led_test_changed");
      exitedLedTest = true;
    }
    if (screensaverEnabled) {
      screensaverEnabled = false;
      resetScreensaverAnim();
      saveNvsScreensaverEnabledOnly();
      broadcastStateWs("screensaver_changed");
      exitedScreensaver = true;
    }
    if (exitedLedTest || exitedScreensaver) {
      updateAllLeds();
    }
    // Swallow the press only for LED test so it doesn't also cycle game type / draw / reset.
    // Screensaver exit still allows the normal short/long action on this press.
    if (exitedLedTest) {
      b.longHandled = true;
    }
    return;
  }

  if (prevStable == LOW && b.stableState == HIGH && !b.longHandled) {
    if (onShortPress) onShortPress();
  }
}

void loop() {
  if (pendingBoardRestart && (long)(millis() - pendingBoardRestartAtMs) >= 0) {
    pendingBoardRestart = false;
    Serial.println("Restarting…");
    delay(50);
    ESP.restart();
  }
  flushDeferredResetWork();
  updateButtonState(button1, handleButton1ShortPress, handleButton1LongPress);
  updateButtonState(button2, handleButton2ShortPress, handleButton2LongPress);

  // Cycle display patterns for game types with multiple orientations
  if ((millis() - lastPatternChange) >= PATTERN_CYCLE_MS) {
    const GameTypeDef* def = currentGameTypeDef();
    if (def && def->displayCount > 1) {
      patternIdx = (patternIdx + 1) % def->displayCount;
      lastPatternChange = millis();
      broadcastPatternIndexWs();
    }
  }

  // Battleship chase loops at PATTERN_CYCLE_MS per cell (same cadence as pattern cycling).
  static unsigned long lastBattleshipChaseMs = 0;
  if (strcmp(gameType, "battleship") == 0 &&
      (millis() - lastBattleshipChaseMs) >= PATTERN_CYCLE_MS) {
    lastBattleshipChaseMs = millis();
    updateAllLeds();
  }

  static unsigned long lastAutoCallingProgressMs = 0;
  if (autoCallingEnabled && (millis() - lastAutoCallingProgressMs) >= 250UL) {
    lastAutoCallingProgressMs = millis();
    broadcastAutoCallingProgressWs();
  }

  if (autoCallingEnabled) {
    unsigned long now = millis();
    // Safety: never stay held forever if the board UI disconnects mid call-out.
    // Keep this tight so short intervals (e.g. 3s) recover quickly.
    if (autoCallingHold && autoCallingHoldSinceMs > 0 && (now - autoCallingHoldSinceMs) > 8000UL) {
      setAutoCallingHold(false);
    }
    if (!autoCallingCanDrawNow()) {
      if (!autoCallingHold) autoCallingNextDrawMs = 0;
    } else {
      if (autoCallingNextDrawMs == 0) {
        autoCallingNextDrawMs = now + (unsigned long)autoCallingSeconds * 1000UL;
      } else if (now >= autoCallingNextDrawMs) {
        if (!gameEstablished) gameEstablished = true;
        int n = drawNext();
        if (n < 0) {
          autoCallingEnabled = false;
          autoCallingHold = false;
          autoCallingNextDrawMs = 0;
          autoCallingHoldSinceMs = 0;
          broadcastStateWs("auto_calling_changed");
        } else {
          // Arm next countdown immediately so the bar keeps moving during audio.
          autoCallingNextDrawMs = now + (unsigned long)autoCallingSeconds * 1000UL;
          if (autoCallingWaitForAudio) {
            autoCallingHold = true;
            autoCallingHoldSinceMs = now;
            broadcastStateWs("auto_calling_changed");
          }
        }
      }
    }
  }

  ws.cleanupClients();
  processWebhookQueue();
  updateAllLeds();
  FastLED.show();
  delay(20);
}
