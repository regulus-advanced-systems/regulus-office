/**
 * Door plaques (#186, SPEC §9.1): a room's name and its robot counts
 * (working, waiting) painted on a riveted brass-framed plate over the door,
 * readable from the corridor even when the door stays shut. A plate under
 * construction says so. Canvas 2D, painted only when the text changes.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
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
  ctx.font = "bold 52px 'Courier New', monospace";
  ctx.fillText(title.toUpperCase(), w / 2, h * 0.38);
  ctx.font = "bold 21px 'Courier New', monospace";
  ctx.fillStyle = t.building ? LAIR.yellow : t.waiting > 0 ? "#F28C28" : "#2EC4B6";
  ctx.fillText(status, w / 2, h * 0.74);
}

export function createSignTexture(t: SignText): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIGN_PX.w;
  canvas.height = SIGN_PX.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paintSign(ctx, t);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
