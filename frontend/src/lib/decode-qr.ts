/**
 * Decode a QR payload from a camera photo or video frame.
 * Uses barcode-detector (ZXing-C++ WASM) — loaded on demand so Board/Card stays light.
 */

/** Short SPIFFS path for offline SoftAP (no CDN). */
const LOCAL_WASM_PATH = "/zx.wasm";

type BarcodeDetectorPonyfill = {
  BarcodeDetector: new (opts?: { formats?: string[] }) => {
    detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
  };
  prepareZXingModule: (opts: {
    fireImmediately?: boolean;
    overrides?: {
      locateFile?: (path: string, prefix: string) => string;
    };
  }) => void | Promise<unknown>;
};

let bdMod: BarcodeDetectorPonyfill | null = null;
let zxingPrepared = false;
let detector: InstanceType<BarcodeDetectorPonyfill["BarcodeDetector"]> | null = null;
let prefetchPromise: Promise<void> | null = null;

async function loadBarcodeDetector(): Promise<BarcodeDetectorPonyfill> {
  if (bdMod) return bdMod;
  bdMod = (await import("barcode-detector/ponyfill")) as BarcodeDetectorPonyfill;
  return bdMod;
}

function ensureZxingWasm(mod: BarcodeDetectorPonyfill): void {
  if (zxingPrepared) return;
  zxingPrepared = true;
  mod.prepareZXingModule({
    fireImmediately: true,
    overrides: {
      locateFile: (path, prefix) => {
        if (path.endsWith(".wasm")) return LOCAL_WASM_PATH;
        return `${prefix}${path}`;
      },
    },
  });
}

async function getDetector() {
  const mod = await loadBarcodeDetector();
  ensureZxingWasm(mod);
  if (!detector) {
    detector = new mod.BarcodeDetector({ formats: ["qr_code"] });
  }
  return detector;
}

/** Warm WASM + detector as soon as Scan mode opens (avoids first-scan stall). */
export function prefetchQrDecoder(): void {
  if (prefetchPromise) return;
  prefetchPromise = (async () => {
    try {
      const d = await getDetector();
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      await d.detect(canvas).catch(() => undefined);
    } catch {
      // Real scans will retry.
    }
  })();
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}

function canvasFromSource(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxEdge: number
): HTMLCanvasElement | null {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH, 1));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

function sourceSize(source: CanvasImageSource): { w: number; h: number } | null {
  if (source instanceof HTMLVideoElement) {
    return source.videoWidth > 0 ? { w: source.videoWidth, h: source.videoHeight } : null;
  }
  if (source instanceof HTMLImageElement) {
    return source.naturalWidth > 0 ? { w: source.naturalWidth, h: source.naturalHeight } : null;
  }
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return { w: source.width, h: source.height };
  }
  if (source instanceof HTMLCanvasElement) {
    return { w: source.width, h: source.height };
  }
  return null;
}

async function detectQr(source: ImageBitmapSource): Promise<string | null> {
  try {
    const codes = await (await getDetector()).detect(source);
    const value = codes[0]?.rawValue?.trim();
    return value || null;
  } catch {
    return null;
  }
}

async function decodeFromSource(
  source: CanvasImageSource,
  opts?: { quick?: boolean }
): Promise<string | null> {
  const size = sourceSize(source);
  if (!size) return null;

  const maxDim = Math.max(size.w, size.h);
  // Mid-size first: multi-megapixel camera JPEGs are slow at full resolution in WASM.
  const targets = opts?.quick
    ? [Math.min(maxDim, 960)]
    : [...new Set([Math.min(maxDim, 1200), Math.min(maxDim, 900)].filter((e) => e >= 200))];

  for (const maxEdge of targets) {
    const canvas = canvasFromSource(source, size.w, size.h, maxEdge);
    if (!canvas) continue;
    const text = await detectQr(canvas);
    if (text) return text;

    if (opts?.quick) continue;

    const cw = canvas.width;
    const ch = canvas.height;
    if (cw < 280 || ch < 280) continue;
    const cropW = Math.round(cw * 0.65);
    const cropH = Math.round(ch * 0.65);
    const sx = Math.round((cw - cropW) / 2);
    const sy = Math.round((ch - cropH) / 2);
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) continue;
    cropCtx.drawImage(canvas, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
    const fromCrop = await detectQr(cropCanvas);
    if (fromCrop) return fromCrop;
  }
  return null;
}

export async function decodeQrFromFile(file: File): Promise<string | null> {
  try {
    const img = await loadImageFromFile(file);
    const fromImg = await decodeFromSource(img);
    if (fromImg) return fromImg;
  } catch {
    // Fall through.
  }

  try {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      bitmap = await createImageBitmap(file);
    }
    try {
      return await decodeFromSource(bitmap);
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

export async function decodeQrFromVideo(video: HTMLVideoElement): Promise<string | null> {
  if (video.readyState < 2 || video.videoWidth < 2) return null;
  return decodeFromSource(video, { quick: true });
}
