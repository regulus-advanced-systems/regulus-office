/**
 * The unfocused board picture (SPEC §9.4 "unfocused = canvas texture"; #36):
 * the board's columns drawn with Canvas 2D as pinned paper cards on cork,
 * number and a short title per card, a coloured tab for CI state on PR
 * cards. The layout is pure ({@link layoutBoard}) so it is tested without a
 * canvas; {@link paintBoard} draws it. Repainted only when the board changes.
 */
import type { BoardColumnView, Tone } from "../../ui/boards/columns.ts";

/** Texture pixels per metre of board; a 1.8 × 1.2 m board is 576 × 384. */
export const BOARD_PX_PER_M = 320;
const PAD = 10;
const HEADER = 26;
const CARD_H = 38;
const CARD_GAP = 6;

export const BOARD_COLORS = {
  cork: "#C8955A",
  corkDark: "#B98246",
  header: "#4A2E14",
  paper: "#FFFDF5",
  ink: "#2B2B2B",
  muted: "#6B6B6B",
  pin: "#D94A4A",
  more: "#FFF6D9",
} as const;

export const TONE_COLORS: Readonly<Record<Tone, string>> = {
  green: "#3DA35D",
  red: "#B83159",
  amber: "#F5A623",
  grey: "#9A9A9A",
  blue: "#1E6FE0",
};

export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  title: string;
  tab: Tone | null;
}

export interface ColumnBox {
  x: number;
  w: number;
  title: string;
  count: number;
  cards: CardBox[];
  /** Cards that did not fit, shown as "+N more". */
  hidden: number;
}

export interface BoardLayout {
  width: number;
  height: number;
  columns: ColumnBox[];
}

export function textureSize(w: number, h: number): { width: number; height: number } {
  return { width: Math.round(w * BOARD_PX_PER_M), height: Math.round(h * BOARD_PX_PER_M) };
}

export function layoutBoard(
  columns: readonly BoardColumnView[],
  size: { width: number; height: number },
): BoardLayout {
  const n = Math.max(1, columns.length);
  const colW = (size.width - PAD * (n + 1)) / n;
  const room = size.height - PAD - HEADER - PAD;
  const fit = Math.max(0, Math.floor((room + CARD_GAP) / (CARD_H + CARD_GAP)));
  return {
    ...size,
    columns: columns.map((col, i) => {
      const x = PAD + i * (colW + PAD);
      const overflow = col.cards.length > fit;
      const shown = overflow ? Math.max(0, fit - 1) : col.cards.length;
      return {
        x,
        w: colW,
        title: col.title,
        count: col.cards.length,
        hidden: col.cards.length - shown,
        cards: col.cards.slice(0, shown).map((c, j) => ({
          x: x + 3,
          y: PAD + HEADER + j * (CARD_H + CARD_GAP),
          w: colW - 6,
          h: CARD_H,
          label: `#${c.number}`,
          title: c.title,
          tab: c.checks?.tone ?? (c.column === "merged" ? "blue" : null),
        })),
      };
    }),
  };
}

/** Minimal Canvas 2D surface (a real context, or a recorder in tests). */
export interface BoardCanvas {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
}

/** `text` cut with an ellipsis to fit `max` pixels. */
export function fitText(ctx: Pick<BoardCanvas, "measureText">, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

export function paintBoard(ctx: BoardCanvas, layout: BoardLayout): void {
  ctx.fillStyle = BOARD_COLORS.cork;
  ctx.fillRect(0, 0, layout.width, layout.height);
  // A few darker flecks so it reads as cork, placed deterministically.
  ctx.fillStyle = BOARD_COLORS.corkDark;
  for (let i = 0; i < 60; i++) {
    ctx.fillRect((i * 97) % layout.width, (i * 53) % layout.height, 3, 2);
  }
  ctx.textBaseline = "middle";
  for (const col of layout.columns) {
    ctx.fillStyle = BOARD_COLORS.header;
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(fitText(ctx, `${col.title} (${col.count})`, col.w), col.x, PAD + HEADER / 2 - 2);
    for (const card of col.cards) {
      ctx.fillStyle = BOARD_COLORS.paper;
      ctx.fillRect(card.x, card.y, card.w, card.h);
      if (card.tab) {
        ctx.fillStyle = TONE_COLORS[card.tab];
        ctx.fillRect(card.x, card.y, 5, card.h);
      }
      ctx.fillStyle = BOARD_COLORS.pin;
      ctx.beginPath();
      ctx.arc(card.x + card.w / 2, card.y + 3, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = BOARD_COLORS.ink;
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(card.label, card.x + 9, card.y + 12);
      ctx.fillStyle = BOARD_COLORS.muted;
      ctx.font = "12px sans-serif";
      ctx.fillText(fitText(ctx, card.title, card.w - 14), card.x + 9, card.y + 27);
    }
    if (col.hidden > 0) {
      ctx.fillStyle = BOARD_COLORS.more;
      ctx.font = "12px sans-serif";
      const y = (col.cards.at(-1)?.y ?? PAD + HEADER - CARD_H - CARD_GAP) + CARD_H + CARD_GAP;
      ctx.fillText(`+${col.hidden} more`, col.x + 4, y + 10);
    }
  }
}

/** A cheap fingerprint of what the texture shows, to skip identical repaints. */
export function layoutKey(columns: readonly BoardColumnView[]): string {
  return columns
    .map(
      (c) =>
        `${c.id}:${c.cards.map((k) => `${k.key}|${k.title}|${k.checks?.tone ?? ""}`).join(",")}`,
    )
    .join(";");
}
