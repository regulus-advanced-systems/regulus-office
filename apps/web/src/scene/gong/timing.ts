/**
 * When things happen after the merge gong rings (#43). Pure: fed a ring and
 * a clock (`performance.now()` milliseconds).
 *
 * - Strikes: one for a merge or a bang, three when the task queue empties,
 *   `STRIKE_GAP_MS` apart. Each strike swings the disc; the swings add up and
 *   die away (`swingAngle`), and the disc is exactly still again
 *   `SWING_MS` after the last strike.
 * - Robots cheer for `CHEER_MS` from the first strike, then go back to what
 *   they were doing (scene/robots/cheer.ts).
 * - Reduced motion: no swing, no cheer, no confetti (the toast and the
 *   gong's glow still tell what happened).
 */
import type { GongCause } from "@regulus/protocol";

export const STRIKE_GAP_MS = 900;
/** How long the robots celebrate. */
export const CHEER_MS = 3000;
/** How long a strike keeps the disc swinging. */
export const SWING_MS = 3500;
/** Confetti per ring out of the gong, and over each robot (the pool recycles on busy floors). */
export const GONG_CONFETTI = 90;
export const ROBOT_CONFETTI = 30;
/** How long the gong glows after the last strike. */
export const GLOW_MS = 1200;

const SWING_AMPLITUDE = 0.32;
const SWING_PERIOD_S = 1.1;
const SWING_DECAY_S = 0.8;

export interface GongRingView {
  /** Increases with every ring heard on this page. */
  id: number;
  floorId: string;
  cause: GongCause;
  strikes: number;
  /** When it was heard, `performance.now()` ms. */
  at: number;
}

/** When each strike lands, ms. */
export function strikeTimes(ring: Pick<GongRingView, "at" | "strikes">): number[] {
  return Array.from({ length: ring.strikes }, (_, i) => ring.at + i * STRIKE_GAP_MS);
}

/** When the last strike lands, ms. */
export function lastStrikeAt(ring: Pick<GongRingView, "at" | "strikes">): number {
  return ring.at + (ring.strikes - 1) * STRIKE_GAP_MS;
}

/** Whether robots cheer at `now`. */
export function cheerActive(
  ring: Pick<GongRingView, "at"> | null,
  now: number,
  reducedMotion: boolean,
): boolean {
  return ring !== null && !reducedMotion && now >= ring.at && now - ring.at < CHEER_MS;
}

/** Milliseconds from `now` until `cheerActive` turns false, or null when it is not active. */
export function cheerRemaining(ring: Pick<GongRingView, "at"> | null, now: number): number | null {
  if (!ring || now < ring.at || now - ring.at >= CHEER_MS) return null;
  return ring.at + CHEER_MS - now;
}

/**
 * The disc's swing about its hanging point at `now`, radians: a damped
 * pendulum per strike that has landed, summed. Exactly 0 once every strike
 * has died away, and always 0 with reduced motion.
 */
export function swingAngle(
  ring: Pick<GongRingView, "at" | "strikes"> | null,
  now: number,
  reducedMotion: boolean,
): number {
  if (!ring || reducedMotion) return 0;
  let angle = 0;
  for (const t0 of strikeTimes(ring)) {
    const dt = now - t0;
    if (dt < 0 || dt >= SWING_MS) continue;
    const s = dt / 1000;
    angle +=
      SWING_AMPLITUDE *
      Math.exp(-s / SWING_DECAY_S) *
      Math.sin((2 * Math.PI * s) / SWING_PERIOD_S) *
      (1 - dt / SWING_MS);
  }
  return angle;
}

/** 0..1 glow of the disc: full at each strike, fading out over `GLOW_MS`. */
export function glowAt(ring: Pick<GongRingView, "at" | "strikes"> | null, now: number): number {
  if (!ring) return 0;
  let glow = 0;
  for (const t0 of strikeTimes(ring)) {
    const dt = now - t0;
    if (dt >= 0 && dt < GLOW_MS) glow = Math.max(glow, 1 - dt / GLOW_MS);
  }
  return glow;
}

/** Whether the gong is still moving or glowing at `now` (the frame loop can rest otherwise). */
export function gongBusy(ring: Pick<GongRingView, "at" | "strikes"> | null, now: number): boolean {
  return ring !== null && now < lastStrikeAt(ring) + Math.max(SWING_MS, GLOW_MS);
}
