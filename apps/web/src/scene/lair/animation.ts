/**
 * Pure animation and light-pooling rules for the lair kit (#183), kept out
 * of the components so they are unit-tested: door travel, console lamp
 * blinking, beacon flashing and which lamps get a real point light.
 */

/** Seconds a sliding door takes to open or close fully. */
export const DOOR_TRAVEL_S = 0.9;

/** Move a door's openness (0 closed, 1 open) toward its target at constant speed. */
export function stepOpenness(
  current: number,
  target: number,
  dt: number,
  travel = DOOR_TRAVEL_S,
): number {
  const step = Math.max(0, dt) / travel;
  if (current < target) return Math.min(target, current + step);
  if (current > target) return Math.max(target, current - step);
  return current;
}

/** Eased leaf travel for an openness: slow start (heavy steel), slow stop. */
export function easeDoor(openness: number): number {
  const t = Math.min(1, Math.max(0, openness));
  return t * t * (3 - 2 * t);
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Dim level of a lamp that is "off": still visibly a lamp. */
export const LAMP_OFF = 0.18;

/**
 * Brightness of console lamp `index` at time `t` seconds, in [LAMP_OFF, 1].
 * Each lamp has its own rate (1.5-6 Hz) and duty, so a bank twinkles
 * without a visible pattern; about a third of the lamps hold steady.
 */
export function lampLevel(index: number, t: number): number {
  const kind = hash(index * 3 + 1);
  if (kind < 0.33) return 1;
  const rate = 1.5 + hash(index * 3 + 2) * 4.5;
  const tick = Math.floor(t * rate + hash(index * 3 + 3) * 10);
  return hash(tick * 7919 + index) < 0.55 ? 1 : LAMP_OFF;
}

/** Alarm beacon intensity at time `t` (seconds): a rotating-reflector sweep, 1.25 rev/s. */
export function beaconLevel(t: number, phase = 0): number {
  const a = (t * 1.25 + phase) * Math.PI * 2;
  return 0.25 + 0.75 * Math.max(0, Math.cos(a)) ** 3;
}

export interface PooledLamp {
  x: number;
  y: number;
  z: number;
}

/**
 * The lamps that get a real point light: the `max` nearest to `focus`
 * (SPEC §12: "a few pooled point lights per visible room"). Every other
 * lamp still glows (its bulb is unlit geometry) but lights nothing.
 * Returns indices into `lamps`, nearest first; ties keep input order.
 */
export function poolLights(
  lamps: readonly PooledLamp[],
  focus: { x: number; z: number },
  max: number,
): number[] {
  return lamps
    .map((l, i) => ({ i, d: (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2 }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map((e) => e.i);
}
