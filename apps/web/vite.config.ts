import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the web client. `build` writes to apps/web/dist, which
 * office-server serves as static files (SPEC §4.1). During development point
 * the client at a running server with VITE_OFFICE_URL (see .env.example).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@regulus/protocol": fileURLToPath(
        new URL("../../packages/protocol/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    /** The /office chunk carries three.js (~1.2 MB minified); it is loaded lazily. */
    chunkSizeWarningLimit: 1400,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
