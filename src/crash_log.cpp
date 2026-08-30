/**
 * Persistent crash diagnostics (lightweight).
 *
 * Panic path writes only to RTC_NOINIT (no flash). On the next boot we copy that
 * breadcrumb + esp_reset_reason() into a small NVS blob for HTTP retrieval.
 *
 * No coredump partition — keeps SPIFFS intact. Brownout / hard power-loss may
 * leave only a reset reason (or nothing in RTC).
 */

#include "crash_log.h"
#include "config.h"

#include <nvs.h>
#include <string.h>
#include "esp_system.h"
#include "esp_attr.h"
#include "esp_private/panic_internal.h"

#define CRASH_RTC_MAGIC 0xC8A51106UL
#define CRASH_MARK_MAGIC 0xB8EAD001UL
#define CRASH_NVS_MAGIC 0xC10C0001UL
#define CRASH_REASON_MAX 48
#define CRASH_MARK_MAX 24

struct CrashRtcBreadcrumb {
  uint32_t magic;  // CRASH_RTC_MAGIC when panic wrote this
  uint32_t pc;
  int8_t core;
  uint8_t exception;
  char reason[CRASH_REASON_MAX];

  uint32_t markMagic;  // CRASH_MARK_MAGIC when app updated breadcrumb
  uint32_t uptimeMs;
  uint32_t freeHeap;
  uint16_t ssSpeedMs;
  uint8_t ssType;
  uint8_t ssEnabled;
  uint8_t callCount;
  uint8_t gameEstablished;
  uint8_t winnerDeclared;
  char mark[CRASH_MARK_MAX];
};

/** Packed record persisted in NVS (key NVS_CRASH_LOG). */
struct CrashNvsRecord {
  uint32_t magic;
  uint8_t resetReason;
  uint8_t hadPanicBreadcrumb;
  uint8_t exception;
  int8_t core;
  uint32_t pc;
  uint32_t uptimeMs;
  uint32_t freeHeap;
  uint16_t ssSpeedMs;
  uint8_t ssType;
  uint8_t ssEnabled;
  uint8_t callCount;
  uint8_t gameEstablished;
  uint8_t winnerDeclared;
  char reason[CRASH_REASON_MAX];
  char mark[CRASH_MARK_MAX];
};

RTC_NOINIT_ATTR static CrashRtcBreadcrumb g_crashRtc;

static esp_reset_reason_t g_bootResetReason = ESP_RST_UNKNOWN;
static bool g_hasNvsRecord = false;
static CrashNvsRecord g_nvsRecord;
static bool g_cleanRestartPending = false;

static void copyCapped(char* dst, size_t dstLen, const char* src) {
  if (!dst || dstLen == 0) return;
  if (!src) {
    dst[0] = '\0';
    return;
  }
  size_t i = 0;
  for (; i + 1 < dstLen && src[i] != '\0'; i++) dst[i] = src[i];
  dst[i] = '\0';
}

const char* crashLogResetReasonName(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_UNKNOWN: return "unknown";
    case ESP_RST_POWERON: return "power_on";
    case ESP_RST_EXT: return "ext";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "int_wdt";
    case ESP_RST_TASK_WDT: return "task_wdt";
    case ESP_RST_WDT: return "wdt";
    case ESP_RST_DEEPSLEEP: return "deep_sleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    default: return "other";
  }
}

static bool isAbnormalReset(esp_reset_reason_t r) {
  return r == ESP_RST_PANIC || r == ESP_RST_INT_WDT || r == ESP_RST_TASK_WDT ||
         r == ESP_RST_WDT || r == ESP_RST_BROWNOUT;
}

static bool loadNvsRecord() {
  nvs_handle_t nvs;
  if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs) != ESP_OK) return false;
  CrashNvsRecord rec;
  size_t len = sizeof(rec);
  esp_err_t err = nvs_get_blob(nvs, NVS_CRASH_LOG, &rec, &len);
  nvs_close(nvs);
  if (err != ESP_OK || len != sizeof(rec) || rec.magic != CRASH_NVS_MAGIC) return false;
  g_nvsRecord = rec;
  g_hasNvsRecord = true;
  return true;
}

static bool saveNvsRecord(const CrashNvsRecord& rec) {
  nvs_handle_t nvs;
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return false;
  esp_err_t err = nvs_set_blob(nvs, NVS_CRASH_LOG, &rec, sizeof(rec));
  if (err == ESP_OK) err = nvs_commit(nvs);
  nvs_close(nvs);
  if (err != ESP_OK) return false;
  g_nvsRecord = rec;
  g_hasNvsRecord = true;
  return true;
}

static void persistBootResetReason(esp_reset_reason_t r) {
  nvs_handle_t nvs;
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return;
  nvs_set_u8(nvs, NVS_LAST_RESET_REASON, (uint8_t)r);
  nvs_commit(nvs);
  nvs_close(nvs);
}

extern "C" {
void __real_esp_panic_handler(panic_info_t* info);

void IRAM_ATTR __wrap_esp_panic_handler(panic_info_t* info) {
  // Flash / heap / printf are unsafe here — RTC only.
  g_crashRtc.magic = CRASH_RTC_MAGIC;
  g_crashRtc.pc = info && info->addr ? (uint32_t)(uintptr_t)info->addr : 0;
  g_crashRtc.core = info ? (int8_t)info->core : -1;
  g_crashRtc.exception = info ? (uint8_t)info->exception : 0xFF;
  g_crashRtc.reason[0] = '\0';
  if (info && info->reason) {
    const char* src = info->reason;
    size_t i = 0;
    for (; i + 1 < CRASH_REASON_MAX && src[i] != '\0'; i++) g_crashRtc.reason[i] = src[i];
    g_crashRtc.reason[i] = '\0';
  }
  __real_esp_panic_handler(info);
}
}  // extern "C"

void crashLogBegin() {
  g_bootResetReason = esp_reset_reason();
  persistBootResetReason(g_bootResetReason);
  loadNvsRecord();

  const bool panicBreadcrumb = (g_crashRtc.magic == CRASH_RTC_MAGIC);
  const bool markOk = (g_crashRtc.markMagic == CRASH_MARK_MAGIC);
  const bool abnormal = isAbnormalReset(g_bootResetReason) || panicBreadcrumb;

  if (abnormal) {
    CrashNvsRecord rec;
    memset(&rec, 0, sizeof(rec));
    rec.magic = CRASH_NVS_MAGIC;
    rec.resetReason = (uint8_t)g_bootResetReason;
    rec.hadPanicBreadcrumb = panicBreadcrumb ? 1 : 0;
    if (panicBreadcrumb) {
      rec.pc = g_crashRtc.pc;
      rec.core = g_crashRtc.core;
      rec.exception = g_crashRtc.exception;
      copyCapped(rec.reason, sizeof(rec.reason), g_crashRtc.reason);
    }
    if (markOk) {
      rec.uptimeMs = g_crashRtc.uptimeMs;
      rec.freeHeap = g_crashRtc.freeHeap;
      rec.ssSpeedMs = g_crashRtc.ssSpeedMs;
      rec.ssType = g_crashRtc.ssType;
      rec.ssEnabled = g_crashRtc.ssEnabled;
      rec.callCount = g_crashRtc.callCount;
      rec.gameEstablished = g_crashRtc.gameEstablished;
      rec.winnerDeclared = g_crashRtc.winnerDeclared;
      copyCapped(rec.mark, sizeof(rec.mark), g_crashRtc.mark);
    }
    if (saveNvsRecord(rec)) {
      Serial.printf("Crash log saved: reason=%s panic=%d pc=0x%08lx mark=%s\n",
                    crashLogResetReasonName(g_bootResetReason),
                    (int)rec.hadPanicBreadcrumb,
                    (unsigned long)rec.pc,
                    rec.mark[0] ? rec.mark : "-");
    } else {
      Serial.println("Crash log: NVS save failed");
    }
  } else if (g_bootResetReason == ESP_RST_SW) {
    Serial.println("Crash log: clean software restart");
  } else {
    Serial.printf("Crash log: boot reset=%s\n", crashLogResetReasonName(g_bootResetReason));
  }

  // Consume RTC panic marker so a later clean reboot does not re-save it.
  g_crashRtc.magic = 0;
  if (!markOk) {
    memset(&g_crashRtc, 0, sizeof(g_crashRtc));
  } else {
    // Keep mark fields; clear only panic stamp.
    g_crashRtc.pc = 0;
    g_crashRtc.core = 0;
    g_crashRtc.exception = 0;
    g_crashRtc.reason[0] = '\0';
  }
}

void crashLogUpdateBreadcrumb(uint16_t ssSpeedMs, uint8_t ssType, bool ssEnabled,
                              uint8_t callCount, bool gameEstablished, bool winnerDeclared,
                              uint32_t freeHeap, const char* mark) {
  if (g_cleanRestartPending) return;
  g_crashRtc.markMagic = CRASH_MARK_MAGIC;
  g_crashRtc.uptimeMs = millis();
  g_crashRtc.freeHeap = freeHeap;
  g_crashRtc.ssSpeedMs = ssSpeedMs;
  g_crashRtc.ssType = ssType;
  g_crashRtc.ssEnabled = ssEnabled ? 1 : 0;
  g_crashRtc.callCount = callCount;
  g_crashRtc.gameEstablished = gameEstablished ? 1 : 0;
  g_crashRtc.winnerDeclared = winnerDeclared ? 1 : 0;
  copyCapped(g_crashRtc.mark, sizeof(g_crashRtc.mark), mark ? mark : "");
}

void crashLogMarkCleanRestart() {
  g_cleanRestartPending = true;
  g_crashRtc.magic = 0;
  g_crashRtc.markMagic = CRASH_MARK_MAGIC;
  g_crashRtc.uptimeMs = millis();
  copyCapped(g_crashRtc.mark, sizeof(g_crashRtc.mark), "clean_restart");
}

bool crashLogHasRecord() { return g_hasNvsRecord; }

bool crashLogClearRecord() {
  nvs_handle_t nvs;
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return false;
  nvs_erase_key(nvs, NVS_CRASH_LOG);
  nvs_commit(nvs);
  nvs_close(nvs);
  g_hasNvsRecord = false;
  memset(&g_nvsRecord, 0, sizeof(g_nvsRecord));
  return true;
}

const char* crashLogBootResetReasonName() {
  return crashLogResetReasonName(g_bootResetReason);
}

int crashLogBootResetReasonCode() { return (int)g_bootResetReason; }

void crashLogPopulateJson(JsonObject doc) {
  doc["bootResetReason"] = crashLogBootResetReasonName();
  doc["bootResetReasonCode"] = crashLogBootResetReasonCode();
  doc["hasCrash"] = g_hasNvsRecord;
  doc["note"] =
      "Panic/WDT breadcrumbs use RTC+NVS. Brownout or hard power-loss may leave only "
      "a reset reason (or nothing). Full core-dump partition is not enabled.";

  if (!g_hasNvsRecord) {
    doc["crash"] = nullptr;
    return;
  }

  JsonObject crash = doc.createNestedObject("crash");
  crash["resetReason"] = crashLogResetReasonName((esp_reset_reason_t)g_nvsRecord.resetReason);
  crash["resetReasonCode"] = g_nvsRecord.resetReason;
  crash["hadPanicBreadcrumb"] = g_nvsRecord.hadPanicBreadcrumb != 0;
  crash["pc"] = g_nvsRecord.pc;
  char pcHex[12];
  snprintf(pcHex, sizeof(pcHex), "0x%08lx", (unsigned long)g_nvsRecord.pc);
  crash["pcHex"] = pcHex;
  crash["core"] = g_nvsRecord.core;
  crash["exception"] = g_nvsRecord.exception;
  crash["reason"] = g_nvsRecord.reason;
  crash["uptimeMs"] = g_nvsRecord.uptimeMs;
  crash["freeHeap"] = g_nvsRecord.freeHeap;
  crash["screensaverSpeedMs"] = g_nvsRecord.ssSpeedMs;
  crash["screensaverType"] = g_nvsRecord.ssType;
  crash["screensaverEnabled"] = g_nvsRecord.ssEnabled != 0;
  crash["callOrderCount"] = g_nvsRecord.callCount;
  crash["gameEstablished"] = g_nvsRecord.gameEstablished != 0;
  crash["winnerDeclared"] = g_nvsRecord.winnerDeclared != 0;
  crash["mark"] = g_nvsRecord.mark;
}
