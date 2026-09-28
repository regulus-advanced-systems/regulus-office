/**
 * Timing for the 300 ms view crossfade (SPEC §9.2): a cream overlay ramps up
 * over the first half, the camera swaps at the midpoint, and the overlay
 * ramps back down over the second half. Pure; `ViewCrossfade.tsx` draws it
 * and the view store (`state/view.ts`) flips the rendered mode at the
 * midpoint. Reduced motion (SPEC §11) skips the fade entirely (see the store).
 */

export const CROSSFADE_MS = 300;

/** Overlay opacity 0..1 at `elapsedMs` into a fade: a triangle peaking at the midpoint. */
export function crossfadeOpacity(elapsedMs: number, durationMs = CROSSFADE_MS): number {
  if (!(durationMs > 0) || !Number.isFinite(elapsedMs)) return 0;
  if (elapsedMs <= 0 || elapsedMs >= durationMs) return 0;
  const half = durationMs / 2;
  return elapsedMs < half ? elapsedMs / half : 1 - (elapsedMs - half) / half;
}

/** True once the camera should have switched to the target mode. */
export function crossfadeSwapped(elapsedMs: number, durationMs = CROSSFADE_MS): boolean {
  return elapsedMs >= durationMs / 2;
}

/** True once the fade has fully cleared. */
export function crossfadeDone(elapsedMs: number, durationMs = CROSSFADE_MS): boolean {
  return elapsedMs >= durationMs;
}
