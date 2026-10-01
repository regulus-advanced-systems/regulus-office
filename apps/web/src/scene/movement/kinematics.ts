/**
 * Pure movement maths shared by the local player store, the path follower
 * and remote interpolation: headings (three.js `rotation.y`, see
 * floor-layout geometry.ts), turning with a rate limit and a point step
 * against a walkability predicate that slides along blocked axes.
 */
import { headingFacing, type Vec2 } from "@regulus/floor-layout";

/** Walking speed of a human avatar, metres per second. */
export const WALK_SPEED = 2.4;
/** Running speed (#223, Shift or a double-click), metres per second: 2.2 times the walk. */
export const RUN_SPEED = WALK_SPEED * 2.2;
/** How fast an avatar turns toward its travel direction, radians per second. */
export const TURN_RATE = 12;

export interface Pose extends Vec2 {
  readonly heading: number;
}

export type Walkable = (x: number, z: number) => boolean;

/** Wrap an angle into (-pi, pi]; due south is +pi, as in floor-layout's `headingFacing`. */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a > Math.PI) a -= twoPi;
  if (a <= -Math.PI) a += twoPi;
  return a;
}

/** Signed shortest rotation from `from` to `to`. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Rotate `heading` toward `target` by at most `maxDelta` radians. */
export function turnToward(heading: number, target: number, maxDelta: number): number {
  const delta = angleDelta(heading, target);
  if (Math.abs(delta) <= maxDelta) return wrapAngle(target);
  return wrapAngle(heading + Math.sign(delta) * maxDelta);
}

/** Linear interpolation of headings along the shortest arc. */
export function lerpHeading(from: number, to: number, t: number): number {
  return wrapAngle(from + angleDelta(from, to) * t);
}

/** Heading that faces the direction of travel `(dx, dz)`. */
export function headingOfTravel(dx: number, dz: number): number {
  return headingFacing({ x: dx, z: dz });
}

/** Longest single collision probe, metres; below half a 0.25 m cell so a step cannot skip a wall. */
export const MAX_COLLISION_STEP = 0.1;

function slide(walkable: Walkable, from: Vec2, dx: number, dz: number): Vec2 {
  const full = { x: from.x + dx, z: from.z + dz };
  if (walkable(full.x, full.z)) return full;
  if (dx !== 0 && walkable(from.x + dx, from.z)) return { x: from.x + dx, z: from.z };
  if (dz !== 0 && walkable(from.x, from.z + dz)) return { x: from.x, z: from.z + dz };
  return from;
}

/**
 * Move a point by `(dx, dz)`, sliding along walls: each probe tries the full
 * step first, then each axis alone, so walking diagonally into a wall keeps
 * the component that is free. Long steps are split into probes of at most
 * `maxStep` so a slow frame never tunnels through a wall. Returns the start
 * point when every probe is blocked.
 */
export function stepWithCollision(
  walkable: Walkable,
  from: Vec2,
  dx: number,
  dz: number,
  maxStep: number = MAX_COLLISION_STEP,
): Vec2 {
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) return from;
  const probes = Math.max(1, Math.ceil(length / maxStep));
  const sx = dx / probes;
  const sz = dz / probes;
  let at = from;
  for (let i = 0; i < probes; i++) {
    const next = slide(walkable, at, sx, sz);
    if (next === at) break;
    at = next;
  }
  return at;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}
