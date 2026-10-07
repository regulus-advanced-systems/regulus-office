/**
 * The lift's lettering (#269), Canvas 2D painted only when the text changes:
 * - the indicator over the lift's door: the level's mark in lamp teal on a
 *   brass-framed plate, with the level's name;
 * - the blade sign that sticks out over the door so the lift reads from
 *   along the wall: an up-and-down arrow and the mark;
 * - a landing's stencilled wall sign: which sublevel this is and whose.
 */
import { LAIR } from "../../lair/palette.ts";
import { canvasSign } from "../signTexture.ts";

export interface LiftText {
  /** `L`, `S1`, ... */
  mark: string;
  /** The level's name. */
  title: string;
  /** The line under it ("Sublevel 1 · GitHub organisation"). */
  caption: string;
}

export const INDICATOR_PX = { w: 512, h: 128 } as const;
export const BLADE_PX = { w: 256, h: 160 } as const;
export const LEVEL_SIGN_PX = { w: 1024, h: 256 } as const;

type Ctx = CanvasRenderingContext2D;

/** A name cut to fit a line of `max` characters. */
export function fitName(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/** What the indicator says: the mark, and "LIFT" over the level's name. */
export function indicatorLines(t: LiftText): { mark: string; top: string; name: string } {
  return { mark: t.mark, top: "LIFT", name: fitName(t.title, 26).toUpperCase() };
}

/** What a landing's wall sign says: the depth (the caption's first part) over the name. */
export function levelSignLines(t: LiftText): { top: string; name: string } {
  const depth = t.caption.split(" · ")[0] ?? "";
  return { top: depth.toUpperCase(), name: fitName(t.title, 24).toUpperCase() };
}

function frame(ctx: Ctx, w: number, h: number, edge: number): void {
  ctx.fillStyle = "#1E2124";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = LAIR.brass;
  ctx.lineWidth = edge;
  ctx.strokeRect(edge / 2, edge / 2, w - edge, h - edge);
}

export function paintIndicator(ctx: Ctx, t: LiftText): void {
  const { w, h } = INDICATOR_PX;
  const lines = indicatorLines(t);
  frame(ctx, w, h, 10);
  // The lamp window with the level's mark.
  ctx.fillStyle = "#0B1413";
  ctx.fillRect(20, 20, 130, h - 40);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LAIR.teal;
  ctx.font = "bold 64px 'Courier New', monospace";
  ctx.fillText(lines.mark, 85, h / 2 + 2, 118);
  ctx.textAlign = "left";
  ctx.fillStyle = LAIR.yellow;
  ctx.font = "bold 26px 'Courier New', monospace";
  ctx.fillText(lines.top, 172, h * 0.3);
  ctx.fillStyle = "#F2E6C8";
  ctx.font = "bold 40px 'Courier New', monospace";
  ctx.fillText(lines.name, 172, h * 0.66, w - 196);
}

export function paintBlade(ctx: Ctx, t: LiftText): void {
  const { w, h } = BLADE_PX;
  frame(ctx, w, h, 12);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LAIR.yellow;
  ctx.font = "bold 34px 'Courier New', monospace";
  ctx.fillText("▲ LIFT ▼", w / 2, h * 0.3, w - 36);
  ctx.fillStyle = LAIR.teal;
  ctx.font = "bold 64px 'Courier New', monospace";
  ctx.fillText(t.mark, w / 2, h * 0.68, w - 36);
}

export function paintLevelSign(ctx: Ctx, t: LiftText): void {
  const { w, h } = LEVEL_SIGN_PX;
  const lines = levelSignLines(t);
  // Stencilled straight onto a concrete-grey band with a hazard stripe at each end.
  ctx.fillStyle = "#2A2D30";
  ctx.fillRect(0, 0, w, h);
  for (const x0 of [0, w - 72]) {
    for (let i = -2; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? LAIR.yellow : "#1C1D1F";
      ctx.beginPath();
      ctx.moveTo(x0, i * 48);
      ctx.lineTo(x0 + 72, i * 48 + 48);
      ctx.lineTo(x0 + 72, i * 48 + 96);
      ctx.lineTo(x0, i * 48 + 48);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LAIR.yellow;
  ctx.font = "bold 58px 'Courier New', monospace";
  ctx.fillText(lines.top, w / 2, h * 0.3, w - 200);
  ctx.fillStyle = "#F2E6C8";
  ctx.font = "bold 96px 'Courier New', monospace";
  ctx.fillText(lines.name, w / 2, h * 0.68, w - 200);
}

export const indicatorTexture = (t: LiftText) =>
  canvasSign(INDICATOR_PX, (c) => paintIndicator(c, t));
export const bladeTexture = (t: LiftText) => canvasSign(BLADE_PX, (c) => paintBlade(c, t));
export const levelSignTexture = (t: LiftText) =>
  canvasSign(LEVEL_SIGN_PX, (c) => paintLevelSign(c, t));
