/**
 * Self-hosted Excalidraw fonts (#45). Excalidraw loads its hand-drawn fonts
 * from `window.EXCALIDRAW_ASSET_PATH`, else from a public CDN; a self-hosted
 * office should not call out to a CDN whenever someone opens the whiteboard.
 * This plugin serves the fonts shipped in the `@excalidraw/excalidraw` npm
 * package (OFL/MIT, redistributed as published, not committed here) under
 * `/excalidraw/fonts/` in dev and emits them into the build; the editor
 * chunk points EXCALIDRAW_ASSET_PATH at `/excalidraw/`. Xiaolai (the 13 MB
 * CJK fallback) is left out: CJK text falls back to the CDN or a system font.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import type { Plugin } from "vite";

export const EXCALIDRAW_ASSET_BASE = "excalidraw/";
const SKIP = new Set(["Xiaolai"]);

function fontsDir(): string | null {
  try {
    const entry = createRequire(import.meta.url).resolve("@excalidraw/excalidraw");
    const dir = join(dirname(entry), "fonts");
    return existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

function fontFiles(dir: string): string[] {
  const out: string[] = [];
  for (const family of readdirSync(dir)) {
    if (SKIP.has(family)) continue;
    const sub = join(dir, family);
    if (!statSync(sub).isDirectory()) continue;
    for (const file of readdirSync(sub)) if (file.endsWith(".woff2")) out.push(join(sub, file));
  }
  return out;
}

export function excalidrawFonts(): Plugin {
  const dir = fontsDir();
  return {
    name: "regulus:excalidraw-fonts",
    configureServer(server) {
      if (!dir) return;
      server.middlewares.use(`/${EXCALIDRAW_ASSET_BASE}fonts/`, (req, res, next) => {
        const path = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
        const file = join(dir, path);
        if (!file.startsWith(dir + sep) || !file.endsWith(".woff2") || !existsSync(file)) {
          next();
          return;
        }
        res.setHeader("content-type", "font/woff2");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      if (!dir) {
        this.warn("@excalidraw/excalidraw fonts not found; the whiteboard will use its CDN");
        return;
      }
      for (const file of fontFiles(dir)) {
        this.emitFile({
          type: "asset",
          fileName: `${EXCALIDRAW_ASSET_BASE}fonts/${relative(dir, file).split(sep).join("/")}`,
          source: readFileSync(file),
        });
      }
    },
  };
}
