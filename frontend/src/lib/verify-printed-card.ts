import { api } from "@/api";
import type { QrCardClaim } from "@/lib/bingo-card-codec";
import { cardHasUncalledPopulated } from "@/lib/card";
import type { AnyGameType } from "@/types";

export type PrintedCardVerifyResult =
  | {
      outcome: "authentic_winner";
      cardId: string;
      /** True when scan used /declare-winner for LED mode (Battleship afloat). */
      clearManualWinner?: boolean;
    }
  | { outcome: "not_authentic" }
  | { outcome: "no_winner" }
  | { outcome: "error" };

export type VerifyPrintedCardOptions = {
  refresh?: () => Promise<unknown>;
  /** Current board game type — Battleship uses afloat (uncalled) scan rules. */
  gameType?: AnyGameType | string;
  /** Called numbers for Battleship afloat checks. */
  called?: number[];
};

async function dropVerifySession(cardId: string): Promise<void> {
  try {
    await api.leaveCard(cardId);
  } catch {
    // Best effort — session may already be gone.
  }
}

/**
 * Verify a printable card against the live game via /card/claim.
 *
 * - Non-winners / invalid: leave the temp session immediately (no LED winner mode).
 * - Authentic winners: keep the session so the flashboard enters winner mode; the
 *   caller should leave via {@link releaseScannedWinnerSession} when the UI dismisses.
 * - Battleship scan only: winner when the card still has ≥1 uncalled populated
 *   number (still afloat). Live last-survivor rules are unchanged; LED shimmer
 *   uses /declare-winner when the card is not already a server winner.
 */
export async function verifyScannedPrintedCard(
  claim: QrCardClaim,
  opts?: VerifyPrintedCardOptions
): Promise<PrintedCardVerifyResult> {
  const kickRefresh = () => {
    if (!opts?.refresh) return;
    void opts.refresh().catch(() => undefined);
  };

  try {
    const result = await api.claimPrintedCard(claim.numbers, claim.sig);

    if (result.authentic !== true) {
      await dropVerifySession(result.cardId);
      kickRefresh();
      return { outcome: "not_authentic" };
    }

    if (opts?.gameType === "battleship") {
      const calledSet = new Set(opts.called ?? []);
      const stillAfloat = cardHasUncalledPopulated(claim.numbers, calledSet);
      if (stillAfloat) {
        if (result.winner) {
          // Last-survivor / co-sunk: keep session so LEDs follow winnerCount.
          kickRefresh();
          return { outcome: "authentic_winner", cardId: result.cardId };
        }
        // Afloat scan win is not a live last-survivor win — leave so survivor
        // counts stay clean, then declare manual winner for LED shimmer.
        await dropVerifySession(result.cardId);
        try {
          await api.declareWinner();
        } catch {
          kickRefresh();
          return { outcome: "error" };
        }
        kickRefresh();
        return {
          outcome: "authentic_winner",
          cardId: result.cardId,
          clearManualWinner: true,
        };
      }
      await dropVerifySession(result.cardId);
      kickRefresh();
      return { outcome: "no_winner" };
    }

    if (result.winner) {
      // Keep session joined so LEDs flip to winner mode.
      kickRefresh();
      return { outcome: "authentic_winner", cardId: result.cardId };
    }

    await dropVerifySession(result.cardId);
    kickRefresh();
    return { outcome: "no_winner" };
  } catch {
    return { outcome: "error" };
  }
}

/** Drop a scan-verify winner session so LED winner mode can clear. */
export async function releaseScannedWinnerSession(
  cardId: string,
  opts?: { refresh?: () => Promise<unknown>; clearManualWinner?: boolean }
): Promise<void> {
  if (opts?.clearManualWinner) {
    try {
      await api.clearWinner();
    } catch {
      // Best effort — board may already have cleared.
    }
  }
  await dropVerifySession(cardId);
  if (opts?.refresh) {
    void opts.refresh().catch(() => undefined);
  }
}
