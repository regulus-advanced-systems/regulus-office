/**
 * Usage screens (#40, SPEC §9.4) drawn with Canvas 2D into a texture:
 *
 * - `wall`: the lobby's big usage-tracker wall: the viewer's own plan windows
 *   as bars, their spend today, the office totals and today's top robots.
 * - `compact`: the small screen in each room: own windows and own spend, one
 *   office line.
 *
 * Pure drawing on a minimal context so it is unit-tested with a recorder.
 * Colours follow the lair console look (SPEC §12) and can be swapped with
 * the compound restyle (M2.5) without touching the data.
 */
import type { LimitTone, UsageModel } from "../../ui/usage/model.ts";

export type UsageScreenVariant = "wall" | "compact";

export const USAGE_TEXTURE_SIZE: Record<UsageScreenVariant, { width: number; height: number }> = {
  wall: { width: 1024, height: 480 },
  compact: { width: 512, height: 330 },
};

export const USAGE_COLORS = {
  background: "#1D2129",
  panel: "#262B35",
  text: "#F3EBD3",
  muted: "#9AA3B2",
  heading: "#F2C200",
  track: "#3A404C",
  ok: "#2EC4B6",
  warn: "#F5A623",
  high: "#D7263D",
  cash: "#6BD08A",
} as const;

const TONE: Record<LimitTone, string> = {
  ok: USAGE_COLORS.ok,
  warn: USAGE_COLORS.warn,
  high: USAGE_COLORS.high,
};

/** Minimal Canvas 2D surface (a real context, or a recorder in tests). */
export interface UsagePaintable {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

/** Cut to `max` characters with an ellipsis (no measureText, deterministic). */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

function text(
  ctx: UsagePaintable,
  value: string,
  x: number,
  y: number,
  opts: { px: number; color: string; bold?: boolean; align?: CanvasTextAlign },
) {
  ctx.font = `${opts.bold ? "700 " : ""}${opts.px}px "Open Sans", sans-serif`;
  ctx.fillStyle = opts.color;
  ctx.textAlign = opts.align ?? "left";
  ctx.fillText(value, x, y);
}

function bars(
  ctx: UsagePaintable,
  model: UsageModel,
  x: number,
  y: number,
  w: number,
  max: number,
  px: number,
): number {
  if (model.limits.length === 0) {
    const note = model.mineLoaded ? "No plan windows reported yet" : "Sign in to see your windows";
    text(ctx, note, x, y, { px, color: USAGE_COLORS.muted });
    return y + px * 1.6;
  }
  const rowH = px * 3.6;
  for (const row of model.limits.slice(0, max)) {
    text(ctx, clip(row.label, 22), x, y, { px, color: USAGE_COLORS.text });
    text(ctx, `${Math.round(row.pct)}%`, x + w, y, {
      px,
      color: USAGE_COLORS.text,
      bold: true,
      align: "right",
    });
    const barY = y + px * 1.25;
    const barH = Math.max(4, px * 0.55);
    ctx.fillStyle = USAGE_COLORS.track;
    ctx.fillRect(x, barY, w, barH);
    ctx.fillStyle = TONE[row.tone];
    ctx.fillRect(x, barY, (w * row.pct) / 100, barH);
    if (row.detail) {
      text(ctx, row.detail, x, barY + barH + px * 0.3, {
        px: Math.round(px * 0.8),
        color: USAGE_COLORS.muted,
      });
    }
    y += rowH;
  }
  return y;
}

export function paintUsageScreen(
  ctx: UsagePaintable,
  model: UsageModel,
  variant: UsageScreenVariant,
  size = USAGE_TEXTURE_SIZE[variant],
): void {
  const { width: W, height: H } = size;
  ctx.textBaseline = "top";
  ctx.fillStyle = USAGE_COLORS.background;
  ctx.fillRect(0, 0, W, H);
  if (variant === "compact") {
    paintCompact(ctx, model, W, H);
    return;
  }
  const pad = 28;
  text(ctx, "USAGE TRACKER", pad, 20, { px: 30, color: USAGE_COLORS.heading, bold: true });
  text(ctx, "shown only · never capped", W - pad, 30, {
    px: 16,
    color: USAGE_COLORS.muted,
    align: "right",
  });

  // Left: the viewer's own windows and spend.
  const colW = (W - pad * 4) / 3;
  const top = 76;
  ctx.fillStyle = USAGE_COLORS.panel;
  for (let i = 0; i < 3; i++) ctx.fillRect(pad + i * (colW + pad), top, colW, H - top - pad);
  const inner = 16;
  let x = pad + inner;
  const w = colW - inner * 2;
  text(ctx, "YOUR WINDOWS", x, top + 14, { px: 18, color: USAGE_COLORS.muted, bold: true });
  bars(ctx, model, x, top + 50, w, 5, 18);

  // Middle: own spend, then the office.
  x = pad + colW + pad + inner;
  text(ctx, "YOU TODAY", x, top + 14, { px: 18, color: USAGE_COLORS.muted, bold: true });
  text(ctx, model.myTodayUsd, x, top + 44, { px: 44, color: USAGE_COLORS.cash, bold: true });
  text(ctx, `${model.myTodayTokens} tokens · 7 days ${model.my7dUsd}`, x, top + 100, {
    px: 17,
    color: USAGE_COLORS.text,
  });
  text(ctx, "OFFICE TODAY", x, top + 150, { px: 18, color: USAGE_COLORS.muted, bold: true });
  text(ctx, model.officeTodayUsd, x, top + 180, { px: 34, color: USAGE_COLORS.cash, bold: true });
  text(ctx, `${model.officeTodayTokens} tokens · ${model.activeHumans} humans`, x, top + 226, {
    px: 17,
    color: USAGE_COLORS.text,
  });
  text(ctx, `office keys ${model.officeKeysUsd}`, x, top + 254, {
    px: 17,
    color: USAGE_COLORS.muted,
  });

  // Right: top robots by tokens (robot name + owner only).
  x = pad + 2 * (colW + pad) + inner;
  text(ctx, "TOP HENCHMEN", x, top + 14, { px: 18, color: USAGE_COLORS.muted, bold: true });
  if (model.top.length === 0) {
    text(ctx, "No henchman work yet today", x, top + 50, { px: 17, color: USAGE_COLORS.muted });
  }
  model.top.slice(0, 5).forEach((r, i) => {
    const y = top + 50 + i * 60;
    text(ctx, `${i + 1}. ${clip(r.name, 24)}`, x, y, { px: 17, color: USAGE_COLORS.text });
    text(ctx, r.tokens, x + w, y + 24, {
      px: 17,
      color: USAGE_COLORS.heading,
      bold: true,
      align: "right",
    });
  });
}

function paintCompact(ctx: UsagePaintable, model: UsageModel, W: number, H: number): void {
  const pad = 18;
  text(ctx, "USAGE", pad, 14, { px: 24, color: USAGE_COLORS.heading, bold: true });
  text(ctx, model.myTodayUsd, W - pad, 12, {
    px: 28,
    color: USAGE_COLORS.cash,
    bold: true,
    align: "right",
  });
  const y = bars(ctx, model, pad, 62, W - pad * 2, 3, 17);
  text(
    ctx,
    `office today ${model.officeTodayUsd} · ${model.officeTodayTokens} tokens`,
    pad,
    Math.max(y, H - 40),
    {
      px: 16,
      color: USAGE_COLORS.muted,
    },
  );
}
