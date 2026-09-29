/**
 * Read-only helpers over a `FloorTemplate`: walls, anchors, seats and the
 * list of interactables (for pathing targets and the `E` key).
 */
import {
  DIRECTION,
  headingFacing,
  type Pose,
  type Rect,
  segmentRect,
  type Vec2,
} from "./geometry.ts";
import type { FloorTemplate, Interactable, Seat, Wall, WallAnchor } from "./types.ts";

/** Physical thickness used when walls block navigation, metres. */
export const WALL_THICKNESS = 0.2;

export function wallById(template: FloorTemplate, wallId: string): Wall | undefined {
  return template.walls.find((w) => w.id === wallId);
}

export function wallLength(wall: Wall): number {
  return Math.abs(wall.to.x - wall.from.x) + Math.abs(wall.to.z - wall.from.z);
}

/** Unit direction along the wall from `from` to `to` (axis-aligned walls only). */
export function wallDirection(wall: Wall): Vec2 {
  const dx = wall.to.x - wall.from.x;
  const dz = wall.to.z - wall.from.z;
  const len = Math.abs(dx) + Math.abs(dz);
  return len === 0 ? { x: 0, z: 0 } : { x: dx / len, z: dz / len };
}

/** Point on the wall line at distance `t` from `from`. */
export function wallPoint(wall: Wall, t: number): Vec2 {
  const dir = wallDirection(wall);
  return { x: wall.from.x + dir.x * t, z: wall.from.z + dir.z * t };
}

/** Footprint a wall blocks on the nav grid. */
export function wallRect(wall: Wall): Rect {
  return segmentRect(wall.from, wall.to, WALL_THICKNESS);
}

/** Where an avatar stands to use an anchor: `approach` metres off the wall, facing it. */
export function anchorStandPose(wall: Wall, anchor: WallAnchor): Pose {
  const p = wallPoint(wall, anchor.t);
  const f = DIRECTION[wall.facing];
  return {
    x: p.x + f.x * anchor.approach,
    z: p.z + f.z * anchor.approach,
    heading: headingFacing({ x: -f.x, z: -f.z }),
  };
}

/** Distance of the wall anchor's centre from the floor at both ends of its span. */
export function anchorSpan(anchor: Pick<WallAnchor, "t" | "w">): { start: number; end: number } {
  return { start: anchor.t - anchor.w / 2, end: anchor.t + anchor.w / 2 };
}

/** Project a rectangle onto a wall's axis, as a `[start, end]` span along `t`. */
export function rectSpanOnWall(wall: Wall, rect: Rect): { start: number; end: number } {
  const dir = wallDirection(wall);
  const along = (p: Vec2) => (p.x - wall.from.x) * dir.x + (p.z - wall.from.z) * dir.z;
  const a = along({ x: rect.x, z: rect.z });
  const b = along({ x: rect.x + rect.w, z: rect.z + rect.d });
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function deskSeats(template: FloorTemplate): Seat[] {
  return template.seats.filter((s) => s.kind === "desk");
}

export function seatById(template: FloorTemplate, seatId: string): Seat | undefined {
  return template.seats.find((s) => s.id === seatId);
}

/**
 * Everything an avatar can interact with, with the pose to walk to first:
 * the elevator, every wall anchor and every obstacle with a `standAt`.
 * Seats are not included; use `template.seats`.
 */
export function interactables(template: FloorTemplate): Interactable[] {
  const out: Interactable[] = [
    { id: "elevator", kind: "elevator", standAt: template.elevator.door },
  ];
  for (const anchor of template.wallAnchors) {
    const wall = wallById(template, anchor.wallId);
    if (wall)
      out.push({ id: anchor.id, kind: anchor.kind, standAt: anchorStandPose(wall, anchor) });
  }
  for (const obstacle of template.obstacles) {
    if (obstacle.standAt)
      out.push({ id: obstacle.id, kind: obstacle.kind, standAt: obstacle.standAt });
  }
  return out;
}
