/**
 * Canvas textures for the speech bubbles and emote badges over avatars
 * (#49): a sprite each, like the name plates (one quad, no DOM; SPEC §11
 * caps live DOM panels at 2). Text is word-wrapped to a few lines; the
 * bubble has a tail pointing down at the speaker.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import { colors, fonts } from "../../ui/theme.ts";

export const BUBBLE_FONT_PX = 28;
export const BUBBLE_LINE_PX = 36;
export const BUBBLE_PAD_PX = 18;
export const BUBBLE_TAIL_PX = 16;
/** Widest text line, px; longer lines wrap. */
export const BUBBLE_WRAP_PX = 420;
export const BUBBLE_MAX_LINES = 4;
/** World metres per texture pixel (the name plate's scale). */
export const BUBBLE_METRES_PER_PX = 0.34 / 64;

export interface SpriteTexture {
  texture: CanvasTexture;
  /** World size of the sprite, metres. */
  width: number;
  height: number;
}

/** Greedy word wrap with `measure`; a word longer than a line is cut. Pure. */
export function wrapLines(
  text: string,
  measure: (s: string) => number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (measure(line) > maxWidth && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${(kept[maxLines - 1] ?? "").replace(/.$/, "")}…`;
  return kept;
}

function finish(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** Draw a speech bubble for `text`. Needs a DOM; the caller disposes the texture. */
export function bubbleTexture(text: string): SpriteTexture {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const font = `500 ${BUBBLE_FONT_PX}px ${fonts.ui}`;
  ctx.font = font;
  const lines = wrapLines(text, (s) => ctx.measureText(s).width, BUBBLE_WRAP_PX, BUBBLE_MAX_LINES);
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width), 40);
  const w = Math.ceil((textW + BUBBLE_PAD_PX * 2) / 8) * 8;
  const bodyH = lines.length * BUBBLE_LINE_PX + BUBBLE_PAD_PX * 1.4;
  const h = Math.ceil(bodyH + BUBBLE_TAIL_PX);
  canvas.width = w;
  canvas.height = h;

  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, bodyH - 4, 14);
  ctx.moveTo(w / 2 - 12, bodyH - 3);
  ctx.lineTo(w / 2, h - 2);
  ctx.lineTo(w / 2 + 12, bodyH - 3);
  ctx.fillStyle = colors.cream;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = colors.ink;
  ctx.stroke();
  // Cover the stroke where the tail meets the body.
  ctx.fillRect(w / 2 - 10, bodyH - 6, 20, 5);

  ctx.font = font;
  ctx.fillStyle = colors.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(line, w / 2, BUBBLE_PAD_PX * 0.7 + BUBBLE_LINE_PX * (i + 0.5));
  });
  return {
    texture: finish(canvas),
    width: w * BUBBLE_METRES_PER_PX,
    height: h * BUBBLE_METRES_PER_PX,
  };
}

const badges = new Map<string, SpriteTexture>();

/** A round badge with an emote's icon and label (reduced motion, #49). Cached per emote. */
export function emoteBadgeTexture(icon: string, label: string): SpriteTexture {
  const key = `${icon}|${label}`;
  const hit = badges.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const font = `600 26px ${fonts.ui}`;
  ctx.font = font;
  const h = 56;
  const w = Math.ceil((ctx.measureText(label).width + 44 + 30) / 8) * 8;
  canvas.width = w;
  canvas.height = h;
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, h - 4, 26);
  ctx.fillStyle = colors.gold;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = colors.ink;
  ctx.stroke();
  ctx.textBaseline = "middle";
  ctx.font = `30px ${fonts.ui}`;
  ctx.fillText(icon, 14, h / 2 + 1);
  ctx.font = font;
  ctx.fillStyle = colors.ink;
  ctx.fillText(label, 52, h / 2 + 1);
  const entry = {
    texture: finish(canvas),
    width: w * BUBBLE_METRES_PER_PX,
    height: h * BUBBLE_METRES_PER_PX,
  };
  badges.set(key, entry);
  return entry;
}
