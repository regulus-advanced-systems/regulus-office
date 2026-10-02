import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { excalidrawFonts } from "./excalidrawFonts.ts";

/**
 * Vite config for the web client. `build` writes to apps/web/dist, which
 * office-server serves as static files (SPEC §4.1). During development point
 * the client at a running server with VITE_OFFICE_URL (see .env.example).
 *
 * The auth pages call /api/* on their own origin so the httpOnly session
 * cookie stays first-party; in dev those calls are proxied to office-server
 * (OFFICE_DEV_SERVER, default http://localhost:4600). Start the server with
 * OFFICE_PUBLIC_URL=http://localhost:5173 so its Origin checks and invite
 * links match the page.
 */
const devServer = process.env.OFFICE_DEV_SERVER ?? "http://localhost:4600";
export default defineConfig({
  plugins: [react(), excalidrawFonts()],
  resolve: {
    alias: [
      {
        // Exact match only, so light subpaths such as `@regulus/protocol/src/enums.ts`
        // resolve on their own and keep zod and the schemas out of the login chunk.
        find: /^@regulus\/protocol$/,
        replacement: fileURLToPath(
          new URL("../../packages/protocol/src/index.ts", import.meta.url),
        ),
      },
    ],
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
    proxy: {
      "/api": { target: devServer, changeOrigin: true },
      // Running apps (#39): the office's services proxy, WebSockets (HMR) included.
      "/p/": { target: devServer, ws: true },
    },
  },
});
