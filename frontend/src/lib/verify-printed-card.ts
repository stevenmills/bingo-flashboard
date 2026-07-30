import { api } from "@/api";
import type { QrCardClaim } from "@/lib/bingo-card-codec";

export type PrintedCardVerifyResult =
  | { outcome: "authentic_winner"; cardId: string }
  | { outcome: "not_authentic" }
  | { outcome: "no_winner" }
  | { outcome: "error" };

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
 */
export async function verifyScannedPrintedCard(
  claim: QrCardClaim,
  opts?: { refresh?: () => Promise<unknown> }
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
  opts?: { refresh?: () => Promise<unknown> }
): Promise<void> {
  await dropVerifySession(cardId);
  if (opts?.refresh) {
    void opts.refresh().catch(() => undefined);
  }
}
