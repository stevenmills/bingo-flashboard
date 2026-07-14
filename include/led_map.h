#ifndef LED_MAP_H
#define LED_MAP_H

#include "config.h"
#include <string.h>

// Physical strip order is defined by the 5x21 CSV provided by hardware layout.
// This file maps logical IDs (numbers/letters/game cells) to physical LED index.

// Board section IDs (fixed left-to-right: letters, numbers, game type).
#define SEC_GAME_TYPE 0
#define SEC_LETTERS   1
#define SEC_NUMBERS   2

static const int SECTION_WIDTH[3] = {5, 1, 15};

// boardSectionOrder[i] = section id at visual position i (left to right). Hardcoded at boot.
extern uint8_t boardSectionOrder[3];
extern int sectionStartCol[3];

inline void physicalToMatrix(int physical, int& row, int& col) {
  if (physical < 0 || physical >= NUM_LEDS) {
    row = -1;
    col = -1;
    return;
  }
  const int rowFromBottom = physical / 21;
  const int colOffset = physical % 21;
  row = 4 - rowFromBottom;
  const bool rightToLeft = (rowFromBottom % 2) == 0;
  col = rightToLeft ? (20 - colOffset) : colOffset;
}

inline void recomputeSectionStarts() {
  int pos = 0;
  memset(sectionStartCol, 0, sizeof(sectionStartCol));
  for (int i = 0; i < 3; i++) {
    const int sec = boardSectionOrder[i];
    sectionStartCol[sec] = pos;
    pos += SECTION_WIDTH[sec];
  }
}

inline int remapCol(int defaultCol) {
  int section;
  int localCol;
  if (defaultCol <= 4) {
    section = SEC_GAME_TYPE;
    localCol = defaultCol;
  } else if (defaultCol == 5) {
    section = SEC_LETTERS;
    localCol = 0;
  } else {
    section = SEC_NUMBERS;
    localCol = defaultCol - 6;
  }
  return sectionStartCol[section] + localCol;
}

// Full-board matrix helper for screensaver rendering (21 columns x 5 rows).
// Coordinates are visual row-major from top-left (0,0) to bottom-right (4,20).
// Physical strip is serpentine starting at bottom-right (LED 0) and ending top-left (LED 104).
inline int matrix21x5ToPhysical(int row, int col) {
  if (row < 0 || row >= 5 || col < 0 || col >= 21) return -1;
  const int rowFromBottom = 4 - row;          // 0=bottom row ... 4=top row
  const int rowBase = rowFromBottom * 21;
  const bool rightToLeft = (rowFromBottom % 2) == 0;
  const int colOffset = rightToLeft ? (20 - col) : col;
  return rowBase + colOffset;
}

inline int remapPhysical(int defaultPhysical) {
  int row = -1;
  int col = -1;
  physicalToMatrix(defaultPhysical, row, col);
  if (row < 0) return defaultPhysical;
  const int newCol = remapCol(col);
  return matrix21x5ToPhysical(row, newCol);
}

// Logical number 1-75 -> physical index (derived from CSV physical order).
inline int numberToPhysical(int n) {
  static const int numberMap[75] = {
    98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, // 1..15
    69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, // 16..30
    56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, // 31..45
    27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, // 46..60
    14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0            // 61..75
  };
  if (n < 1 || n > 75) return -1;
  return remapPhysical(numberMap[n - 1]);
}

// Letters B,I,N,G,O -> physical index (single LED each)
inline int letterToPhysical(char letter) {
  int defaultPhysical = -1;
  switch (letter) {
    case 'B': defaultPhysical = 99; break;
    case 'I': defaultPhysical = 68; break;
    case 'N': defaultPhysical = 57; break;
    case 'G': defaultPhysical = 26; break;
    case 'O': defaultPhysical = 15; break;
    default:  return -1;
  }
  return remapPhysical(defaultPhysical);
}

// Game-type matrix: logical cell 1-25 (row-major) -> physical index
// Derived from CSV physical order.
inline int gameTypeCellToPhysical(int cell) {
  static const int gameTypeMap[25] = {
    104, 103, 102, 101, 100, // 1..5
    63, 64, 65, 66, 67,       // 6..10
    62, 61, 60, 59, 58,       // 11..15
    21, 22, 23, 24, 25,       // 16..20
    20, 19, 18, 17, 16        // 21..25
  };
  if (cell < 1 || cell > 25) return -1;
  return remapPhysical(gameTypeMap[cell - 1]);
}

#endif
