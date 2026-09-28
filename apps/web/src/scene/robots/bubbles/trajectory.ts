/**
 * Where a bubble is `t` seconds after launch: it pops out of the laptop,
 * drifts upward with a sine sway, then flies to its HUD counter (research 03
 * §4, §8). Pure maths over plain vectors so it can be tested.
 */

export type V3 = { x: number; y: number; z: number };

export const RISE_SECONDS = 0.9;
export const FLY_SECONDS = 0.65;
export const BUBBLE_LIFETIME = RISE_SECONDS + FLY_SECONDS;
/** How high the bubble drifts above the laptop before it flies off, metres. */
export const RISE_HEIGHT = 0.9;
const SWAY = 0.08;

const easeOut = (t: number) => 1 - (1 - t) ** 2;
const easeIn = (t: number) => t * t * t;

/** Position during the rise phase (`t` in 0..RISE_SECONDS). */
export function risePosition(from: V3, t: number, seed: number, out: V3): V3 {
  const k = Math.min(1, Math.max(0, t / RISE_SECONDS));
  const sway = Math.sin(t * 7 + seed) * SWAY * (1 - k * 0.5);
  out.x = from.x + sway;
  out.y = from.y + 0.15 + easeOut(k) * RISE_HEIGHT;
  out.z = from.z - sway;
  return out;
}

/** Position during the flight (`t` in RISE_SECONDS..BUBBLE_LIFETIME) from `start` to `target`. */
export function flyPosition(start: V3, target: V3, t: number, out: V3): V3 {
  const k = easeIn(Math.min(1, Math.max(0, (t - RISE_SECONDS) / FLY_SECONDS)));
  out.x = start.x + (target.x - start.x) * k;
  out.y = start.y + (target.y - start.y) * k;
  out.z = start.z + (target.z - start.z) * k;
  return out;
}

/** Scale over the lifetime: pop in, hold, shrink a little into the counter. */
export function bubbleScale(t: number): number {
  if (t < 0.12) return 0.3 + (t / 0.12) * 0.7;
  if (t < RISE_SECONDS) return 1;
  const k = Math.min(1, (t - RISE_SECONDS) / FLY_SECONDS);
  return 1 - 0.35 * k;
}
