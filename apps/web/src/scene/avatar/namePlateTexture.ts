/**
 * Canvas-drawn name plate textures for the floating human labels (SPEC §9.3).
 * A sprite (one quad, no DOM) is far cheaper than drei `<Html>` for 20+
 * avatars; textures are cached per (name, colours) and shared between sprites.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import { colors, fonts } from "../../ui/theme.ts";

export type NamePlateStyle = Readonly<{ background: string; text: string; border: string }>;

export const HUMAN_PLATE_STYLE: NamePlateStyle = {
  background: "#FFFFFF",
  text: colors.ink,
  border: colors.gold,
};

export const PLATE_HEIGHT_PX = 64;
export const PLATE_FONT_PX = 30;
export const PLATE_PAD_PX = 18;
export const PLATE_MAX_CHARS = 24;
/** World-unit height of the plate sprite; width follows the texture aspect. */
export const PLATE_WORLD_HEIGHT = 0.34;

export function plateLabel(name: string): string {
  const trimmed = name.trim() || "?";
  return trimmed.length > PLATE_MAX_CHARS ? `${trimmed.slice(0, PLATE_MAX_CHARS - 1)}…` : trimmed;
}

/** Texture width for a measured text width, rounded to a multiple of 8. */
export function plateWidthPx(textWidthPx: number): number {
  return Math.ceil((textWidthPx + PLATE_PAD_PX * 2) / 8) * 8;
}

export type NamePlateTexture = Readonly<{ texture: CanvasTexture; aspect: number }>;

const cache = new Map<string, NamePlateTexture>();

export function namePlateKey(name: string, style: NamePlateStyle): string {
  return `${plateLabel(name)}|${style.background}|${style.text}|${style.border}`;
}

/** Draw (or fetch from cache) the plate texture for a name. Needs a DOM. */
export function namePlateTextureFor(name: string, style: NamePlateStyle): NamePlateTexture {
  const key = namePlateKey(name, style);
  const cached = cache.get(key);
  if (cached) return cached;

  const label = plateLabel(name);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.font = `600 ${PLATE_FONT_PX}px ${fonts.ui}`;
  const width = plateWidthPx(ctx.measureText(label).width);
  canvas.width = width;
  canvas.height = PLATE_HEIGHT_PX;

  const r = 16;
  ctx.beginPath();
  ctx.roundRect(2, 2, width - 4, PLATE_HEIGHT_PX - 4, r);
  ctx.fillStyle = style.background;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = style.border;
  ctx.stroke();
  ctx.font = `600 ${PLATE_FONT_PX}px ${fonts.ui}`;
  ctx.fillStyle = style.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, PLATE_HEIGHT_PX / 2 + 1);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  const entry = { texture, aspect: width / PLATE_HEIGHT_PX };
  cache.set(key, entry);
  return entry;
}

export function namePlateCacheSize(): number {
  return cache.size;
}
