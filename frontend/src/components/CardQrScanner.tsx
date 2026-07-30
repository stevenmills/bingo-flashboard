import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseCardClaimFromQrText, type QrCardClaim } from "@/lib/bingo-card-codec";
import { decodeQrFromFile, decodeQrFromVideo } from "@/lib/decode-qr";
import { cn } from "@/lib/utils";

type ScanStatus = "ready" | "decoding" | "verifying" | "error";

interface Props {
  active: boolean;
  busy?: boolean;
  accentColor?: string;
  onClaim: (claim: QrCardClaim) => void | Promise<void>;
}

export function CardQrScanner({ active, busy = false, accentColor, onClaim }: Props) {
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastPayloadRef = useRef<{ key: string; at: number } | null>(null);
  const handlingRef = useRef(false);
  const [status, setStatus] = useState<ScanStatus>("ready");
  const [error, setError] = useState<string | null>(null);
  const [liveSupported, setLiveSupported] = useState(false);

  const stopLive = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setLiveSupported(false);
  }, []);

  const handleDecodedText = useCallback(
    async (text: string) => {
      if (handlingRef.current || busy) return;
      const claim = parseCardClaimFromQrText(text);
      if (!claim) {
        setStatus("error");
        setError("That QR isn’t a bingo card link. Use the FREE-cell QR from a printable card.");
        return;
      }
      const key = `${claim.sig ?? ""}:${claim.numbers.map((n) => n ?? "").join(",")}`;
      const now = Date.now();
      const last = lastPayloadRef.current;
      if (last && last.key === key && now - last.at < 4000) return;
      lastPayloadRef.current = { key, at: now };
      handlingRef.current = true;
      setStatus("verifying");
      setError(null);
      try {
        await onClaim(claim);
      } finally {
        handlingRef.current = false;
        setStatus("ready");
      }
    },
    [busy, onClaim]
  );

  const onFileSelected = useCallback(
    async (file: File | null) => {
      if (!file || busy || handlingRef.current) return;
      setStatus("decoding");
      setError(null);
      try {
        const text = await decodeQrFromFile(file);
        if (!text) {
          setStatus("error");
          setError(
            "Couldn’t read a QR from that photo. Hold steady, fill the frame with the FREE-cell QR, and try again."
          );
          return;
        }
        await handleDecodedText(text);
      } catch {
        setStatus("error");
        setError("Couldn’t process that photo. Try a different shot.");
      }
    },
    [busy, handleDecodedText]
  );

  useEffect(() => {
    if (!active || !secure || busy) {
      stopLive();
      return;
    }
    let cancelled = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setLiveSupported(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setLiveSupported(true);
        setStatus("ready");
        setError(null);

        let lastAttempt = 0;
        const tick = async () => {
          if (cancelled) return;
          if (handlingRef.current || busy) {
            rafRef.current = requestAnimationFrame(() => void tick());
            return;
          }
          const now = performance.now();
          if (now - lastAttempt < 320) {
            rafRef.current = requestAnimationFrame(() => void tick());
            return;
          }
          lastAttempt = now;
          const videoEl = videoRef.current;
          if (videoEl) {
            try {
              const text = await decodeQrFromVideo(videoEl);
              if (text && !cancelled) await handleDecodedText(text);
            } catch {
              // Keep scanning.
            }
          }
          rafRef.current = requestAnimationFrame(() => void tick());
        };
        rafRef.current = requestAnimationFrame(() => void tick());
      } catch {
        if (!cancelled) {
          setLiveSupported(false);
          setError("Camera preview unavailable. Use Scan card to take a photo.");
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopLive();
    };
  }, [active, busy, handleDecodedText, secure, stopLive]);

  useEffect(() => {
    if (!active) {
      setStatus("ready");
      setError(null);
      handlingRef.current = false;
    }
  }, [active]);

  if (!active) return null;

  const statusLabel =
    status === "decoding"
      ? "Reading QR…"
      : status === "verifying" || busy
        ? "Verifying card…"
        : liveSupported
          ? "Point at the card’s FREE-cell QR"
          : "Tap Scan card to open the camera";

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border bg-black/90 aspect-[4/3] max-h-[min(28vh,11rem)] mx-auto w-full max-w-sm flex items-center justify-center"
        )}
      >
        {secure && (
          <video
            ref={videoRef}
            className={cn(
              "absolute inset-0 h-full w-full object-cover",
              !liveSupported && "hidden"
            )}
            playsInline
            muted
          />
        )}
        {!liveSupported && (
          <div className="relative z-10 flex flex-col items-center gap-1.5 px-4 text-center text-white/90">
            <Camera className="h-7 w-7 opacity-80" />
            <p className="text-xs leading-snug">
              Photo the FREE-cell QR, straight-on, no glare.
            </p>
          </div>
        )}
        {(status === "decoding" || status === "verifying" || busy) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
          <p className="text-center text-xs text-white/95">{statusLabel}</p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          void onFileSelected(file);
        }}
      />

      <div className="flex flex-col items-center gap-1.5">
        <Button
          type="button"
          disabled={busy || status === "decoding" || status === "verifying"}
          className="h-11 min-w-[11rem] gap-2 text-white"
          style={accentColor ? { backgroundColor: accentColor } : undefined}
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera className="h-4 w-4" />
          Scan card
        </Button>
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        {!secure && (
          <p className="text-xs text-muted-foreground text-center max-w-sm leading-snug">
            Live preview needs HTTPS — Scan takes a single photo instead.
          </p>
        )}
      </div>
    </div>
  );
}
