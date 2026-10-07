/**
 * Keeps the always-on bubbles apart (#283): "needs you" and "answer ready"
 * show at any distance, so in a busy room two of them can land on the same
 * spot of the screen. Each is a box in screen pixels; a box that would cover
 * one already placed moves straight up until it is clear, so every bubble
 * stays readable and clickable. Pure: no three.js, no React.
 */

export interface StackRect {
  id: string;
  /** Centre of the bubble on screen, CSS pixels from the left. */
  x: number;
  /** Bottom edge of the bubble on screen, CSS pixels from the top (grows downwards). */
  y: number;
  w: number;
  h: number;
}

/** Pixels kept free between two stacked bubbles. */
export const STACK_GAP_PX = 4;

/**
 * How far up (pixels, 0 or more) each bubble moves so none overlap. The bubble
 * lowest on the screen (nearest the camera) stays where it is; ties go by id,
 * so the result does not depend on the order of `rects`.
 */
export function stackOffsets(rects: readonly StackRect[], gap = STACK_GAP_PX): Map<string, number> {
  const order = [...rects].sort((a, b) => b.y - a.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: { x: number; w: number; top: number; bottom: number }[] = [];
  const out = new Map<string, number>();
  for (const r of order) {
    let bottom = r.y;
    // Each pass moves the box above one more placed box, so this ends.
    for (let moved = true; moved; ) {
      moved = false;
      for (const p of placed) {
        if (Math.abs(r.x - p.x) >= (r.w + p.w) / 2 + gap) continue;
        if (bottom - r.h >= p.bottom + gap || bottom <= p.top - gap) continue;
        bottom = p.top - gap;
        moved = true;
      }
    }
    placed.push({ x: r.x, w: r.w, top: bottom - r.h, bottom });
    out.set(r.id, r.y - bottom);
  }
  return out;
}

/** True when two rects, moved up by their offsets, still overlap. */
export function stackedOverlap(
  a: StackRect,
  b: StackRect,
  offsets: ReadonlyMap<string, number>,
): boolean {
  const ay = a.y - (offsets.get(a.id) ?? 0);
  const by = b.y - (offsets.get(b.id) ?? 0);
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && ay - a.h < by && by - b.h < ay;
}
