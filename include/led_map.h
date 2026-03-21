#ifndef LED_MAP_H
#define LED_MAP_H

#include "config.h"

// Physical strip order is defined by the 5x21 CSV provided by hardware layout.
// This file maps logical IDs (numbers/letters/game cells) to physical LED index.

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
  return numberMap[n - 1];
}

// Letters B,I,N,G,O -> physical index (single LED each)
inline int letterToPhysical(char letter) {
  switch (letter) {
    case 'B': return 99;
    case 'I': return 68;
    case 'N': return 57;
    case 'G': return 26;
    case 'O': return 15;
    default:  return -1;
  }
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
  return gameTypeMap[cell - 1];
}

#endif
