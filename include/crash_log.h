#ifndef CRASH_LOG_H
#define CRASH_LOG_H

#include <Arduino.h>
#include <ArduinoJson.h>

/** Call once after nvs_flash_init(). Captures reset reason + any panic breadcrumb. */
void crashLogBegin();

/** Refresh RTC app breadcrumb (safe; call ~1 Hz from loop). */
void crashLogUpdateBreadcrumb(uint16_t ssSpeedMs, uint8_t ssType, bool ssEnabled,
                              uint8_t callCount, bool gameEstablished, bool winnerDeclared,
                              uint32_t freeHeap, const char* mark);

/** Mark an intentional software restart so the next boot is not treated as mysterious. */
void crashLogMarkCleanRestart();

/** True if NVS holds a saved abnormal-reset / panic record. */
bool crashLogHasRecord();

/** Clear the persisted NVS crash record (not the current-boot reset reason). */
bool crashLogClearRecord();

/** Fill JSON for GET /api/crash-log (caller owns doc capacity). */
void crashLogPopulateJson(JsonObject doc);

/** Short string for esp_reset_reason() of this boot. */
const char* crashLogBootResetReasonName();

int crashLogBootResetReasonCode();

#endif
