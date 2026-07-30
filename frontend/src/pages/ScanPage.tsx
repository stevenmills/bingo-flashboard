import { useEffect } from "react";
import { CardQrScanner } from "@/components/CardQrScanner";
import type { QrCardClaim } from "@/lib/bingo-card-codec";
import { prefetchQrDecoder } from "@/lib/decode-qr";
import type { AnyGameType } from "@/types";

interface Props {
  accentColor?: string;
  verifying?: boolean;
  gameType?: AnyGameType | string;
  onClaim: (claim: QrCardClaim) => void | Promise<void>;
}

export function ScanPage({ accentColor, verifying = false, gameType, onClaim }: Props) {
  useEffect(() => {
    prefetchQrDecoder();
  }, []);

  return (
    <div className="mx-auto max-w-lg space-y-3">
      <div className="space-y-0.5 text-center sm:text-left">
        <h2 className="text-lg font-semibold tracking-tight">Scan card</h2>
        <p className="text-xs text-muted-foreground">
          {gameType === "battleship"
            ? "Battleship: a card wins the scan check while any of its numbers are still uncalled (still afloat)."
            : "Verify a printable card against called numbers and the current game type."}
        </p>
      </div>
      <CardQrScanner active accentColor={accentColor} busy={verifying} onClaim={onClaim} />
    </div>
  );
}
