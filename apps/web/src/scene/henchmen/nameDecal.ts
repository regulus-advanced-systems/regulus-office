/**
 * GDT floor name labels (SPEC §9.3, research 03 §4): the owner's name and the
 * henchman's model printed on the floor next to the seat, large bold dark-grey
 * sans at ~40% opacity, rotated to the iso axis (a floor decal, not a
 * floating tag). One canvas texture per (owner, model), shared by decals.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import { fonts } from "../../ui/theme.ts";

export const DECAL_HEIGHT_PX = 128;
export const DECAL_NAME_FONT_PX = 58;
export const DECAL_MODEL_FONT_PX = 34;
export const DECAL_PAD_PX = 12;
export const DECAL_MAX_WIDTH_PX = 768;
export const DECAL_MAX_CHARS = 22;
/** Ink colour; the material adds the transparency. */
export const DECAL_INK = "#2E2E2E";
export const DECAL_OPACITY = 0.5;
/** World height of the decal (metres along the floor). */
export const DECAL_WORLD_HEIGHT = 0.62;

export interface DecalLines {
  name: string;
  model: string;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function decalLines(ownerName: string, model: string): DecalLines {
  return { name: clip(ownerName, DECAL_MAX_CHARS) || "?", model: clip(model, DECAL_MAX_CHARS + 8) };
}

/** Canvas width for the measured text, padded, a multiple of 8, capped. */
export function decalWidthPx(textWidthPx: number): number {
  const w = Math.ceil((Math.max(0, textWidthPx) + DECAL_PAD_PX * 2) / 8) * 8;
  return Math.min(DECAL_MAX_WIDTH_PX, Math.max(64, w));
}

export function decalKey(ownerName: string, model: string): string {
  const l = decalLines(ownerName, model);
  return `${l.name}\u0000${l.model}`;
}

/** The subset of CanvasRenderingContext2D the decal needs (tests pass a recorder). */
export interface DecalContext {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  measureText(text: string): { width: number };
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}

export interface DecalCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): DecalContext | null;
}

const nameFont = `800 ${DECAL_NAME_FONT_PX}px ${fonts.ui}`;
const modelFont = `600 ${DECAL_MODEL_FONT_PX}px ${fonts.ui}`;

/** Size the canvas and draw both lines, left-aligned. Returns the aspect (w / h). */
export function drawNameDecal(canvas: DecalCanvas, lines: DecalLines): number {
  const probe = canvas.getContext("2d");
  if (!probe) return 0;
  probe.font = nameFont;
  const nameW = probe.measureText(lines.name).width;
  probe.font = modelFont;
  const modelW = lines.model ? probe.measureText(lines.model).width : 0;
  canvas.width = decalWidthPx(Math.max(nameW, modelW));
  canvas.height = DECAL_HEIGHT_PX;
  // Resizing a canvas resets its state; take the context again.
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const maxText = canvas.width - DECAL_PAD_PX * 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = DECAL_INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = nameFont;
  ctx.fillText(lines.name, DECAL_PAD_PX, DECAL_PAD_PX + DECAL_NAME_FONT_PX * 0.82, maxText);
  if (lines.model) {
    ctx.font = modelFont;
    ctx.fillText(lines.model, DECAL_PAD_PX, DECAL_HEIGHT_PX - DECAL_PAD_PX - 4, maxText);
  }
  return canvas.width / canvas.height;
}

export interface NameDecalTexture {
  texture: CanvasTexture;
  aspect: number;
}

const cache = new Map<string, NameDecalTexture>();

/** Texture for a decal (cached). Null without a DOM. */
export function nameDecalTexture(
  ownerName: string,
  model: string,
  createCanvas: () => DecalCanvas | null = () =>
    typeof document === "undefined"
      ? null
      : (document.createElement("canvas") as unknown as DecalCanvas),
): NameDecalTexture | null {
  const key = decalKey(ownerName, model);
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = createCanvas();
  if (!canvas) return null;
  const aspect = drawNameDecal(canvas, decalLines(ownerName, model));
  if (!aspect) return null;
  const texture = new CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;
  const entry = { texture, aspect };
  cache.set(key, entry);
  return entry;
}

export function nameDecalCacheSize(): number {
  return cache.size;
}
