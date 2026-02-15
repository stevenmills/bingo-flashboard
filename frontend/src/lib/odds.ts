import type { GameType } from "@/types";

export const GAME_TYPE_REQUIRED_HITS: Record<GameType, number> = {
  traditional: 5,
  four_corners: 4,
  postage_stamp: 4,
  cover_all: 25,
  x: 8,
  y: 5,
  frame_outside: 16,
  frame_inside: 8,
  plus_sign: 8,
  field_goal: 10,
};

export interface MonteCarloConfig {
  opponents: number;
  cardsPerOpponent: number;
  trials: number;
}

export interface OddsRow {
  covered: number;
  needed: number;
  probability: number; // 0..1, estimated game win probability
}

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function sampleKthHitDraw(needed: number, remainingPool: number): number {
  if (needed <= 0) return 0;
  if (needed > remainingPool) return Number.POSITIVE_INFINITY;

  // Sample `needed` unique draw positions from [1..remainingPool] and return the max.
  let maxDraw = 0;
  const swaps = new Map<number, number>();
  for (let i = 0; i < needed; i++) {
    const upper = remainingPool - i;
    const pick = randomInt(upper);
    const chosen = swaps.get(pick) ?? pick;
    const tailIdx = upper - 1;
    const tailVal = swaps.get(tailIdx) ?? tailIdx;
    swaps.set(pick, tailVal);
    if (chosen + 1 > maxDraw) maxDraw = chosen + 1;
  }
  return maxDraw;
}

function sampleHypergeometricHits(population: number, successes: number, draws: number): number {
  let remainingPopulation = population;
  let remainingSuccesses = successes;
  let hits = 0;

  for (let i = 0; i < draws; i++) {
    if (remainingSuccesses <= 0) break;
    const pick = randomInt(remainingPopulation);
    if (pick < remainingSuccesses) {
      hits++;
      remainingSuccesses--;
    }
    remainingPopulation--;
  }

  return hits;
}

function estimateWinProbabilitiesByNeeded(
  required: number,
  remainingPool: number,
  config: MonteCarloConfig
): number[] {
  const probabilities = new Array<number>(required + 1).fill(0);
  const opponents = Math.max(0, Math.floor(config.opponents));
  const cardsPerOpponent = Math.max(1, Math.floor(config.cardsPerOpponent));
  const trialCount = Math.max(1, Math.floor(config.trials));

  if (remainingPool <= 0) return probabilities;
  if (opponents <= 0) {
    for (let needed = 1; needed <= required; needed++) {
      probabilities[needed] = needed <= remainingPool ? 1 : 0;
    }
    return probabilities;
  }

  const calledCount = Math.max(0, 75 - remainingPool);
  const winsByNeeded = new Array<number>(required + 1).fill(0);

  for (let trial = 0; trial < trialCount; trial++) {
    let earliestOpponentWin = Number.POSITIVE_INFINITY;

    for (let opponent = 0; opponent < opponents; opponent++) {
      let opponentBestCardWin = Number.POSITIVE_INFINITY;

      for (let card = 0; card < cardsPerOpponent; card++) {
        const hitsAlreadyCovered = sampleHypergeometricHits(75, calledCount, required);
        const opponentNeeded = Math.max(0, required - hitsAlreadyCovered);
        const opponentWinDraw = sampleKthHitDraw(opponentNeeded, remainingPool);
        if (opponentWinDraw < opponentBestCardWin) opponentBestCardWin = opponentWinDraw;
      }

      if (opponentBestCardWin < earliestOpponentWin) earliestOpponentWin = opponentBestCardWin;
    }

    for (let needed = 1; needed <= required; needed++) {
      const ourWinDraw = sampleKthHitDraw(needed, remainingPool);
      if (ourWinDraw < earliestOpponentWin) {
        winsByNeeded[needed] += 1;
      } else if (ourWinDraw === earliestOpponentWin) {
        // Split ties as a neutral estimate when wins happen on the same draw.
        winsByNeeded[needed] += 0.5;
      }
    }
  }

  for (let needed = 1; needed <= required; needed++) {
    probabilities[needed] = winsByNeeded[needed] / trialCount;
  }

  return probabilities;
}

export function buildOddsRows(gameType: GameType, remainingPool: number, config: MonteCarloConfig): OddsRow[] {
  const required = GAME_TYPE_REQUIRED_HITS[gameType];
  const probabilitiesByNeeded = estimateWinProbabilitiesByNeeded(required, remainingPool, config);
  const rows: OddsRow[] = [];

  for (let covered = required - 1; covered >= 0; covered--) {
    const needed = required - covered;
    rows.push({
      covered,
      needed,
      probability: probabilitiesByNeeded[needed] ?? 0,
    });
  }

  return rows;
}

export function formatProbability(probability: number): string {
  const percent = probability * 100;
  if (percent >= 1) return `${percent.toFixed(1)}%`;
  if (percent > 0) return `${percent.toFixed(2)}%`;
  return "0%";
}
