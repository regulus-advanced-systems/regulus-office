/**
 * The terminal has a fixed virtual size (160x45, server #24): viewers scale
 * it rather than resizing the agent's window. The fit addon tells how many
 * cells fit the box at the current font size; this picks the font size that
 * makes the fixed grid fit.
 */
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
