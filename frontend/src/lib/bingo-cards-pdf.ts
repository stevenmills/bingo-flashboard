import QRCode from "qrcode";
import { LETTERS } from "@/types";
import {
  buildCardClaimUrl,
  type SignedPrintableCard,
} from "@/lib/bingo-card-codec";
import { MiniPdf } from "@/lib/mini-pdf";

const LETTER_COLORS: Record<string, [number, number, number]> = {
  B: [59, 130, 246],
  I: [239, 68, 68],
  N: [16, 185, 129],
  G: [245, 158, 11],
  O: [168, 85, 247],
};

export const CARDS_PER_PAGE = 4;

function drawCard(
  doc: MiniPdf,
  card: SignedPrintableCard,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    cardIndex: number;
    claimUrl: string;
  }
) {
  const { x, y, width, height, cardIndex, claimUrl } = opts;
  const numbers = card.numbers;
  const isHousey = card.gameStyle === "housey";
  const pad = 6;
  const headerH = 16;
  // Tiny footer for card number only — footer QR for HOUSEY; space goes to the grid.
  const footerH = isHousey ? 24 : 10;
  const headerGap = 3;
  const gridTop = y + pad + headerH + headerGap;
  const gridBottom = y + height - pad - footerH;
  const gridH = gridBottom - gridTop;
  const gridW = width - pad * 2;
  const cellW = gridW / 5;
  const cellH = gridH / 5;

  doc.setStroke(180, 180, 180, 0.6);
  doc.roundedRect(x, y, width, height, 3, "S");

  const letterW = gridW / 5;
  LETTERS.forEach((letter, i) => {
    const [r, g, b] = LETTER_COLORS[letter];
    const lx = x + pad + i * letterW;
    doc.setFill(r, g, b);
    doc.roundedRect(lx + 0.5, y + pad, letterW - 1, headerH, 1.5, "f");
    doc.text(letter, lx + letterW / 2, y + pad + headerH / 2 + 3.5, {
      size: 10,
      bold: true,
      align: "center",
      color: [255, 255, 255],
    });
  });

  // H (~30% recovery) so a small centered "FREE" label doesn't break scanning.
  const qr = QRCode.create(claimUrl, { errorCorrectionLevel: "H" });

  doc.setStroke(200, 200, 200, 0.3);
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col;
      const cx = x + pad + col * cellW;
      const cy = gridTop + row * cellH;
      doc.setFill(255, 255, 255);
      doc.rect(cx, cy, cellW, cellH, "B");

      if (!isHousey && idx === 12) {
        // FREE cell = large scan-target QR with a modest center label.
        const inset = Math.max(1.5, Math.min(cellW, cellH) * 0.04);
        const qrSize = Math.min(cellW, cellH) - inset * 2;
        const qrX = cx + (cellW - qrSize) / 2;
        const qrY = cy + (cellH - qrSize) / 2;
        doc.drawQrModules(qr.modules, qrX, qrY, qrSize, [36, 36, 36]);

        const labelW = qrSize * 0.42;
        const labelH = Math.max(8, qrSize * 0.18);
        const labelX = qrX + (qrSize - labelW) / 2;
        const labelY = qrY + (qrSize - labelH) / 2;
        doc.setFill(255, 255, 255);
        doc.roundedRect(labelX, labelY, labelW, labelH, Math.min(2, labelH / 3), "f");
        const labelCenterX = labelX + labelW / 2 + Math.max(0.35, labelW * 0.02);
        doc.text("FREE", labelCenterX, labelY + labelH / 2 + labelH * 0.28, {
          size: Math.min(9, Math.max(5.5, labelH * 0.72)),
          bold: true,
          align: "center",
          color: [40, 40, 40],
        });
        continue;
      }

      const val = numbers[idx];
      if (val == null) continue; // HOUSEY blank
      doc.text(String(val), cx + cellW / 2, cy + cellH / 2 + 3.5, {
        size: Math.min(12, Math.max(9, cellH * 0.38)),
        align: "center",
        color: [30, 30, 30],
      });
    }
  }

  if (isHousey) {
    // Footer QR with quiet zone (HOUSEY has no FREE cell).
    const footerQr = 18;
    const qrX = x + pad;
    const qrY = y + height - pad - footerQr;
    doc.drawQrModules(qr.modules, qrX, qrY, footerQr, [36, 36, 36]);
    doc.text("HOUSEY", x + pad + footerQr + 4, y + height - pad - 4, {
      size: 6,
      color: [100, 100, 100],
    });
    doc.text(`Card ${cardIndex + 1}`, x + width - pad - 40, y + height - pad - 4, {
      size: 5.5,
      align: "left",
      color: [170, 170, 170],
    });
  } else {
    doc.text(`Card ${cardIndex + 1}`, x + width / 2, y + height - pad + 1, {
      size: 5.5,
      align: "center",
      color: [170, 170, 170],
    });
  }
}

/**
 * Build a letter PDF (8.5×11) with 4 cards per page (2×2).
 */
export async function buildBingoCardsPdf(
  cards: SignedPrintableCard[],
  origin?: string
): Promise<Blob> {
  const doc = new MiniPdf(612, 792);
  const pageW = doc.pageW;
  const pageH = doc.pageH;
  const margin = 22;
  const gapX = 12;
  const gapY = 12;
  const cardW = (pageW - margin * 2 - gapX) / 2;
  const cardH = (pageH - margin * 2 - gapY) / 2;

  for (let i = 0; i < cards.length; i++) {
    if (i > 0 && i % CARDS_PER_PAGE === 0) doc.addPage();
    const slot = i % CARDS_PER_PAGE;
    const col = slot % 2;
    const row = Math.floor(slot / 2);
    const x = margin + col * (cardW + gapX);
    const y = margin + row * (cardH + gapY);
    drawCard(doc, cards[i], {
      x,
      y,
      width: cardW,
      height: cardH,
      cardIndex: i,
      claimUrl: buildCardClaimUrl(cards[i].numbers, origin, cards[i].sig, cards[i].gameStyle ?? "bingo"),
    });
  }

  return doc.outputBlob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
