/**
 * The terminal has a fixed virtual size (160x45, server #24): watchers scale
 * it rather than resizing the agent's window. The fit addon tells how many
 * cells fit the box at the current font size; this picks the font size that
 * makes the fixed grid fit. A controller instead takes as many cells as fit
 * (`clampGrid`) and tells the server, which reflows tmux (#156).
 */
import { TERMINAL_SIZE_LIMITS } from "@regulus/protocol";

export const MIN_FONT_PX = 5;
export const MAX_FONT_PX = 16;

export function fitFontSize(
  currentPx: number,
  proposed: { cols: number; rows: number } | undefined,
  grid: { cols: number; rows: number },
): number {
  if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return currentPx;
  const ratio = Math.min(proposed.cols / grid.cols, proposed.rows / grid.rows);
  const next = Math.floor(currentPx * ratio * 4) / 4;
  return Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, next));
}

/**
 * The grid a controller asks for: what fits, within the protocol's bounds and
 * at most `max`. Null when the box has no size yet (hidden, not laid out).
 */
export function clampGrid(
  proposed: { cols: number; rows: number } | undefined,
  max: { cols: number; rows: number },
): { cols: number; rows: number } | null {
  if (!proposed || !(proposed.cols > 0) || !(proposed.rows > 0)) return null;
  const { minCols, minRows, maxCols, maxRows } = TERMINAL_SIZE_LIMITS;
  return {
    cols: Math.max(minCols, Math.min(maxCols, max.cols, Math.floor(proposed.cols))),
    rows: Math.max(minRows, Math.min(maxRows, max.rows, Math.floor(proposed.rows))),
  };
}
