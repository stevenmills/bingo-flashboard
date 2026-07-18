#pragma once
#include <stdint.h>
#include <string.h>

#define HOUSEY_GAME_TYPE_COUNT 5
#define HOUSEY_MIN_POPULATED 10
#define HOUSEY_MAX_POPULATED 12

static const char* const HOUSEY_GAME_TYPES[HOUSEY_GAME_TYPE_COUNT] = {
  "battleship",
  "four_corners",
  "line",
  "two_lines",
  "full_house",
};

inline int findHouseyGameTypeIndex(const char* id) {
  if (!id) return -1;
  for (int i = 0; i < HOUSEY_GAME_TYPE_COUNT; i++) {
    if (strcmp(HOUSEY_GAME_TYPES[i], id) == 0) return i;
  }
  return -1;
}

inline bool isValidHouseyGameTypeId(const char* id) {
  return findHouseyGameTypeIndex(id) >= 0;
}

inline bool isGameStyleBingo(const char* style) {
  return style && strcmp(style, "bingo") == 0;
}

inline bool isGameStyleHousey(const char* style) {
  return style && strcmp(style, "housey") == 0;
}
