/**
 * Small geometry helpers shared by templates, validation and the nav grid.
 *
 * Coordinate system (matches `WorldPos` in @regulus/protocol): metres on the
 * ground plane, `x` to the right, `z` toward the viewer, `y` up. A template's
 * origin is its north-west corner: the north wall lies on z = 0 and the west
 * wall on x = 0. `heading` is yaw in radians as three.js `rotation.y`: 0 faces
 * -z (north), +pi/2 faces -x (west), pi faces +z (south), -pi/2 faces +x (east).
 */

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/** Axis-aligned rectangle on the ground plane; `x`/`z` is the north-west corner. */
export interface Rect {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
}

export interface Pose extends Vec2 {
  readonly heading: number;
}

export type CompassDirection = "north" | "south" | "east" | "west";

/** Unit vector for each compass direction. */
export const DIRECTION: Readonly<Record<CompassDirection, Vec2>> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

/** Heading (radians) that faces each compass direction. */
export const HEADING: Readonly<Record<CompassDirection, number>> = {
  north: 0,
  east: -Math.PI / 2,
  south: Math.PI,
  west: Math.PI / 2,
};

/** Heading that faces along direction `dir` (need not be unit length). */
export function headingFacing(dir: Vec2): number {
  // `0 - x` avoids -0, so a due-south heading is +pi rather than -pi.
  return Math.atan2(0 - dir.x, 0 - dir.z);
}

/** Heading at `from` that looks toward `to`. */
export function headingToward(from: Vec2, to: Vec2): number {
  return headingFacing({ x: to.x - from.x, z: to.z - from.z });
}

const EPS = 1e-6;

/** True when two rectangles overlap by more than a hair (touching edges do not count). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.z < b.z + b.d - EPS && a.z + a.d > b.z + EPS
  );
}

/** True when `p` lies inside `r` (edges inclusive). */
export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x - EPS && p.x <= r.x + r.w + EPS && p.z >= r.z - EPS && p.z <= r.z + r.d + EPS;
}

/** True when `inner` lies entirely inside `outer` (edges inclusive). */
export function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.z >= outer.z - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.z + inner.d <= outer.z + outer.d + EPS
  );
}

/** Rectangle covering an axis-aligned segment thickened by `thickness`. */
export function segmentRect(from: Vec2, to: Vec2, thickness: number): Rect {
  const half = thickness / 2;
  const minX = Math.min(from.x, to.x);
  const minZ = Math.min(from.z, to.z);
  return {
    x: minX - half,
    z: minZ - half,
    w: Math.abs(to.x - from.x) + thickness,
    d: Math.abs(to.z - from.z) + thickness,
  };
}

/** Two 1-D intervals `[aStart, aEnd)` and `[bStart, bEnd)` overlap by more than a hair. */
export function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd - EPS && aEnd > bStart + EPS;
}
