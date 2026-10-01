/**
 * A production build of the office harness (apps/web/dev/robots.html) for
 * the perf script (#190): the same Vite config as the app, with the dev page
 * as the entry, written to `$PERF_OUT_DIR` (default /tmp/rg-perf-harness).
 * `cd apps/web && bunx vite build --config vite.harness.config.ts`.
 */
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config.ts";

const root = fileURLToPath(new URL("./", import.meta.url));

export default mergeConfig(
  base,
  defineConfig({
    root,
    logLevel: "warn",
    build: {
      outDir: process.env.PERF_OUT_DIR ?? "/tmp/rg-perf-harness",
      emptyOutDir: true,
      rollupOptions: { input: { robots: `${root}dev/robots.html` } },
    },
  }),
);
