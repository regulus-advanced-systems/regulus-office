/**
 * Operation name painted on the exterior of the front stub wall (SPEC §9.1,
 * research 03 §1: "company name in large light-grey italic sans"). Drawn
 * into a canvas at runtime; no font assets.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";

export const NAME_CANVAS_HEIGHT = 96;
/** Keep well inside the 4096 texture limit of low-end GPUs. */
export const NAME_CANVAS_MAX_WIDTH = 4096;
export const NAME_TEXT_COLOR = "rgba(255, 250, 235, 0.82)";
export const NAME_FONT = "italic 700 %dpx 'Open Sans', 'Segoe UI', system-ui, sans-serif";

/** Canvas pixel size for a plate of the given width/height ratio. */
export function nameCanvasSize(aspect: number): { width: number; height: number } {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const height = NAME_CANVAS_HEIGHT;
  const width = Math.min(NAME_CANVAS_MAX_WIDTH, Math.max(height, Math.round(height * safeAspect)));
  return { width, height };
}

/** Left inset and font size (px) for a plate of `height` px. */
export function nameLayout(height: number): { inset: number; fontPx: number } {
  return { inset: Math.round(height * 1.2), fontPx: Math.round(height * 0.72) };
}

/** Transparent texture with the name at the left; null outside a DOM (tests, SSR). */
export function createNameTexture(name: string, aspect: number): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const { width, height } = nameCanvasSize(aspect);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { inset, fontPx } = nameLayout(height);
  ctx.clearRect(0, 0, width, height);
  ctx.font = NAME_FONT.replace("%d", String(fontPx));
  ctx.fillStyle = NAME_TEXT_COLOR;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(name, inset, height / 2, width - inset * 2);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 4;
  return tex;
}
