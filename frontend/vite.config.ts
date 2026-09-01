import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const API_TARGET = process.env.VITE_SHARED_MOCK === "true" ? "http://127.0.0.1:8787" : "http://192.168.4.1";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../data",
    // Do not wipe data/ — MP3 voice packs live here and in public/. Stale hashed bundles are
    // removed by scripts/prune-spiffs-data.mjs before/after each build (SPIFFS ~6 MB).
    emptyOutDir: false,
    rollupOptions: {
      output: {
        // Flatten asset names (no subfolders) for SPIFFS
        assetFileNames: "[name]-[hash][extname]",
        chunkFileNames: "[name]-[hash].js",
        entryFileNames: "[name]-[hash].js",
      },
    },
  },
  server: {
    proxy: {
      "/ws": {
        target: API_TARGET,
        ws: true,
      },
      "/api": API_TARGET,
      "/draw": API_TARGET,
      "/reset": API_TARGET,
      "/undo": API_TARGET,
      "/call": API_TARGET,
      "/calling-style": API_TARGET,
      "/game-type": API_TARGET,
      "/game-selection": API_TARGET,
      "/declare-winner": API_TARGET,
      "/clear-winner": API_TARGET,
      "/led-test": API_TARGET,
      "/screensaver": API_TARGET,
      "/screensaver-text": API_TARGET,
      "/screensaver-speed": API_TARGET,
      "/screensaver-type": API_TARGET,
      "/screensaver-color": API_TARGET,
      "/auto-calling": API_TARGET,
      "/auto-calling-seconds": API_TARGET,
      "/auto-calling-hold": API_TARGET,
      "/auto-calling-wait-audio": API_TARGET,
      "/auth/board/unlock": API_TARGET,
      "/auth/board/lock": API_TARGET,
      "/auth/board/refresh": API_TARGET,
      "/board/pin": API_TARGET,
      "/board/restart": API_TARGET,
      "/card/join": API_TARGET,
      "/card/claim": API_TARGET,
      "/card/mark": API_TARGET,
      "/card/sync-marks": API_TARGET,
      "/card/leave": API_TARGET,
      "/brightness": API_TARGET,
      "/theme": API_TARGET,
      "/color": API_TARGET,
      "/letter-colors": API_TARGET,
      "/led-color-mode": API_TARGET,
      "/ui-colors": API_TARGET,
      "/letter-header-color": API_TARGET,
      "/game-type-color": API_TARGET,
      "/letter-full-mode": API_TARGET,
      "/current-number-effect": API_TARGET,
      "/current-number-color": API_TARGET,
      "/called-number-banner": API_TARGET,
      "/winner-effect": API_TARGET,
      "/webhooks": API_TARGET,
      "/mqtt": API_TARGET,
      "/number-gifs": API_TARGET,
      "/gif-mode": API_TARGET,
      "/wifi": API_TARGET,
      "/wifi/scan": API_TARGET,
    },
  },
});
