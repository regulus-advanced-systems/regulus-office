/**
 * What a meeting shows in the room (#50): the hologram over the meeting's
 * desk pod (pattern, round, who has the floor, the token budget) and the lit
 * sign over the door. Canvas 2D, repainted only when the text changes.
 */
import { MEETING_PATTERN_LABELS, type MeetingStatus, type MeetingSummary } from "@regulus/protocol";
import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { LAIR } from "../lair/palette.ts";

export const BOARD_PX = { w: 512, h: 256 } as const;
export const DOOR_PX = { w: 512, h: 128 } as const;

const HOLO = "#7FF3E6";
const HOLO_DIM = "#2EC4B6";

export interface BoardText {
  pattern: string;
  round: string;
  floor: string;
  status: MeetingStatus;
  /** Share of the token budget used, 0..1. */
  budget: number;
}

const STATUS_LINE: Readonly<Record<MeetingStatus, string>> = {
  starting: "CONVENING",
  running: "IN SESSION",
  paused: "PAUSED",
  done: "ADJOURNED",
  stopped: "STOPPED",
  failed: "FAILED",
};

export function boardText(m: MeetingSummary): BoardText {
  const speakers = m.members.filter((x) => m.speaking.includes(x.position)).map((x) => x.name);
  const floor =
    m.status === "starting"
      ? "TAKING SEATS"
      : m.status !== "running"
        ? STATUS_LINE[m.status]
        : speakers.length === 0
          ? "BETWEEN TURNS"
          : speakers.length > 2
            ? `${speakers.length} SPEAKING AT ONCE`
            : `${speakers.join(" + ").toUpperCase()} HAS THE FLOOR`;
  return {
    pattern: MEETING_PATTERN_LABELS[m.pattern].toUpperCase(),
    round: `ROUND ${Math.max(1, m.round)} / ${m.rounds}`,
    floor,
    status: m.status,
    budget: m.tokenBudget > 0 ? Math.min(1, m.tokensUsed / m.tokenBudget) : 0,
  };
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
  | "clearRect"
>;

export function paintBoard(ctx: Ctx, t: BoardText): void {
  const { w, h } = BOARD_PX;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(8, 40, 44, 0.55)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = HOLO_DIM;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const inside = w - 40;
  ctx.fillStyle = HOLO;
  ctx.font = "bold 40px 'Courier New', monospace";
  ctx.fillText(`MEETING · ${t.pattern}`, w / 2, 46, inside);
  ctx.font = "bold 30px 'Courier New', monospace";
  ctx.fillStyle = t.status === "paused" ? "#F2B33D" : HOLO_DIM;
  ctx.fillText(t.round, w / 2, 98, inside);
  ctx.fillStyle = t.status === "running" ? "#FFFFFF" : "#F2B33D";
  ctx.font = "bold 30px 'Courier New', monospace";
  ctx.fillText(t.floor, w / 2, 150, inside);
  // Token budget: a bar that turns alarm red past 80%.
  const x = 40;
  const barW = w - 80;
  ctx.strokeStyle = HOLO_DIM;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, 196, barW, 22);
  ctx.fillStyle = t.budget >= 0.8 ? LAIR.red : HOLO;
  ctx.fillRect(x + 4, 200, Math.max(0, (barW - 8) * t.budget), 14);
}

export function doorLines(m: Pick<MeetingSummary, "status" | "pattern" | "round" | "rounds">) {
  return {
    title: m.status === "paused" ? "MEETING PAUSED" : "MEETING IN SESSION",
    detail: `${MEETING_PATTERN_LABELS[m.pattern].toUpperCase()} · ROUND ${Math.max(1, m.round)}/${m.rounds}`,
  };
}

export function paintDoor(
  ctx: Ctx,
  m: Pick<MeetingSummary, "status" | "pattern" | "round" | "rounds">,
): void {
  const { w, h } = DOOR_PX;
  const { title, detail } = doorLines(m);
  ctx.fillStyle = "#1E2124";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = m.status === "paused" ? "#F2B33D" : LAIR.red;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = m.status === "paused" ? "#F2B33D" : "#FF5A5F";
  ctx.font = "bold 46px 'Courier New', monospace";
  ctx.fillText(title, w / 2, h * 0.38, w - 32);
  ctx.fillStyle = "#F2E6C8";
  ctx.font = "bold 26px 'Courier New', monospace";
  ctx.fillText(detail, w / 2, h * 0.76, w - 32);
}

export function canvasTexture(
  size: { w: number; h: number },
  paint: (ctx: CanvasRenderingContext2D) => void,
): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paint(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  return texture;
}
