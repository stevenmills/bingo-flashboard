#ifndef LED_MAP_H
#define LED_MAP_H

#include "config.h"

// Physical strip order: see plan. Logical number 1-75 -> physical index.
inline int numberToPhysical(int n) {
  if (n >= 1 && n <= 15) return 1 + (n - 1);           // B
  if (n >= 16 && n <= 30) return 16 + (30 - n);         // I
  if (n >= 31 && n <= 45) return 33 + (n - 31);         // N
  if (n >= 46 && n <= 60) return 48 + (60 - n);        // G
  if (n >= 61 && n <= 75) return 65 + (n - 61);         // O
  return -1;
}

// Letters B,I,N,G,O -> physical index (single LED each)
inline int letterToPhysical(char letter) {
  switch (letter) {
    case 'B': return 0;
    case 'I': return 31;
    case 'N': return 32;
    case 'G': return 63;
    case 'O': return 64;
    default:  return -1;
  }
}

// Game-type matrix: logical cell 1-25 (row-major) -> physical index
// Row 0: 1-5->80-84; Row 1: 10,9,8,7,6->85-89; Row 2: 11-15->90-94;
// Row 3: 20,19,18,17,16->95-99; Row 4: 21-25->100-104
inline int gameTypeCellToPhysical(int cell) {
  if (cell < 1 || cell > 25) return -1;
  int row = (cell - 1) / 5;
  int col = (cell - 1) % 5;
  static const int rowStart[5] = { 80, 85, 90, 95, 100 };
  if (row == 0) return rowStart[0] + col;
  if (row == 1) return rowStart[1] + (4 - col);  // reversed: 6,7,8,9,10 -> 89,88,87,86,85
  if (row == 2) return rowStart[2] + col;
  if (row == 3) return rowStart[3] + (4 - col);  // reversed
  return rowStart[4] + col;
}

#endif
