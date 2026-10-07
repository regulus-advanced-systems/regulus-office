/**
 * Canvas textures for the label over an agent (#256): the name tag (text with
 * a soft outline, no plate) and the bubble (a rounded plate with a tail and an
 * optional badge). Sprites, like the human name plates: one quad each, no DOM.
 * Bubble texts change often (file names), so the cache is bounded.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import { fonts } from "../../ui/theme.ts";
import {
  BUBBLE_LOOKS,
  bubbleLabel,
  NAME_TAG,
  nameLabel,
  type ShownBubbleKind,
} from "./bubbleStyle.ts";

export interface LabelTexture {
  texture: CanvasTexture;
  /** Width over height. */
  aspect: number;
}

const BODY_PX = 64;
const TAIL_PX = 12;
const FONT_PX = 30;
const PAD_PX = 20;
const BADGE_PX = 40;
const TAG_PX = 44;
const TAG_FONT_PX = 28;
const MAX_CACHED = 96;

const cache = new Map<string, LabelTexture>();

function remember(key: string, make: () => LabelTexture): LabelTexture {
  const hit = cache.get(key);
  if (hit) {
    // Most recently used last.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const made = make();
  cache.set(key, made);
  if (cache.size > MAX_CACHED) {
    const [oldest, entry] = cache.entries().next().value as [string, LabelTexture];
    cache.delete(oldest);
    // Still shown somewhere: three uploads it again on the next draw.
    entry.texture.dispose();
  }
  return made;
}

function finish(canvas: HTMLCanvasElement): LabelTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return { texture, aspect: canvas.width / canvas.height };
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return ctx;
}

const even = (n: number) => Math.ceil(n / 8) * 8;

/** The bubble plate for a kind and text. Needs a DOM. */
export function bubbleTextureFor(kind: ShownBubbleKind, text: string): LabelTexture {
  const label = bubbleLabel(text);
  return remember(`b|${kind}|${label}`, () => {
    const look = BUBBLE_LOOKS[kind];
    const canvas = document.createElement("canvas");
    const ctx = context(canvas);
    const font = `600 ${FONT_PX}px ${fonts.ui}`;
    ctx.font = font;
    const badge = look.badge ? BADGE_PX + 10 : 0;
    const width = even(ctx.measureText(label).width + PAD_PX * 2 + badge);
    canvas.width = width;
    canvas.height = BODY_PX + TAIL_PX;

    // Plate with a small tail pointing at the agent.
    ctx.beginPath();
    ctx.roundRect(2, 2, width - 4, BODY_PX - 4, 18);
    ctx.moveTo(width / 2 - 11, BODY_PX - 3);
    ctx.lineTo(width / 2, BODY_PX + TAIL_PX - 2);
    ctx.lineTo(width / 2 + 11, BODY_PX - 3);
    ctx.fillStyle = look.fill;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = look.border;
    ctx.beginPath();
    ctx.roundRect(2, 2, width - 4, BODY_PX - 4, 18);
    ctx.stroke();

    if (look.badge) {
      const cx = PAD_PX + BADGE_PX / 2 - 4;
      const cy = BODY_PX / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, BADGE_PX / 2, 0, Math.PI * 2);
      ctx.fillStyle = look.ink;
      ctx.fill();
      ctx.strokeStyle = look.fill;
      ctx.fillStyle = look.fill;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (look.badge === "!") {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 11);
        ctx.lineTo(cx, cy + 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy + 11, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy + 1);
        ctx.lineTo(cx - 2, cy + 8);
        ctx.lineTo(cx + 10, cy - 8);
        ctx.stroke();
      }
    }

    ctx.font = font;
    ctx.fillStyle = look.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, PAD_PX + badge, BODY_PX / 2 + 1);
    return finish(canvas);
  });
}

/** The name tag: the name alone, outlined so it reads on any floor. Needs a DOM. */
export function nameTagTextureFor(name: string): LabelTexture {
  const label = nameLabel(name);
  return remember(`n|${label}`, () => {
    const canvas = document.createElement("canvas");
    const ctx = context(canvas);
    const font = `600 ${TAG_FONT_PX}px ${fonts.ui}`;
    ctx.font = font;
    canvas.width = even(ctx.measureText(label).width + 20);
    canvas.height = TAG_PX;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = NAME_TAG.outline;
    ctx.strokeText(label, canvas.width / 2, TAG_PX / 2 + 1);
    ctx.fillStyle = NAME_TAG.ink;
    ctx.fillText(label, canvas.width / 2, TAG_PX / 2 + 1);
    return finish(canvas);
  });
}

export function labelCacheSize(): number {
  return cache.size;
}
