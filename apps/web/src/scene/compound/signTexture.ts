/**
 * Door plaques (#186, SPEC §9.1): a room's name and its henchman counts
 * (working, waiting) painted on a riveted brass-framed plate over the door,
 * readable from the corridor even when the door stays shut. A plate under
 * construction says so. Canvas 2D, painted only when the text changes.
 */
import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { LAIR } from "../lair/palette.ts";

export const SIGN_PX = { w: 512, h: 160 } as const;

export interface SignText {
  name: string;
  working: number;
  waiting: number;
  building: boolean;
  locked: boolean;
}

export function signLines(t: SignText): { title: string; status: string } {
  const title = t.name.length > 22 ? `${t.name.slice(0, 21)}…` : t.name;
  if (t.building) return { title, status: "UNDER CONSTRUCTION" };
  const status = `${t.working} WORKING · ${t.waiting} WAITING`;
  return { title, status: t.locked ? `${status} · RESTRICTED` : status };
}

type Ctx = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "fillRect"
  | "strokeRect"
  | "fillText"
  | "beginPath"
  | "arc"
  | "fill"
>;

export function paintSign(ctx: Ctx, t: SignText): void {
  const { w, h } = SIGN_PX;
  const { title, status } = signLines(t);
  ctx.fillStyle = "#1E2124";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = LAIR.brass;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.fillStyle = LAIR.brass;
  for (const [x, y] of [
    [18, 18],
    [w - 18, 18],
    [18, h - 18],
    [w - 18, h - 18],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = t.building ? LAIR.yellow : "#F2E6C8";
  // Long lines are squeezed to fit inside the frame rather than cut off.
  const inside = w - 48;
  ctx.font = "bold 56px 'Courier New', monospace";
  ctx.fillText(title.toUpperCase(), w / 2, h * 0.37, inside);
  // Big enough to read from the default 3/4 view (#190).
  ctx.font = "bold 28px 'Courier New', monospace";
  ctx.fillStyle = t.building ? LAIR.yellow : t.waiting > 0 ? "#F28C28" : "#2EC4B6";
  ctx.fillText(status, w / 2, h * 0.74, inside);
}

/** The two lines of a closed room's plate (#269): the same on every one, and nothing about the room. */
export const NO_ENTRY_LINES = { title: "NO ENTRY", status: "RESTRICTED AREA" } as const;

/**
 * The plate of a room this viewer may not enter (D26, #269): a dark plate in
 * a red frame with a hazard stripe. Neutral on purpose: it takes no room.
 */
export function paintNoEntry(ctx: Ctx): void {
  const { w, h } = SIGN_PX;
  ctx.fillStyle = "#1E2124";
  ctx.fillRect(0, 0, w, h);
  // A hazard stripe along the foot, inside the frame.
  for (let x = 10; x < w - 10; x += 32) {
    ctx.fillStyle = (x / 32) % 2 < 1 ? LAIR.yellow : "#1C1D1F";
    ctx.fillRect(x, h - 30, Math.min(32, w - 10 - x), 20);
  }
  ctx.strokeStyle = LAIR.red;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#F2E6C8";
  ctx.font = "bold 60px 'Courier New', monospace";
  ctx.fillText(NO_ENTRY_LINES.title, w / 2, h * 0.34, w - 48);
  ctx.font = "bold 26px 'Courier New', monospace";
  ctx.fillStyle = LAIR.red;
  ctx.fillText(NO_ENTRY_LINES.status, w / 2, h * 0.64, w - 48);
}

export function createSignTexture(t: SignText): CanvasTexture | null {
  return canvasSign(SIGN_PX, (ctx) => paintSign(ctx, t));
}

export function createNoEntryTexture(): CanvasTexture | null {
  return canvasSign(SIGN_PX, paintNoEntry);
}

/** A canvas of `px` painted once and wrapped as a texture; null without a DOM (tests). */
export function canvasSign(
  px: { w: number; h: number },
  paint: (ctx: CanvasRenderingContext2D) => void,
): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = px.w;
  canvas.height = px.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paint(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // Mipmaps and anisotropy keep the lettering steady seen from afar and at a slant (#190).
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  return texture;
}
