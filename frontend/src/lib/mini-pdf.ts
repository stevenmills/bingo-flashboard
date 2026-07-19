/**
 * Minimal letter-page PDF builder for bingo cards.
 * Avoids jspdf/html2canvas (~600KB+) so SPIFFS stays under budget.
 */
export type PdfColor = [number, number, number]; // 0–255 RGB

function escPdfText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function byteLengthUtf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Approximate Helvetica glyph widths in 1/1000 em (Adobe WinAnsi core fonts).
 */
const HELVETICA_WIDTHS: Record<string, number> = {
  " ": 278,
  "0": 556,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 556,
  F: 556,
  G: 722,
  H: 722,
  I: 222,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 667,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
};

/** Helvetica-Bold widths (do not also scale Regular metrics). */
const HELVETICA_BOLD_WIDTHS: Record<string, number> = {
  ...HELVETICA_WIDTHS,
  A: 722,
  B: 722,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 778,
  I: 278,
  J: 556,
  K: 722,
  L: 611,
  M: 944,
  N: 778,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 1000,
  X: 722,
  Y: 722,
  Z: 667,
  "0": 556,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
};

function measureHelveticaWidth(str: string, size: number, bold = false): number {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let units = 0;
  for (const ch of str) {
    units += table[ch] ?? 556;
  }
  return (units * size) / 1000;
}

export class MiniPdf {
  readonly pageW: number;
  readonly pageH: number;
  private pages: string[] = [];
  private content = "";

  constructor(pageW = 612, pageH = 792) {
    this.pageW = pageW;
    this.pageH = pageH;
    this.addPage();
  }

  addPage() {
    if (this.content) this.pages.push(this.content);
    this.content = "";
  }

  /** Convert top-left Y (like canvas/CSS) to PDF bottom-left Y. */
  private ty(y: number): number {
    return this.pageH - y;
  }

  setStroke(r: number, g: number, b: number, width = 0.6) {
    this.content += `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} RG\n`;
    this.content += `${width.toFixed(2)} w\n`;
  }

  setFill(r: number, g: number, b: number) {
    this.content += `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} rg\n`;
  }

  rect(x: number, y: number, w: number, h: number, style: "S" | "f" | "B" = "S") {
    const by = this.ty(y + h);
    this.content += `${x.toFixed(2)} ${by.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${style}\n`;
  }

  /** Stroke a line from (x1,y1) to (x2,y2) in top-left coordinates. */
  line(x1: number, y1: number, x2: number, y2: number) {
    this.content += `${x1.toFixed(2)} ${this.ty(y1).toFixed(2)} m ${x2.toFixed(2)} ${this.ty(y2).toFixed(2)} l S\n`;
  }

  roundedRect(x: number, y: number, w: number, h: number, r: number, style: "S" | "f" | "B" = "S") {
    const rad = Math.min(r, w / 2, h / 2);
    const x0 = x;
    const x1 = x + w;
    const yTop = this.ty(y);
    const yBot = this.ty(y + h);
    const k = rad * 0.5523;
    this.content +=
      `${(x0 + rad).toFixed(2)} ${yBot.toFixed(2)} m\n` +
      `${(x1 - rad).toFixed(2)} ${yBot.toFixed(2)} l\n` +
      `${(x1 - rad + k).toFixed(2)} ${yBot.toFixed(2)} ${x1.toFixed(2)} ${(yBot + rad - k).toFixed(2)} ${x1.toFixed(2)} ${(
        yBot + rad
      ).toFixed(2)} c\n` +
      `${x1.toFixed(2)} ${(yTop - rad).toFixed(2)} l\n` +
      `${x1.toFixed(2)} ${(yTop - rad + k).toFixed(2)} ${(x1 - rad + k).toFixed(2)} ${yTop.toFixed(2)} ${(
        x1 - rad
      ).toFixed(2)} ${yTop.toFixed(2)} c\n` +
      `${(x0 + rad).toFixed(2)} ${yTop.toFixed(2)} l\n` +
      `${(x0 + rad - k).toFixed(2)} ${yTop.toFixed(2)} ${x0.toFixed(2)} ${(yTop - rad + k).toFixed(2)} ${x0.toFixed(
        2
      )} ${(yTop - rad).toFixed(2)} c\n` +
      `${x0.toFixed(2)} ${(yBot + rad).toFixed(2)} l\n` +
      `${x0.toFixed(2)} ${(yBot + rad - k).toFixed(2)} ${(x0 + rad - k).toFixed(2)} ${yBot.toFixed(2)} ${(
        x0 + rad
      ).toFixed(2)} ${yBot.toFixed(2)} c\n` +
      `${style}\n`;
  }

  /** Stroke or fill a circle (center cx,cy; radius r). */
  circle(cx: number, cy: number, r: number, style: "S" | "f" | "B" = "S") {
    const k = r * 0.5523;
    const y = this.ty(cy);
    this.content +=
      `${(cx + r).toFixed(2)} ${y.toFixed(2)} m\n` +
      `${(cx + r).toFixed(2)} ${(y + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(y + r).toFixed(2)} ${cx.toFixed(2)} ${(
        y + r
      ).toFixed(2)} c\n` +
      `${(cx - k).toFixed(2)} ${(y + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(y + k).toFixed(2)} ${(cx - r).toFixed(
        2
      )} ${y.toFixed(2)} c\n` +
      `${(cx - r).toFixed(2)} ${(y - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(y - r).toFixed(2)} ${cx.toFixed(2)} ${(
        y - r
      ).toFixed(2)} c\n` +
      `${(cx + k).toFixed(2)} ${(y - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(y - k).toFixed(2)} ${(cx + r).toFixed(
        2
      )} ${y.toFixed(2)} c\n` +
      `${style}\n`;
  }

  text(
    str: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; align?: "left" | "center"; color?: PdfColor } = {}
  ) {
    const size = opts.size ?? 10;
    const font = opts.bold ? "F2" : "F1";
    const [cr, cg, cb] = opts.color ?? [30, 30, 30];
    let tx = x;
    if (opts.align === "center") {
      tx = x - measureHelveticaWidth(str, size, Boolean(opts.bold)) / 2;
    }
    const baseline = this.ty(y);
    this.content += "BT\n";
    this.content += `/${font} ${size} Tf\n`;
    this.content += `${(cr / 255).toFixed(3)} ${(cg / 255).toFixed(3)} ${(cb / 255).toFixed(3)} rg\n`;
    this.content += `1 0 0 1 ${tx.toFixed(2)} ${baseline.toFixed(2)} Tm\n`;
    this.content += `(${escPdfText(str)}) Tj\n`;
    this.content += "ET\n";
  }

  drawQrModules(
    modules: { size: number; get: (row: number, col: number) => number | boolean },
    x: number,
    y: number,
    size: number,
    color: PdfColor = [42, 42, 42]
  ) {
    const n = modules.size;
    const cell = size / n;
    this.setFill(color[0], color[1], color[2]);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!modules.get(row, col)) continue;
        this.rect(x + col * cell, y + row * cell, cell + 0.15, cell + 0.15, "f");
      }
    }
  }

  outputBlob(): Blob {
    if (this.content) this.pages.push(this.content);
    this.content = "";

    const objects: string[] = [];
    const addObj = (body: string) => {
      objects.push(body);
      return objects.length;
    };

    addObj("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(""); // pages placeholder (obj 2)

    addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    const font1 = 3;
    const font2 = 4;
    const kidsRefs: string[] = [];

    for (const pageContent of this.pages) {
      const contentObj = addObj(
        `<< /Length ${byteLengthUtf8(pageContent)} >>\nstream\n${pageContent}endstream`
      );
      const pageObj = addObj(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageW} ${this.pageH}] ` +
          `/Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> ` +
          `/Contents ${contentObj} 0 R >>`
      );
      kidsRefs.push(`${pageObj} 0 R`);
    }

    objects[1] = `<< /Type /Pages /Kids [${kidsRefs.join(" ")}] /Count ${kidsRefs.length} >>`;

    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(byteLengthUtf8(pdf));
      pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefPos = byteLengthUtf8(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefPos}\n%%EOF\n`;

    return new Blob([pdf], { type: "application/pdf" });
  }
}
