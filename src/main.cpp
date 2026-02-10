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
static char callingStyleBuf[12] = "automatic";
const char* callingStyle = callingStyleBuf;
bool gameEstablished = false;
static char gameTypeBuf[20] = "traditional";
const char* gameType = gameTypeBuf;
bool winnerDeclared = false;
int themeId = 0;  // 0..n
static char colorModeBuf[8] = "theme";
const char* colorMode = colorModeBuf;
uint32_t staticColor = 0x00FF00;  // RGB for FastLED

// --- Button ---
const unsigned long DEBOUNCE_MS = 50;
uint8_t lastButtonState = HIGH;
unsigned long lastDebounce = 0;

// --- Winner sparkle ---
unsigned long sparklePhase = 0;

// --- NVS ---
nvs_handle nvs;

// --- Server ---
AsyncWebServer server(80);

// --- Forward declarations ---
void updateAllLeds();
void loadNvs();
void saveNvsSettings();
int drawNext();
void doReset();
void applyGameTypeToMatrix();

// Letter for number N (1-75)
char numberToLetter(int n) {
  if (n >= 1 && n <= 15) return 'B';
  if (n >= 16 && n <= 30) return 'I';
  if (n >= 31 && n <= 45) return 'N';
  if (n >= 46 && n <= 60) return 'G';
  if (n >= 61 && n <= 75) return 'O';
  return '?';
}

// Game-type pattern: fill physical indices for current gameType
void getGameTypePhysicalIndices(int* out, int* count) {
  *count = 0;
  auto add = [&](int cell) {
    int p = gameTypeCellToPhysical(cell);
    if (p >= 0) out[(*count)++] = p;
  };
  if (strcmp(gameType, "traditional") == 0) {
    for (int c = 11; c <= 15; c++) add(c);  // middle row
  } else if (strcmp(gameType, "four_corners") == 0) {
    add(1); add(5); add(21); add(25);
  } else if (strcmp(gameType, "postage_stamp") == 0) {
    add(1); add(2); add(6); add(7);
  } else if (strcmp(gameType, "cover_all") == 0) {
    for (int c = 1; c <= 25; c++) add(c);
  }
}

CRGB colorForCalled() {
  if (strcmp(colorMode, "solid") == 0) {
    return CRGB((staticColor >> 16) & 0xFF, (staticColor >> 8) & 0xFF, staticColor & 0xFF);
  }
  // Theme: simple palette by themeId
  const CRGB palette[][4] = {
    { CRGB::Green, CRGB::Yellow, CRGB::Cyan, CRGB::Magenta },
    { CRGB::Red, CRGB::Orange, CRGB::Gold, CRGB::Yellow },
    { CRGB::Blue, CRGB::Purple, CRGB::Teal, CRGB::Cyan },
  };
  int p = themeId % 3;
  int i = (currentNumber > 0 ? currentNumber : 0) % 4;
  return palette[p][i];
}

void applyGameTypeToMatrix() {
  int indices[25];
  int n = 0;
  getGameTypePhysicalIndices(indices, &n);
  CRGB dimWhite = CRGB(60, 60, 60);
  for (int i = 80; i <= 104; i++) leds[i] = CRGB::Black;
  for (int i = 0; i < n; i++) leds[indices[i]] = dimWhite;
}

void updateAllLeds() {
  FastLED.clear();
  FastLED.setBrightness(brightness);

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

  CRGB calledColor = colorForCalled();
  for (int n = 1; n <= 75; n++) {
    if (!called[n]) continue;
    int p = numberToPhysical(n);
    if (p >= 0) {
      leds[p] = calledColor;
      if (n == currentNumber) {
        uint8_t breathe = (millis() / 80) % 256;
        if (breathe > 128) breathe = 255 - breathe;
        leds[p].fadeToBlackBy(255 - (128 + breathe / 2));
      }
    }
  }
  // Letters on when column has at least one call
  for (int col = 0; col < 5; col++) {
    int low = col * 15 + 1, high = col * 15 + 15;
    bool any = false;
    for (int n = low; n <= high; n++) if (called[n]) { any = true; break; }
    int letterP = letterToPhysical("BINGO"[col]);
    if (letterP >= 0) leds[letterP] = any ? calledColor : CRGB::Black;
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
      updateAllLeds();
      return n;
    }
    k++;
  }
  return -1;
}

void doReset() {
  for (int i = 1; i <= 75; i++) {
    pool[i] = true;
    called[i] = false;
  }
  poolCount = 75;
  currentNumber = 0;
  gameEstablished = false;
  winnerDeclared = false;
  updateAllLeds();
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
        strcmp(gameTypeBuf, "cover_all") != 0 && strcmp(gameTypeBuf, "traditional") != 0)
      strcpy(gameTypeBuf, "traditional");
  }
  uint8_t cm;
  if (nvs_get_u8(nvs, NVS_COLOR_MODE, &cm) == ESP_OK)
    strcpy(colorModeBuf, (cm == 1) ? "solid" : "theme");
  nvs_close(nvs);
}

void saveNvsSettings() {
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return;
  nvs_set_u8(nvs, NVS_BRIGHTNESS, brightness);
  nvs_set_i32(nvs, NVS_THEME, themeId);
  nvs_set_u32(nvs, NVS_STATIC_COLOR, staticColor);
  nvs_set_u8(nvs, NVS_COLOR_MODE, strcmp(colorMode, "solid") == 0 ? 1 : 0);
  nvs_set_str(nvs, NVS_GAME_TYPE, gameType);
  nvs_commit(nvs);
  nvs_close(nvs);
}

void sendStateJson(AsyncWebServerRequest* req) {
  StaticJsonDocument<768> doc;
  doc["current"] = currentNumber;
  doc["remaining"] = poolCount;
  doc["gameType"] = gameType;
  doc["callingStyle"] = callingStyle;
  doc["gameEstablished"] = gameEstablished;
  doc["winnerDeclared"] = winnerDeclared;
  doc["theme"] = themeId;
  doc["brightness"] = brightness;
  doc["colorMode"] = colorMode;
  char hex[8];
  snprintf(hex, sizeof(hex), "#%06X", staticColor);
  doc["staticColor"] = hex;
  JsonArray arr = doc.createNestedArray("called");
  for (int n = 1; n <= 75; n++)
    if (called[n]) arr.add(n);
  String buf;
  serializeJson(doc, buf);
  req->send(200, "application/json", buf);
}

void setup() {
  Serial.begin(115200);
  randomSeed(esp_random());

  if (nvs_flash_init() == ESP_ERR_NVS_NO_FREE_PAGES) {
    nvs_flash_erase();
    nvs_flash_init();
  }
  loadNvs();

  FastLED.addLeds<WS2811, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(brightness);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  doReset();
  updateAllLeds();

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.println("AP started: " AP_SSID " – open http://192.168.4.1");

  server.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(SPIFFS, "/index.html", "text/html");
  });
  server.on("/tailwind.css", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(SPIFFS, "/tailwind.css", "text/css");
  });

  server.on("/api/state", HTTP_GET, [](AsyncWebServerRequest* req) { sendStateJson(req); });

  server.on("/draw", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (strcmp(callingStyle, "manual") != 0 && !gameEstablished) gameEstablished = true;
    if (strcmp(callingStyle, "manual") == 0) { req->send(400, "application/json", "{\"error\":\"manual mode\"}"); return; }
    int n = drawNext();
    if (n < 0) { req->send(400, "application/json", "{\"error\":\"pool empty\"}"); return; }
    sendStateJson(req);
  });
  server.on("/draw", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (strcmp(callingStyle, "manual") != 0 && !gameEstablished) gameEstablished = true;
    if (strcmp(callingStyle, "manual") == 0) { req->send(400, "application/json", "{\"error\":\"manual mode\"}"); return; }
    int n = drawNext();
    if (n < 0) { req->send(400, "application/json", "{\"error\":\"pool empty\"}"); return; }
    sendStateJson(req);
  });

  server.on("/reset", HTTP_POST, [](AsyncWebServerRequest* req) {
    doReset();
    req->send(200, "application/json", "{}");
  });

  server.addHandler(new AsyncCallbackJsonWebHandler("/calling-style", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (gameEstablished) { req->send(409, "application/json", "{\"error\":\"game established\"}"); return; }
    JsonObject obj = json.as<JsonObject>();
    const char* cs = obj["callingStyle"];
    if (cs && (strcmp(cs, "automatic") == 0 || strcmp(cs, "manual") == 0)) {
      strncpy(callingStyleBuf, cs, sizeof(callingStyleBuf) - 1);
      callingStyleBuf[sizeof(callingStyleBuf) - 1] = '\0';
      req->send(200, "application/json", "{}");
    } else req->send(400, "application/json", "{\"error\":\"invalid\"}");
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/call", [](AsyncWebServerRequest* req, JsonVariant& json) {
    if (strcmp(callingStyle, "manual") != 0) { req->send(400, "application/json", "{\"error\":\"not manual\"}"); return; }
    if (!gameEstablished) gameEstablished = true;
    JsonObject obj = json.as<JsonObject>();
    int num = obj["number"].as<int>();
    if (num < 1 || num > 75) { req->send(400, "application/json", "{\"error\":\"invalid number\"}"); return; }
    if (called[num]) { req->send(400, "application/json", "{\"error\":\"already called\"}"); return; }
    called[num] = true;
    if (pool[num]) { pool[num] = false; poolCount--; }
    currentNumber = num;
    updateAllLeds();
    sendStateJson(req);
  }));

  server.addHandler(new AsyncCallbackJsonWebHandler("/game-type", [](AsyncWebServerRequest* req, JsonVariant& json) {
    JsonObject obj = json.as<JsonObject>();
    const char* gt = obj["gameType"];
    if (gt && (strcmp(gt, "traditional") == 0 || strcmp(gt, "four_corners") == 0 ||
              strcmp(gt, "postage_stamp") == 0 || strcmp(gt, "cover_all") == 0)) {
      strncpy(gameTypeBuf, gt, sizeof(gameTypeBuf) - 1);
      gameTypeBuf[sizeof(gameTypeBuf) - 1] = '\0';
      updateAllLeds();
      saveNvsSettings();
      req->send(200, "application/json", "{}");
    } else req->send(400, "application/json", "{\"error\":\"invalid\"}");
  }));

  server.on("/declare-winner", HTTP_POST, [](AsyncWebServerRequest* req) {
    winnerDeclared = true;
    req->send(200, "application/json", "{}");
  });
  server.on("/clear-winner", HTTP_POST, [](AsyncWebServerRequest* req) {
    winnerDeclared = false;
    updateAllLeds();
    req->send(200, "application/json", "{}");
  });

  server.on("/brightness", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (req->hasParam("value", true)) {
      brightness = req->getParam("value", true)->value().toInt();
      if (brightness > 255) brightness = 255;
      FastLED.setBrightness(brightness);
      saveNvsSettings();
    }
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/brightness", [](AsyncWebServerRequest* req, JsonVariant& json) {
    JsonObject obj = json.as<JsonObject>();
    if (obj.containsKey("value")) {
      int v = obj["value"].as<int>();
      if (v >= 0 && v <= 255) { brightness = v; FastLED.setBrightness(brightness); saveNvsSettings(); }
    }
    req->send(200, "application/json", "{}");
  }));

  server.on("/theme", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (req->hasParam("value", true)) themeId = req->getParam("value", true)->value().toInt();
    if (req->hasParam("id", true)) themeId = req->getParam("id", true)->value().toInt();
    strcpy(colorModeBuf, "theme");
    updateAllLeds();
    saveNvsSettings();
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/theme", [](AsyncWebServerRequest* req, JsonVariant& json) {
    JsonObject obj = json.as<JsonObject>();
    if (obj.containsKey("theme")) themeId = obj["theme"].as<int>();
    else if (obj.containsKey("id")) themeId = obj["id"].as<int>();
    strcpy(colorModeBuf, "theme");
    updateAllLeds();
    saveNvsSettings();
    req->send(200, "application/json", "{}");
  }));

  server.on("/color", HTTP_POST, [](AsyncWebServerRequest* req) {
    String hex;
    if (req->hasParam("hex", true)) hex = req->getParam("hex", true)->value();
    if (req->hasParam("color", true)) hex = req->getParam("color", true)->value();
    if (hex.length() >= 6) {
      if (hex.startsWith("#")) hex = hex.substring(1);
      staticColor = (uint32_t)strtoul(hex.c_str(), nullptr, 16);
      strcpy(colorModeBuf, "solid");
      updateAllLeds();
      saveNvsSettings();
    }
    req->send(200, "application/json", "{}");
  });
  server.addHandler(new AsyncCallbackJsonWebHandler("/color", [](AsyncWebServerRequest* req, JsonVariant& json) {
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
    }
    req->send(200, "application/json", "{}");
  }));

  server.begin();
  if (!SPIFFS.begin(true)) Serial.println("SPIFFS mount failed");
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

  updateAllLeds();
  FastLED.show();
  delay(20);
}
