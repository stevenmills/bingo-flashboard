import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const FADE_OUT_MS = 500;

interface Props {
  url: string;
  number: number;
  visible: boolean;
  className?: string;
}

/**
 * Centered GIF overlay for HUD — pops in, fades out.
 * Upscales into a 75%×75% box of the available area (object-fit contain:
 * height or width limit, whichever binds first).
 */
export function NumberGifOverlay({ url, number, visible, className }: Props) {
  const [broken, setBroken] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [opaque, setOpaque] = useState(false);
  const [displayUrl, setDisplayUrl] = useState(url);
  const [displayNumber, setDisplayNumber] = useState(number);
  const fadeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setBroken(false);
  }, [url, number]);

  useEffect(() => {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    const show = visible && Boolean(url) && !broken;
    if (show) {
      setDisplayUrl(url);
      setDisplayNumber(number);
      setMounted(true);
      setOpaque(true);
      return;
    }

    setOpaque(false);
    fadeTimerRef.current = window.setTimeout(() => {
      fadeTimerRef.current = null;
      setMounted(false);
    }, FADE_OUT_MS);

    return () => {
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [visible, url, number, broken]);

  if (!mounted || !displayUrl) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-30 flex items-center justify-center transition-opacity ease-out",
        opaque ? "opacity-100 duration-0" : "opacity-0 duration-500",
        className
      )}
      aria-hidden
    >
      <div className="h-[75%] w-[75%]">
        <img
          key={`${displayNumber}:${displayUrl}`}
          src={displayUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain"
          onError={() => setBroken(true)}
        />
      </div>
    </div>
  );
}
