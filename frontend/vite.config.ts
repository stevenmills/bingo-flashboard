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
    emptyOutDir: true,
    // Keep assets small for SPIFFS (~1.5 MB)
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
      "/declare-winner": API_TARGET,
      "/clear-winner": API_TARGET,
      "/led-test": API_TARGET,
      "/auth/board/unlock": API_TARGET,
      "/auth/board/lock": API_TARGET,
      "/auth/board/refresh": API_TARGET,
      "/board/pin": API_TARGET,
      "/card/join": API_TARGET,
      "/card/mark": API_TARGET,
      "/card/leave": API_TARGET,
      "/brightness": API_TARGET,
      "/theme": API_TARGET,
      "/color": API_TARGET,
    },
  },
});
