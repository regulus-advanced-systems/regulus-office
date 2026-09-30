/**
 * The clipboard's paper (#37): "QUEUE", then the running tasks and the next
 * queued ones, one line each. The layout is pure ({@link layoutClipboard});
 * {@link paintClipboard} draws it on a Canvas 2D surface.
 */
import type { QueueTask } from "@regulus/protocol";
import { type BoardCanvas, fitText } from "../boards/boardTexture.ts";

export const CLIPBOARD_PX_PER_M = 320;
const PAD = 12;
const HEADER = 34;
const LINE = 24;

export const CLIPBOARD_COLORS = {
  paper: "#FFFDF5",
  rule: "#C9D8EE",
  ink: "#2B2B2B",
  muted: "#6B6B6B",
  running: "#1E6FE0",
  header: "#4A2E14",
} as const;

export interface ClipboardLine {
  mark: "running" | "queued";
  text: string;
}

export interface ClipboardLayout {
  width: number;
  height: number;
  lines: ClipboardLine[];
  /** Tasks that did not fit ("+N more"). */
  hidden: number;
  running: number;
  queued: number;
}

export function clipboardSize(w: number, h: number) {
  return { width: Math.round(w * CLIPBOARD_PX_PER_M), height: Math.round(h * CLIPBOARD_PX_PER_M) };
}

export function layoutClipboard(
  tasks: readonly QueueTask[],
  size: { width: number; height: number },
): ClipboardLayout {
  const running = tasks.filter((t) => t.state === "running");
  const queued = tasks.filter((t) => t.state === "queued").sort((a, b) => a.position - b.position);
  const all: ClipboardLine[] = [
    ...running.map((t) => ({ mark: "running" as const, text: t.title })),
    ...queued.map((t) => ({ mark: "queued" as const, text: t.title })),
  ];
  const fit = Math.max(0, Math.floor((size.height - HEADER - PAD * 2) / LINE));
  const shown = all.length > fit ? all.slice(0, Math.max(0, fit - 1)) : all;
  return {
    ...size,
    lines: shown,
    hidden: all.length - shown.length,
    running: running.length,
    queued: queued.length,
  };
}

/** Changes only when the picture does. */
export function clipboardKey(layout: ClipboardLayout): string {
  return JSON.stringify([layout.lines, layout.hidden, layout.width, layout.height]);
}

export function paintClipboard(ctx: BoardCanvas, layout: ClipboardLayout): void {
  const { width, height } = layout;
  ctx.fillStyle = CLIPBOARD_COLORS.paper;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";
  ctx.fillStyle = CLIPBOARD_COLORS.header;
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("QUEUE", PAD, PAD + 12);
  ctx.fillStyle = CLIPBOARD_COLORS.muted;
  ctx.font = "13px sans-serif";
  const counts = `${layout.running} running · ${layout.queued} waiting`;
  ctx.fillText(fitText(ctx, counts, width - PAD * 2 - 80), PAD + 80, PAD + 12);
  let y = PAD + HEADER;
  ctx.font = "15px sans-serif";
  for (const line of layout.lines) {
    ctx.fillStyle = CLIPBOARD_COLORS.rule;
    ctx.fillRect(PAD, y + LINE - 2, width - PAD * 2, 1);
    ctx.fillStyle = line.mark === "running" ? CLIPBOARD_COLORS.running : CLIPBOARD_COLORS.muted;
    ctx.beginPath();
    ctx.arc(PAD + 5, y + LINE / 2, line.mark === "running" ? 5 : 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CLIPBOARD_COLORS.ink;
    ctx.fillText(fitText(ctx, line.text, width - PAD * 2 - 18), PAD + 16, y + LINE / 2);
    y += LINE;
  }
  if (layout.hidden > 0) {
    ctx.fillStyle = CLIPBOARD_COLORS.muted;
    ctx.fillText(`+${layout.hidden} more`, PAD + 16, y + LINE / 2);
  }
}
