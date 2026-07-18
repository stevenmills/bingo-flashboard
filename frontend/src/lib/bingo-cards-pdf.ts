import QRCode from "qrcode";
import { LETTERS } from "@/types";
import {
  buildCardClaimUrl,
  type FlatCardNumbers,
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

/** Prefer center, else blank nearest to center (HOUSEY always has blanks). */
function pickBlankCell(numbers: FlatCardNumbers): number {
  if (numbers[12] == null) return 12;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < 25; i++) {
    if (numbers[i] != null) continue;
    const row = Math.floor(i / 5);
    const col = i % 5;
    const dist = Math.abs(row - 2) + Math.abs(col - 2);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best >= 0 ? best : 12;
}

function drawCellQr(
  doc: MiniPdf,
  modules: { size: number; get: (row: number, col: number) => number | boolean },
  cx: number,
  cy: number,
  cellW: number,
  cellH: number
) {
  const inset = Math.max(1.5, Math.min(cellW, cellH) * 0.04);
  const qrSize = Math.min(cellW, cellH) - inset * 2;
  const qrX = cx + (cellW - qrSize) / 2;
  const qrY = cy + (cellH - qrSize) / 2;
  doc.drawQrModules(modules, qrX, qrY, qrSize, [36, 36, 36]);
  return { qrX, qrY, qrSize };
}

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
  const footerH = 10;
  const headerGap = 3;
  const gridTop = y + pad + headerH + headerGap;
  const gridBottom = y + height - pad - footerH;
  const gridH = gridBottom - gridTop;
  const gridW = width - pad * 2;
  const cellW = gridW / 5;
  const cellH = gridH / 5;
  const houseyQrIdx = isHousey ? pickBlankCell(numbers) : -1;

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
        const { qrX, qrY, qrSize } = drawCellQr(doc, qr.modules, cx, cy, cellW, cellH);

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

      if (isHousey && idx === houseyQrIdx) {
        // Blank cell = claim QR at the same size as BINGO FREE.
        drawCellQr(doc, qr.modules, cx, cy, cellW, cellH);
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
    doc.text(`HOUSEY · Card ${cardIndex + 1}`, x + width / 2, y + height - pad + 1, {
      size: 5.5,
      align: "center",
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
