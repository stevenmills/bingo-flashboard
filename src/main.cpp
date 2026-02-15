/**
 * Bingo Flashboard – ESP32 + 105-LED WS2811 + WiFi AP
 * Plan: arduino_bingo_led_board_179bac68.plan.md
 */

#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include <SPIFFS.h>
#include <nvs.h>
#include <nvs_flash.h>
#include "config.h"
#include "led_map.h"

// --- LED strip ---
CRGB leds[NUM_LEDS];
uint8_t brightness = 128;
const uint8_t DEFAULT_BRIGHTNESS = 128;

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
static char gameTypeBuf[20] = "traditional";
const char* gameType = gameTypeBuf;
bool winnerDeclared = false;
bool manualWinnerDeclared = false;
bool winnerSuppressed = false;
int winnerCount = 0;
uint32_t winnerEventId = 0;
uint16_t boardSeed = 1000; // 4-digit game/board join code
int themeId = 0;  // 0..n
static char colorModeBuf[8] = "theme";
const char* colorMode = colorModeBuf;
uint32_t staticColor = 0x00FF00;  // RGB for FastLED
static char boardPinBuf[12] = BOARD_DEFAULT_PIN;

// --- Board auth ---
static char boardAuthToken[33] = "";
unsigned long boardAuthExpiryMs = 0;

// --- Shared card sessions ---
const int MAX_CARD_SESSIONS = 32;
struct CardSession {
  bool active;
  char cardId[17];
  int numbers[25];   // 0 means FREE/empty
  bool marks[25];
  bool winner;
  uint16_t claimedTraditionalMask;
  uint16_t claimedFourCornersMask;
  uint16_t claimedPostageMask;
  uint16_t claimedCoverAllMask;
  uint16_t claimedXMask;
  uint16_t claimedYMask;
  uint16_t claimedFrameOutsideMask;
  uint16_t claimedFrameInsideMask;
};
CardSession cardSessions[MAX_CARD_SESSIONS];

const int MAX_WS_SUBSCRIPTIONS = 16;
struct WsSubscription {
  bool active;
  uint32_t clientId;
  bool boardMode;
  char cardId[17];
};
WsSubscription wsSubscriptions[MAX_WS_SUBSCRIPTIONS];

// --- LED board test mode ---
bool ledTestMode = false;
int ledTestSequence[NUM_LEDS];
int ledTestSequenceLen = 0;
int ledTestStepIdx = 0;
bool ledTestFlashPhase = false;
bool ledTestFlashOn = false;
uint8_t ledTestFlashCount = 0;
unsigned long ledTestLastStepMs = 0;
const unsigned long LED_TEST_STEP_MS = 140;
const unsigned long LED_TEST_FLASH_MS = 160;

// --- Button ---
const unsigned long DEBOUNCE_MS = 50;
uint8_t lastButtonState = HIGH;
unsigned long lastDebounce = 0;

// --- Winner sparkle ---
unsigned long sparklePhase = 0;

// --- Pattern cycling for game types with multiple winning orientations ---
// Traditional: 12 orientations (5 rows, 5 columns, 2 diagonals), 5 cells each
const int NUM_TRADITIONAL_PATTERNS = 12;
const int TRADITIONAL_PATTERNS[12][5] = {
  {1,2,3,4,5},      {6,7,8,9,10},     {11,12,13,14,15},
  {16,17,18,19,20},  {21,22,23,24,25},
  {1,6,11,16,21},    {2,7,12,17,22},   {3,8,13,18,23},
  {4,9,14,19,24},    {5,10,15,20,25},
  {1,7,13,19,25},    {5,9,13,17,21},
};

// Postage Stamp: 4 orientations (2×2 in each corner), 4 cells each
const int NUM_POSTAGE_PATTERNS = 4;
const int POSTAGE_PATTERNS[4][4] = {
  {1, 2, 6, 7},       // Top-left
  {4, 5, 9, 10},      // Top-right
  {16, 17, 21, 22},   // Bottom-left
  {19, 20, 24, 25},   // Bottom-right
};

int patternIdx = 0;
unsigned long lastPatternChange = 0;
const unsigned long PATTERN_CYCLE_MS = 1500;

// --- NVS ---
nvs_handle nvs;

// --- Server ---
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
uint32_t wsSeq = 0;

// --- Forward declarations ---
void updateAllLeds();
void loadNvs();
void saveNvsSettings();
int drawNext();
void doReset();
void applyGameTypeToMatrix();
void initLedTestSequence();
void resetLedTestSequence();
void updateLedTestMode();
bool isBoardAuthValid();
bool requireBoardAuth(AsyncWebServerRequest* req);
void issueBoardAuthToken();
void syncWinnerDeclared();
void recomputeCardWinners();
String normalizedPin(const char* raw);
String normalizedJoinCode(const char* raw);
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
void setWsSubscription(uint32_t clientId, bool boardMode, const char* cardId);
bool wsCanReceiveState(uint32_t clientId);
bool wsCanReceiveCardState(uint32_t clientId, const char* cardId);

// Letter for number N (1-75)
char numberToLetter(int n) {
  if (n >= 1 && n <= 15) return 'B';
  if (n >= 16 && n <= 30) return 'I';
  if (n >= 31 && n <= 45) return 'N';
  if (n >= 46 && n <= 60) return 'G';
  if (n >= 61 && n <= 75) return 'O';
  return '?';
}

bool isBoardAuthValid() {
  if (boardAuthToken[0] == '\0') return false;
  long remaining = (long)(boardAuthExpiryMs - millis());
  return remaining > 0;
}

void issueBoardAuthToken() {
  const char* hex = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    boardAuthToken[i] = hex[esp_random() & 0x0F];
  }
  boardAuthToken[32] = '\0';
  boardAuthExpiryMs = millis() + BOARD_AUTH_TTL_MS;
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

String normalizedPin(const char* raw) {
  String s = raw ? String(raw) : String("");
  s.trim();
  return s;
}

String normalizedJoinCode(const char* raw) {
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
  s.claimedTraditionalMask = 0;
  s.claimedFourCornersMask = 0;
  s.claimedPostageMask = 0;
  s.claimedCoverAllMask = 0;
  s.claimedXMask = 0;
  s.claimedYMask = 0;
  s.claimedFrameOutsideMask = 0;
  s.claimedFrameInsideMask = 0;
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

void clearWsSubscription(WsSubscription& sub) {
  sub.active = false;
  sub.clientId = 0;
  sub.boardMode = false;
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

void setWsSubscription(uint32_t clientId, bool boardMode, const char* cardId) {
  WsSubscription* sub = ensureWsSubscription(clientId);
  if (!sub) return;
  sub->boardMode = boardMode;
  sub->cardId[0] = '\0';
  if (!boardMode && cardId && *cardId) {
    CardSession* card = findCardSessionById(cardId);
    if (card) {
      strncpy(sub->cardId, card->cardId, sizeof(sub->cardId) - 1);
      sub->cardId[sizeof(sub->cardId) - 1] = '\0';
    }
  }
}

bool wsCanReceiveState(uint32_t clientId) {
  WsSubscription* sub = findWsSubscription(clientId);
  if (!sub) return false;
  if (sub->boardMode) return true;
  if (sub->cardId[0] == '\0') return false;
  return findCardSessionById(sub->cardId) != nullptr;
}

bool wsCanReceiveCardState(uint32_t clientId, const char* cardId) {
  WsSubscription* sub = findWsSubscription(clientId);
  if (!sub) return false;
  if (sub->boardMode) return true;
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

uint16_t traditionalSatisfiedMask(const CardSession& s) {
  uint16_t mask = 0;
  for (int r = 0; r < 5; r++) {
    bool ok = true;
    for (int c = 0; c < 5; c++) if (!isPatternCellSatisfied(s, r * 5 + c)) { ok = false; break; }
    if (ok) mask |= (1u << r);
  }
  for (int c = 0; c < 5; c++) {
    bool ok = true;
    for (int r = 0; r < 5; r++) if (!isPatternCellSatisfied(s, r * 5 + c)) { ok = false; break; }
    if (ok) mask |= (1u << (5 + c));
  }
  bool d1 = true, d2 = true;
  const int diag1[5] = {0, 6, 12, 18, 24};
  const int diag2[5] = {4, 8, 12, 16, 20};
  for (int i = 0; i < 5; i++) {
    if (!isPatternCellSatisfied(s, diag1[i])) d1 = false;
    if (!isPatternCellSatisfied(s, diag2[i])) d2 = false;
  }
  if (d1) mask |= (1u << 10);
  if (d2) mask |= (1u << 11);
  return mask;
}

uint16_t postageSatisfiedMask(const CardSession& s) {
  const int patterns[4][4] = {
    {0, 1, 5, 6},
    {3, 4, 8, 9},
    {15, 16, 20, 21},
    {18, 19, 23, 24},
  };
  uint16_t mask = 0;
  for (int p = 0; p < 4; p++) {
    bool ok = true;
    for (int i = 0; i < 4; i++) if (!isPatternCellSatisfied(s, patterns[p][i])) { ok = false; break; }
    if (ok) mask |= (1u << p);
  }
  return mask;
}

uint16_t xSatisfiedMask(const CardSession& s) {
  const int pattern[9] = {0, 4, 6, 8, 12, 16, 18, 20, 24};
  for (int i = 0; i < 9; i++) {
    if (!isPatternCellSatisfied(s, pattern[i])) return 0u;
  }
  return 1u;
}

uint16_t ySatisfiedMask(const CardSession& s) {
  const int pattern[7] = {0, 4, 6, 8, 12, 17, 22};
  for (int i = 0; i < 7; i++) {
    if (!isPatternCellSatisfied(s, pattern[i])) return 0u;
  }
  return 1u;
}

uint16_t frameOutsideSatisfiedMask(const CardSession& s) {
  const int pattern[16] = {0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24};
  for (int i = 0; i < 16; i++) {
    if (!isPatternCellSatisfied(s, pattern[i])) return 0u;
  }
  return 1u;
}

uint16_t frameInsideSatisfiedMask(const CardSession& s) {
  const int pattern[8] = {6, 7, 8, 11, 13, 16, 17, 18};
  for (int i = 0; i < 8; i++) {
    if (!isPatternCellSatisfied(s, pattern[i])) return 0u;
  }
  return 1u;
}

uint16_t satisfiedMaskForCurrentGameType(const CardSession& s) {
  if (strcmp(gameType, "traditional") == 0) return traditionalSatisfiedMask(s);
  if (strcmp(gameType, "four_corners") == 0) {
    bool ok = isPatternCellSatisfied(s, 0) && isPatternCellSatisfied(s, 4) &&
              isPatternCellSatisfied(s, 20) && isPatternCellSatisfied(s, 24);
    return ok ? 1u : 0u;
  }
  if (strcmp(gameType, "postage_stamp") == 0) return postageSatisfiedMask(s);
  if (strcmp(gameType, "cover_all") == 0) {
    for (int i = 0; i < 25; i++) if (!isPatternCellSatisfied(s, i)) return 0u;
    return 1u;
  }
  if (strcmp(gameType, "x") == 0) return xSatisfiedMask(s);
  if (strcmp(gameType, "y") == 0) return ySatisfiedMask(s);
  if (strcmp(gameType, "frame_outside") == 0) return frameOutsideSatisfiedMask(s);
  if (strcmp(gameType, "frame_inside") == 0) return frameInsideSatisfiedMask(s);
  return 0u;
}

uint16_t& claimedMaskForCurrentGameType(CardSession& s) {
  if (strcmp(gameType, "traditional") == 0) return s.claimedTraditionalMask;
  if (strcmp(gameType, "four_corners") == 0) return s.claimedFourCornersMask;
  if (strcmp(gameType, "postage_stamp") == 0) return s.claimedPostageMask;
  if (strcmp(gameType, "cover_all") == 0) return s.claimedCoverAllMask;
  if (strcmp(gameType, "x") == 0) return s.claimedXMask;
  if (strcmp(gameType, "y") == 0) return s.claimedYMask;
  if (strcmp(gameType, "frame_outside") == 0) return s.claimedFrameOutsideMask;
  if (strcmp(gameType, "frame_inside") == 0) return s.claimedFrameInsideMask;
  return s.claimedTraditionalMask;
}

bool sessionHasWinningPattern(CardSession& s) {
  const uint16_t satisfied = satisfiedMaskForCurrentGameType(s);
  const uint16_t claimed = claimedMaskForCurrentGameType(s);
  return (satisfied & (uint16_t)~claimed) != 0;
}

void claimCurrentWinningPatterns(CardSession& s) {
  uint16_t& claimed = claimedMaskForCurrentGameType(s);
  claimed |= satisfiedMaskForCurrentGameType(s);
}

void syncWinnerDeclared() {
  winnerDeclared = !winnerSuppressed && (manualWinnerDeclared || (winnerCount > 0));
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
  bool hasNewWinnerEvent = false;
  for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
    if (!cardSessions[i].active) continue;
    const bool wasWinner = cardSessions[i].winner;
    cardSessions[i].winner = sessionHasWinningPattern(cardSessions[i]);
    if (!wasWinner && cardSessions[i].winner) hasNewWinnerEvent = true;
    if (cardSessions[i].winner) winnerCount++;
  }
  if (winnerSuppressed && winnerCount > 0) {
    // A new unclaimed winner emerged after "keep going"; lift suppression.
    winnerSuppressed = false;
  }
  if (hasNewWinnerEvent) winnerEventId++;
  syncWinnerDeclared();
}

// Game-type pattern: fill physical indices for current gameType
void getGameTypePhysicalIndices(int* out, int* count) {
  *count = 0;
  auto add = [&](int cell) {
    int p = gameTypeCellToPhysical(cell);
    if (p >= 0) out[(*count)++] = p;
  };
  if (strcmp(gameType, "traditional") == 0) {
    int idx = patternIdx % NUM_TRADITIONAL_PATTERNS;
    for (int i = 0; i < 5; i++) add(TRADITIONAL_PATTERNS[idx][i]);
  } else if (strcmp(gameType, "four_corners") == 0) {
    add(1); add(5); add(21); add(25);
  } else if (strcmp(gameType, "postage_stamp") == 0) {
    int idx = patternIdx % NUM_POSTAGE_PATTERNS;
    for (int i = 0; i < 4; i++) add(POSTAGE_PATTERNS[idx][i]);
  } else if (strcmp(gameType, "cover_all") == 0) {
    for (int c = 1; c <= 25; c++) add(c);
  } else if (strcmp(gameType, "x") == 0) {
    add(1); add(5); add(7); add(9); add(13); add(17); add(19); add(21); add(25);
  } else if (strcmp(gameType, "y") == 0) {
    add(1); add(5); add(7); add(9); add(13); add(18); add(23);
  } else if (strcmp(gameType, "frame_outside") == 0) {
    add(1); add(2); add(3); add(4); add(5);
    add(6); add(10); add(11); add(15); add(16);
    add(20); add(21); add(22); add(23); add(24); add(25);
  } else if (strcmp(gameType, "frame_inside") == 0) {
    add(7); add(8); add(9); add(12); add(14); add(17); add(18); add(19);
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

CRGB colorForCalledNumber(int n) {
  if (strcmp(colorMode, "solid") == 0) {
    return CRGB((staticColor >> 16) & 0xFF, (staticColor >> 8) & 0xFF, staticColor & 0xFF);
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
  if (strcmp(colorMode, "solid") == 0) {
    return CRGB((staticColor >> 16) & 0xFF, (staticColor >> 8) & 0xFF, staticColor & 0xFF);
  }

  int pos = 0;
  int col = 0;
  switch (letter) {
    case 'B': pos = 0;   col = 0; break;
    case 'I': pos = 51;  col = 1; break;
    case 'N': pos = 102; col = 2; break;
    case 'G': pos = 153; col = 3; break;
    case 'O': pos = 204; col = 4; break;
  }

  int t = themeId % NUM_THEMES;
  uint8_t pal = THEME_PALETTE[t];
  uint8_t anim = THEME_ANIM[t];

  switch (anim) {
    case ANIM_NONE:
      return ColorFromPalette(themePalettes[pal], pos, 255, LINEARBLEND);

    case ANIM_RAINBOW_CYCLE: {
      uint8_t off = beat8(30);
      return ColorFromPalette(themePalettes[pal], pos + off, 255, LINEARBLEND);
    }
    case ANIM_BREATHE: {
      uint8_t bright = beatsin8(15, 80, 255);
      return ColorFromPalette(themePalettes[pal], pos, bright, LINEARBLEND);
    }
    case ANIM_CANDY_CHASE: {
      uint8_t chase = beat8(40) + pos;
      return ColorFromPalette(themePalettes[pal], chase, 255, LINEARBLEND);
    }
    case ANIM_COLOR_WAVE: {
      uint8_t wave = beatsin8(20, 0, 255, 0, col * 50);
      return ColorFromPalette(themePalettes[pal], pos + wave, 255, LINEARBLEND);
    }
    case ANIM_FIRE: {
      uint8_t flicker = random8(180, 255);
      return ColorFromPalette(themePalettes[pal], pos, flicker, LINEARBLEND);
    }
    case ANIM_GOLD_SHIMMER: {
      CRGB gold = CRGB(255, 200, 50);
      gold.nscale8(random8() < 30 ? 255 : random8(120, 200));
      return gold;
    }
    case ANIM_HEARTBEAT: {
      uint8_t bright = heartbeatWave(beat8(72));
      return ColorFromPalette(themePalettes[pal], pos, bright, LINEARBLEND);
    }
    case ANIM_ICE_SHIMMER: {
      uint8_t shimmer = beatsin8(25, 140, 255, 0, col * 15);
      return ColorFromPalette(themePalettes[pal], pos, shimmer, LINEARBLEND);
    }
    case ANIM_NORTHERN_LIGHTS: {
      uint8_t drift = beat8(8);
      uint8_t bright = beatsin8(12, 160, 255, 0, col * 10);
      return ColorFromPalette(themePalettes[pal], pos + drift, bright, LINEARBLEND);
    }
    case ANIM_RETRO_ARCADE: {
      uint8_t pulse = beat8(120);
      uint8_t bright = pulse < 128 ? 255 : 100;
      return ColorFromPalette(themePalettes[pal], pos + beat8(60), bright, LINEARBLEND);
    }
    case ANIM_SPARKLE: {
      uint8_t bright = random8() < 40 ? 255 : random8(60, 160);
      return ColorFromPalette(themePalettes[pal], pos, bright, LINEARBLEND);
    }
    default:
      return ColorFromPalette(themePalettes[pal], pos, 255, LINEARBLEND);
  }
}

void applyGameTypeToMatrix() {
  int indices[25];
  int n = 0;
  getGameTypePhysicalIndices(indices, &n);
  CRGB dimWhite = CRGB(60, 60, 60);
  for (int i = 80; i <= 104; i++) leds[i] = CRGB::Black;
  for (int i = 0; i < n; i++) leds[indices[i]] = dimWhite;
}

void initLedTestSequence() {
  ledTestSequenceLen = 0;
  const char* letters = "BINGO";
  for (int i = 0; i < 5; i++) {
    int p = letterToPhysical(letters[i]);
    if (p >= 0 && p < NUM_LEDS) ledTestSequence[ledTestSequenceLen++] = p;
  }
  for (int n = 1; n <= 75; n++) {
    int p = numberToPhysical(n);
    if (p >= 0 && p < NUM_LEDS) ledTestSequence[ledTestSequenceLen++] = p;
  }
  // Logical 5x5 matrix order: left->right, top->bottom (cells 1..25)
  for (int cell = 1; cell <= 25; cell++) {
    int p = gameTypeCellToPhysical(cell);
    if (p >= 0 && p < NUM_LEDS) ledTestSequence[ledTestSequenceLen++] = p;
  }
}

void resetLedTestSequence() {
  ledTestStepIdx = 0;
  ledTestFlashPhase = false;
  ledTestFlashOn = false;
  ledTestFlashCount = 0;
  ledTestLastStepMs = millis();
}

void updateLedTestMode() {
  if (ledTestSequenceLen <= 0) return;

  unsigned long now = millis();
  const unsigned long interval = ledTestFlashPhase ? LED_TEST_FLASH_MS : LED_TEST_STEP_MS;
  if ((now - ledTestLastStepMs) >= interval) {
    ledTestLastStepMs = now;
    if (ledTestFlashPhase) {
      ledTestFlashOn = !ledTestFlashOn;
      if (!ledTestFlashOn) {
        ledTestFlashCount++;
        if (ledTestFlashCount >= 3) {
          ledTestFlashPhase = false;
          ledTestFlashOn = false;
          ledTestFlashCount = 0;
          ledTestStepIdx = 0;
        }
      }
    } else {
      ledTestStepIdx++;
      if (ledTestStepIdx >= ledTestSequenceLen) {
        ledTestStepIdx = 0;
        ledTestFlashPhase = true;
        ledTestFlashOn = true;
      }
    }
  }

  if (ledTestFlashPhase) {
    if (ledTestFlashOn) {
      fill_solid(leds, NUM_LEDS, CRGB::White);
    }
    return;
  }

  int p = ledTestSequence[ledTestStepIdx];
  if (p >= 0 && p < NUM_LEDS) leds[p] = CRGB::White;
}

void updateAllLeds() {
  FastLED.clear();
  FastLED.setBrightness(brightness);

  if (ledTestMode) {
    updateLedTestMode();
    return;
  }

  if (winnerDeclared) {
    sparklePhase++;
    CRGB gold = CRGB::Gold;
    for (int n = 1; n <= 75; n++) {
      if (!called[n]) continue;
      int p = numberToPhysical(n);
      if (p >= 0) {
        uint8_t b = (sparklePhase + n * 3) % 256;
        leds[p] = gold;
        leds[p].fadeToBlackBy(255 - b);
      }
    }
    int letterIdx[] = { 0, 31, 32, 63, 64 };
    for (int i = 0; i < 5; i++) {
      uint8_t b = (sparklePhase + i * 20) % 256;
      leds[letterIdx[i]] = gold;
      leds[letterIdx[i]].fadeToBlackBy(255 - b);
    }
    applyGameTypeToMatrix();
    return;
  }

  for (int n = 1; n <= 75; n++) {
    if (!called[n]) continue;
    int p = numberToPhysical(n);
    if (p >= 0) {
      leds[p] = colorForCalledNumber(n);
      if (n == currentNumber) {
        // Breathe/pulse effect for most recently called
        uint8_t breathe = beatsin8(60, 160, 255);
        leds[p].nscale8(breathe);
      }
    }
  }
  // Letters on when column has at least one call
  const char* letters = "BINGO";
  for (int col = 0; col < 5; col++) {
    int low = col * 15 + 1, high = col * 15 + 15;
    bool any = false;
    for (int n = low; n <= high; n++) if (called[n]) { any = true; break; }
    int letterP = letterToPhysical(letters[col]);
    if (letterP >= 0) leds[letterP] = any ? colorForLetter(letters[col]) : CRGB::Black;
  }
  applyGameTypeToMatrix();
}

int drawNext() {
  if (poolCount <= 0) return -1;
  int idx = random(poolCount);
  int k = 0;
  for (int n = 1; n <= 75; n++) {
    if (!pool[n]) continue;
    if (k == idx) {
      pool[n] = false;
      poolCount--;
      called[n] = true;
      currentNumber = n;
      winnerSuppressed = false;
      if (callOrderCount < 75) {
        callOrder[callOrderCount++] = n;
      }
      recomputeCardWinners();
      updateAllLeds();
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
  manualWinnerDeclared = false;
  // Undo keeps the current game session active, even at zero calls.
  gameEstablished = true;
  recomputeCardWinners();
  updateAllLeds();
  broadcastStateWs("number_undone");
  broadcastAllCardStatesWs("card_state");
  return true;
}

void doReset() {
  for (int i = 1; i <= 75; i++) {
    pool[i] = true;
    called[i] = false;
  }
  poolCount = 75;
  callOrderCount = 0;
  currentNumber = 0;
  boardSeed = (uint16_t)random(1000, 10000);
  gameEstablished = false;
  manualWinnerDeclared = false;
  winnerSuppressed = false;
  winnerEventId = 0;
  for (int i = 0; i < MAX_CARD_SESSIONS; i++) {
    if (!cardSessions[i].active) continue;
    for (int c = 0; c < 25; c++) cardSessions[i].marks[c] = (c == 12);
    cardSessions[i].winner = false;
    cardSessions[i].claimedTraditionalMask = 0;
    cardSessions[i].claimedFourCornersMask = 0;
    cardSessions[i].claimedPostageMask = 0;
    cardSessions[i].claimedCoverAllMask = 0;
    cardSessions[i].claimedXMask = 0;
    cardSessions[i].claimedYMask = 0;
    cardSessions[i].claimedFrameOutsideMask = 0;
    cardSessions[i].claimedFrameInsideMask = 0;
  }
  winnerCount = 0;
  syncWinnerDeclared();
  updateAllLeds();
  broadcastStateWs("game_reset");
  broadcastAllCardStatesWs("card_state");
}

void loadNvs() {
  if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs) != ESP_OK) return;
  uint8_t br;
  if (nvs_get_u8(nvs, NVS_BRIGHTNESS, &br) == ESP_OK) brightness = br;
  if (nvs_get_i32(nvs, NVS_THEME, (int32_t*)&themeId) == ESP_OK) {}
  uint32_t sc;
  if (nvs_get_u32(nvs, NVS_STATIC_COLOR, &sc) == ESP_OK) staticColor = sc;
  size_t len = sizeof(gameTypeBuf);
  if (nvs_get_str(nvs, NVS_GAME_TYPE, gameTypeBuf, &len) == ESP_OK) {
    if (strcmp(gameTypeBuf, "four_corners") != 0 && strcmp(gameTypeBuf, "postage_stamp") != 0 &&
        strcmp(gameTypeBuf, "cover_all") != 0 && strcmp(gameTypeBuf, "traditional") != 0 &&
        strcmp(gameTypeBuf, "x") != 0 && strcmp(gameTypeBuf, "y") != 0 &&
        strcmp(gameTypeBuf, "frame_outside") != 0 &&
        strcmp(gameTypeBuf, "frame_inside") != 0)
      strcpy(gameTypeBuf, "traditional");
  }
  size_t csLen = sizeof(callingStyleBuf);
  if (nvs_get_str(nvs, NVS_CALLING_STYLE, callingStyleBuf, &csLen) == ESP_OK) {
    if (strcmp(callingStyleBuf, "automatic") != 0 && strcmp(callingStyleBuf, "manual") != 0)
      strcpy(callingStyleBuf, "automatic");
  }
  uint8_t cm;
  if (nvs_get_u8(nvs, NVS_COLOR_MODE, &cm) == ESP_OK)
    strcpy(colorModeBuf, (cm == 1) ? "solid" : "theme");
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
  nvs_close(nvs);
}

void saveNvsSettings() {
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return;
  nvs_set_u8(nvs, NVS_BRIGHTNESS, brightness);
  nvs_set_i32(nvs, NVS_THEME, themeId);
  nvs_set_u32(nvs, NVS_STATIC_COLOR, staticColor);
  nvs_set_u8(nvs, NVS_COLOR_MODE, strcmp(colorMode, "solid") == 0 ? 1 : 0);
  nvs_set_str(nvs, NVS_GAME_TYPE, gameType);
  nvs_set_str(nvs, NVS_CALLING_STYLE, callingStyle);
  nvs_set_str(nvs, NVS_BOARD_PIN, boardPinBuf);
  nvs_commit(nvs);
  nvs_close(nvs);
}

String buildStateJson() {
  StaticJsonDocument<768> doc;
  doc["current"] = currentNumber;
  doc["remaining"] = poolCount;
  doc["boardSeed"] = boardSeed;
  doc["gameType"] = gameType;
  doc["callingStyle"] = callingStyle;
  doc["gameEstablished"] = gameEstablished;
  doc["winnerDeclared"] = winnerDeclared;
  doc["manualWinnerDeclared"] = manualWinnerDeclared;
  doc["winnerEventId"] = winnerEventId;
  doc["winnerCount"] = winnerCount;
  const int activeCards = getActiveCardCount();
  doc["cardCount"] = activeCards;
  doc["playerCount"] = activeCards; // currently one active card per player/device
  doc["ledTestMode"] = ledTestMode;
  doc["boardAccessRequired"] = true;
  doc["boardAuthValid"] = isBoardAuthValid();
  doc["theme"] = themeId;
  doc["brightness"] = brightness;
  doc["colorMode"] = colorMode;
  doc["patternIndex"] = patternIdx;
  char hex[8];
  snprintf(hex, sizeof(hex), "#%06X", staticColor);
  doc["staticColor"] = hex;
  JsonArray arr = doc.createNestedArray("called");
  for (int n = 1; n <= 75; n++)
    if (called[n]) arr.add(n);
  String buf;
  serializeJson(doc, buf);
  return buf;
}

void broadcastStateWs(const char* type) {
  StaticJsonDocument<1024> env;
  env["type"] = type ? type : "snapshot";
  env["seq"] = ++wsSeq;
  env["seed"] = boardSeed;
  env["ts"] = millis();
  String stateJson = buildStateJson();
  DynamicJsonDocument nested(768);
  deserializeJson(nested, stateJson);
  env["data"] = nested.as<JsonObject>();
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
  StaticJsonDocument<1024> env;
  env["type"] = "command_result";
  env["requestId"] = requestId;
  env["ok"] = ok;
  env["status"] = status;
  if (ok) {
    DynamicJsonDocument nested(768);
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
    saveNvsSettings();
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
    winnerSuppressed = false;
    if (callOrderCount < 75) callOrder[callOrderCount++] = num;
    recomputeCardWinners();
    updateAllLeds();
    broadcastStateWs("number_called");
    broadcastAllCardStatesWs("card_state");
    sendWsCommandResult(client, requestId, true, 200, buildStateJson());
    return;
  }

  if (action == "set_game_type") {
    const char* err = nullptr;
    if (!requireBoardToken(err)) { sendWsCommandResult(client, requestId, false, 401, "{}", err); return; }
    const char* gt = payload["gameType"] | "";
    if (strcmp(gt, "traditional") != 0 && strcmp(gt, "four_corners") != 0 &&
        strcmp(gt, "postage_stamp") != 0 && strcmp(gt, "cover_all") != 0 &&
        strcmp(gt, "x") != 0 && strcmp(gt, "y") != 0 &&
        strcmp(gt, "frame_outside") != 0 &&
        strcmp(gt, "frame_inside") != 0) {
      sendWsCommandResult(client, requestId, false, 400, "{}", "invalid");
      return;
    }
    strncpy(gameTypeBuf, gt, sizeof(gameTypeBuf) - 1);
    gameTypeBuf[sizeof(gameTypeBuf) - 1] = '\0';
    patternIdx = 0;
    recomputeCardWinners();
    updateAllLeds();
    saveNvsSettings();
    broadcastStateWs("game_type_changed");
    broadcastAllCardStatesWs("card_state");
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
    String joinCode = normalizedJoinCode(payload["pin"] | "");
    if (joinCode.length() == 0 || joinCode != String(boardSeed)) {
      sendWsCommandResult(client, requestId, false, 401, "{}", "invalid board seed");
      return;
    }
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
    for (int i = 0; i < 25; i++) {
      s->numbers[i] = nums[i].isNull() ? 0 : nums[i].as<int>();
      s->marks[i] = (i == 12);
    }
    s->winner = false;
    s->claimedTraditionalMask = 0;
    s->claimedFourCornersMask = 0;
    s->claimedPostageMask = 0;
    s->claimedCoverAllMask = 0;
    s->claimedXMask = 0;
    s->claimedYMask = 0;
    s->claimedFrameOutsideMask = 0;
    s->claimedFrameInsideMask = 0;
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
  randomSeed(esp_random());
  for (int i = 0; i < MAX_CARD_SESSIONS; i++) clearCardSession(cardSessions[i]);
  clearAllWsSubscriptions();

  if (nvs_flash_init() == ESP_ERR_NVS_NO_FREE_PAGES) {
    nvs_flash_erase();
    nvs_flash_init();
  }
  loadNvs();

  initThemePalettes();
  initLedTestSequence();
  FastLED.addLeds<WS2811, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(brightness);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  doReset();
  updateAllLeds();

  if (!SPIFFS.begin(true)) Serial.println("SPIFFS mount failed");

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.println("AP started: " AP_SSID " – open http://192.168.4.1");

  // Serve all static files from SPIFFS (Vite build output with hashed names)
  server.serveStatic("/", SPIFFS, "/").setDefaultFile("index.html");

  ws.onEvent([](AsyncWebSocket* serverWs, AsyncWebSocketClient* client, AwsEventType type,
                void* arg, uint8_t* data, size_t len) {
    (void)serverWs;
    if (type == WS_EVT_CONNECT && client) {
      setWsSubscription(client->id(), false, "");
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
        const bool boardMode = strcmp(mode, "board") == 0;
        setWsSubscription(client->id(), boardMode, cardId);

        if (wsCanReceiveState(client->id())) {
          StaticJsonDocument<1024> env;
          env["type"] = "snapshot";
          env["seq"] = ++wsSeq;
          env["seed"] = boardSeed;
          env["ts"] = millis();
          String stateJson = buildStateJson();
          DynamicJsonDocument nested(768);
          deserializeJson(nested, stateJson);
          env["data"] = nested.as<JsonObject>();
          String payload;
          serializeJson(env, payload);
          client->text(payload);
        }

        if (boardMode) {
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

  server.on("/draw", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    if (strcmp(callingStyle, "manual") != 0 && !gameEstablished) gameEstablished = true;
    if (strcmp(callingStyle, "manual") == 0) { req->send(400, "application/json", "{\"error\":\"manual mode\"}"); return; }
    int n = drawNext();
    if (n < 0) { req->send(400, "application/json", "{\"error\":\"pool empty\"}"); return; }
    sendStateJson(req);
  });
  server.on("/draw", HTTP_GET, [](AsyncWebServerRequest* req) {
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

  server.addHandler(new AsyncCallbackJsonWebHandler("/calling-style", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    if (gameEstablished) { req->send(409, "application/json", "{\"error\":\"game established\"}"); return; }
    JsonObject obj = json.as<JsonObject>();
    const char* cs = obj["callingStyle"];
    if (cs && (strcmp(cs, "automatic") == 0 || strcmp(cs, "manual") == 0)) {
      strncpy(callingStyleBuf, cs, sizeof(callingStyleBuf) - 1);
      callingStyleBuf[sizeof(callingStyleBuf) - 1] = '\0';
      saveNvsSettings();
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
    winnerSuppressed = false;
    if (callOrderCount < 75) {
      callOrder[callOrderCount++] = num;
    }
    recomputeCardWinners();
    updateAllLeds();
    broadcastStateWs("number_called");
    broadcastAllCardStatesWs("card_state");
    sendStateJson(req);
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/game-type", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    JsonObject obj = json.as<JsonObject>();
    const char* gt = obj["gameType"];
    if (gt && (strcmp(gt, "traditional") == 0 || strcmp(gt, "four_corners") == 0 ||
              strcmp(gt, "postage_stamp") == 0 || strcmp(gt, "cover_all") == 0 ||
              strcmp(gt, "x") == 0 || strcmp(gt, "y") == 0 ||
              strcmp(gt, "frame_outside") == 0 ||
              strcmp(gt, "frame_inside") == 0)) {
      strncpy(gameTypeBuf, gt, sizeof(gameTypeBuf) - 1);
      gameTypeBuf[sizeof(gameTypeBuf) - 1] = '\0';
      recomputeCardWinners();
      updateAllLeds();
      saveNvsSettings();
      broadcastStateWs("game_type_changed");
      broadcastAllCardStatesWs("card_state");
      req->send(200, "application/json", "{}");
    } else req->send(400, "application/json", "{\"error\":\"invalid\"}");
  }));

  server.on("/declare-winner", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!requireBoardAuth(req)) return;
    winnerSuppressed = false;
    manualWinnerDeclared = true;
    winnerEventId++;
    syncWinnerDeclared();
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
      brightness = req->getParam("value", true)->value().toInt();
      if (brightness > 255) brightness = 255;
      FastLED.setBrightness(brightness);
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
        FastLED.setBrightness(brightness);
        saveNvsSettings();
        broadcastStateWs("brightness_changed");
      }
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

  server.addHandler(new AsyncCallbackJsonWebHandler("/auth/board/unlock", [](AsyncWebServerRequest* req, JsonVariant& json) {
    JsonObject obj = json.as<JsonObject>();
    String pin = normalizedPin(obj["pin"].as<const char*>());
    if (pin.length() == 0 || pin != String(boardPinBuf)) {
      req->send(401, "application/json", "{\"error\":\"invalid pin\"}");
      return;
    }
    issueBoardAuthToken();
    broadcastStateWs("board_auth_changed");
    StaticJsonDocument<160> doc;
    doc["token"] = boardAuthToken;
    doc["ttlMs"] = BOARD_AUTH_TTL_MS;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  }));

  server.on("/auth/board/lock", HTTP_POST, [](AsyncWebServerRequest* req) {
    boardAuthToken[0] = '\0';
    boardAuthExpiryMs = 0;
    broadcastStateWs("board_auth_changed");
    req->send(200, "application/json", "{}");
  });

  server.addHandler(new AsyncCallbackJsonWebHandler("/auth/board/refresh", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (!requireBoardAuth(req)) return;
    issueBoardAuthToken();
    broadcastStateWs("board_auth_changed");
    StaticJsonDocument<160> doc;
    doc["token"] = boardAuthToken;
    doc["ttlMs"] = BOARD_AUTH_TTL_MS;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  }));

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

  server.addHandler(new AsyncCallbackJsonWebHandler("/card/join", [](AsyncWebServerRequest* req, JsonVariant& json) {
    JsonObject obj = json.as<JsonObject>();
    String joinCode = normalizedJoinCode(obj["pin"].as<const char*>());
    String activeSeed = String(boardSeed);
    if (joinCode.length() == 0 || joinCode != activeSeed) {
      req->send(401, "application/json", "{\"error\":\"invalid board seed\"}");
      return;
    }

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

    for (int i = 0; i < 25; i++) {
      s->numbers[i] = nums[i].isNull() ? 0 : nums[i].as<int>();
      s->marks[i] = (i == 12);
    }
    s->winner = false;
    s->claimedTraditionalMask = 0;
    s->claimedFourCornersMask = 0;
    s->claimedPostageMask = 0;
    s->claimedCoverAllMask = 0;
    s->claimedXMask = 0;
    s->claimedYMask = 0;
    s->claimedFrameOutsideMask = 0;
    s->claimedFrameInsideMask = 0;
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

void loop() {
  // Button: only in automatic mode
  uint8_t btn = digitalRead(BUTTON_PIN);
  if (btn != lastButtonState) lastDebounce = millis();
  if ((millis() - lastDebounce) > DEBOUNCE_MS) {
    if (btn == LOW && lastButtonState == HIGH && strcmp(callingStyle, "automatic") == 0) {
      if (!gameEstablished) gameEstablished = true;
      drawNext();
    }
    lastButtonState = btn;
  }

  // Cycle patterns for game types with multiple winning orientations
  if ((millis() - lastPatternChange) >= PATTERN_CYCLE_MS) {
    if (strcmp(gameType, "traditional") == 0) {
      patternIdx = (patternIdx + 1) % NUM_TRADITIONAL_PATTERNS;
      lastPatternChange = millis();
      broadcastStateWs("pattern_index_changed");
    } else if (strcmp(gameType, "postage_stamp") == 0) {
      patternIdx = (patternIdx + 1) % NUM_POSTAGE_PATTERNS;
      lastPatternChange = millis();
      broadcastStateWs("pattern_index_changed");
    }
  }

  ws.cleanupClients();
  updateAllLeds();
  FastLED.show();
  delay(20);
}
