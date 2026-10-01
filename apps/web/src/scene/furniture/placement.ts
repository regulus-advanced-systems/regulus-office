/**
 * Template-to-mesh placement (SPEC §9.1: furniture positions come from the
 * floor template). Pure maths: which way a piece faces, what footprint it
 * should visually cover, and how to scale a loaded model into that footprint.
 */
import {
  DIRECTION,
  type RoomTemplate,
  HEADING,
  headingFacing,
  type Obstacle,
  type ObstacleKind,
  type Rect,
  rectInside,
  type Seat,
  WALL_THICKNESS,
  type Wall,
  type WallAnchor,
  wallPoint,
} from "@regulus/room-layout";
import { planeYawFacing, WALL_SURFACE_GAP } from "../room/roomPieces.ts";

export type Vec3Tuple = readonly [number, number, number];

export interface BoxSize {
  readonly w: number;
  readonly h: number;
  readonly d: number;
}

export interface BoxBounds {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

export interface Placement {
  position: Vec3Tuple;
  rotationY: number;
  scale: Vec3Tuple;
}

export interface FitOptions {
  /** Height the model should end up, metres. Defaults to fitting the footprint. */
  targetHeight?: number;
  /** Scale all axes by the height ratio (keeps proportions; centred in the rect). */
  uniform?: boolean;
  /** Heading (three.js rotation.y) the unrotated model faces; default faces +z. */
  modelHeading?: number;
}

export function boxSize(b: BoxBounds): BoxSize {
  return { w: b.max.x - b.min.x, h: b.max.y - b.min.y, d: b.max.z - b.min.z };
}

/** Translation that puts a model's bounds centre-bottom at the origin. */
export function centreBottomOffset(b: BoxBounds): Vec3Tuple {
  return [-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2];
}

/** Pot footprint the plant model's target height is authored for, metres. */
export const PLANT_BASE_FOOTPRINT = 0.5;
/** Tallest a plant grows relative to its base height (a big palm, not a tree). */
export const PLANT_MAX_GROWTH = 1.8;

/**
 * Target height for a prop: plants grow with their pot, so the few large
 * plants in the templates (#118) read as big palms rather than small pots
 * with wide shadows. Everything else keeps its catalog height.
 */
export function propTargetHeight(kind: ObstacleKind, rect: Rect, base: number): number {
  if (kind !== "plant") return base;
  const growth = Math.min(rect.w, rect.d) / PLANT_BASE_FOOTPRINT;
  return base * Math.min(PLANT_MAX_GROWTH, Math.max(1, growth));
}

/** Half-metre square footprint used for seats when a couch spans its cushions. */
export const SEAT_FOOTPRINT = 0.5;

/**
 * Footprint a piece should visually cover. The template's couch rect is only
 * the backrest (its cushions are seats), so the couch grows over its seats.
 */
export function visualFootprint(obstacle: Obstacle, seats: readonly Seat[]): Rect {
  const own = seats.filter((s) => s.furnitureId === obstacle.id);
  if ((obstacle.kind !== "couch" && obstacle.kind !== "armchair") || own.length === 0)
    return obstacle.rect;
  let x0 = obstacle.rect.x;
  let z0 = obstacle.rect.z;
  let x1 = obstacle.rect.x + obstacle.rect.w;
  let z1 = obstacle.rect.z + obstacle.rect.d;
  const half = SEAT_FOOTPRINT / 2;
  for (const s of own) {
    x0 = Math.min(x0, s.pose.x - half);
    z0 = Math.min(z0, s.pose.z - half);
    x1 = Math.max(x1, s.pose.x + half);
    z1 = Math.max(z1, s.pose.z + half);
  }
  return { x: x0, z: z0, w: x1 - x0, d: z1 - z0 };
}

/** Heading that faces away from the nearest perimeter wall. */
export function headingAwayFromNearestWall(rect: Rect, size: RoomTemplate["size"]): number {
  const cx = rect.x + rect.w / 2;
  const cz = rect.z + rect.d / 2;
  const candidates: Array<[number, number]> = [
    [cz, HEADING.south],
    [size.depth - cz, HEADING.north],
    [cx, HEADING.east],
    [size.width - cx, HEADING.west],
  ];
  candidates.sort((a, b) => a[0] - b[0]);
  return candidates[0]?.[1] ?? HEADING.south;
}

/** Kinds whose top surface other pieces can rest on. */
export const SUPPORT_KINDS: ReadonlySet<ObstacleKind> = new Set([
  "counter",
  "desk",
  "reception_desk",
  "shared_table",
  "ceo_desk",
  "meeting_table",
  "bistro_table",
  "coffee_table",
  "cabinet",
]);

/**
 * Height a piece rests at: on top of a supporting piece whose footprint
 * contains it (a coffee machine on the counter), else the floor.
 */
export function restingHeight(
  obstacle: Obstacle,
  obstacles: readonly Obstacle[],
  heightOf: (kind: ObstacleKind) => number,
): number {
  let y = 0;
  for (const other of obstacles) {
    if (other.id === obstacle.id || !SUPPORT_KINDS.has(other.kind)) continue;
    if (SUPPORT_KINDS.has(obstacle.kind)) continue;
    if (rectInside(obstacle.rect, other.rect)) y = Math.max(y, heightOf(other.kind));
  }
  return y;
}

/** Round a heading to the nearest quarter turn; template furniture is axis-aligned. */
export function snapHeading(heading: number): number {
  const quarter = Math.PI / 2;
  const snapped = Math.round(heading / quarter) * quarter;
  // Keep the result in (-pi, pi] like `headingFacing`.
  return snapped <= -Math.PI ? snapped + 2 * Math.PI : snapped;
}

/** Kinds that are themselves the seat: they face the way their sitter does. */
export const SEAT_FURNITURE: ReadonlySet<ObstacleKind> = new Set(["couch", "armchair"]);

/** The opposite heading, kept in (-pi, pi]. */
export function turnAround(heading: number): number {
  const h = heading + Math.PI;
  return h > Math.PI ? h - 2 * Math.PI : h;
}

/**
 * Which way a piece's front faces (#143): a couch or armchair faces the way
 * its sitter does; a desk or table faces its sitter (the drawers are on the
 * chair's side); an interactable faces its `standAt` pose; anything else
 * faces away from the closest wall, into the room. A heading, not yet
 * corrected for the model's own front (`fitToFootprint` does that).
 */
export function furnitureHeading(
  obstacle: Obstacle,
  seats: readonly Seat[],
  size: RoomTemplate["size"],
): number {
  const seat = seats.find((s) => s.furnitureId === obstacle.id);
  if (seat)
    return SEAT_FURNITURE.has(obstacle.kind) ? seat.pose.heading : turnAround(seat.pose.heading);
  if (obstacle.standAt) {
    const cx = obstacle.rect.x + obstacle.rect.w / 2;
    const cz = obstacle.rect.z + obstacle.rect.d / 2;
    return snapHeading(headingFacing({ x: obstacle.standAt.x - cx, z: obstacle.standAt.z - cz }));
  }
  return headingAwayFromNearestWall(obstacle.rect, size);
}

const EPS = 1e-9;

/**
 * Scale and place a model (already re-centred with `centreBottomOffset`) so
 * that, after turning it to `heading`, it covers `rect` on the floor.
 */
export function fitToFootprint(
  size: BoxSize,
  rect: Rect,
  heading: number,
  opts: FitOptions = {},
): Placement {
  const modelHeading = opts.modelHeading ?? HEADING.south;
  const rotationY = heading - modelHeading;
  const swaps = Math.abs(Math.sin(rotationY)) > Math.abs(Math.cos(rotationY));
  const alongX = swaps ? rect.d : rect.w;
  const alongZ = swaps ? rect.w : rect.d;
  const sy = opts.targetHeight !== undefined ? opts.targetHeight / Math.max(size.h, EPS) : 0;
  let sx = alongX / Math.max(size.w, EPS);
  let sz = alongZ / Math.max(size.d, EPS);
  let syFinal = sy > 0 ? sy : Math.min(sx, sz);
  if (opts.uniform) {
    const s = sy > 0 ? sy : Math.min(sx, sz);
    sx = s;
    sz = s;
    syFinal = s;
  }
  return {
    position: [rect.x + rect.w / 2, 0, rect.z + rect.d / 2],
    rotationY,
    scale: [sx, syFinal, sz],
  };
}

export interface AnchorPlacement {
  position: Vec3Tuple;
  rotationY: number;
  width: number;
  height: number;
}

/** Where a wall-anchored object hangs: on the wall's room-facing surface. */
export function anchorPlacement(
  wall: Wall,
  anchor: Pick<WallAnchor, "t" | "y" | "w" | "h">,
  depth = 0,
): AnchorPlacement {
  const p = wallPoint(wall, anchor.t);
  const f = DIRECTION[wall.facing];
  const off = WALL_THICKNESS / 2 + WALL_SURFACE_GAP + depth / 2;
  return {
    position: [p.x + f.x * off, anchor.y, p.z + f.z * off],
    rotationY: planeYawFacing(f),
    width: anchor.w,
    height: anchor.h,
  };
}

/** Ground direction a placed model's front points: its +z axis after `rotation.y`. */
export function modelForward(rotationY: number): { x: number; z: number } {
  return { x: Math.sin(rotationY), z: Math.cos(rotationY) };
}

/** How deep a wall-mounted TV's footprint is, metres. */
export const TV_DEPTH = 0.25;

export interface WallPropPlacement {
  rect: Rect;
  heading: number;
  /** Height of the model's base above the floor. */
  y: number;
}

/**
 * Footprint and heading of a model hung on a wall anchor (the TV): its
 * width runs along the wall, its depth out from the wall's room side, and it
 * faces into the room.
 */
export function wallPropPlacement(
  wall: Wall,
  anchor: Pick<WallAnchor, "t" | "y" | "w" | "h">,
  depth = TV_DEPTH,
): WallPropPlacement {
  const p = anchorPlacement(wall, anchor, depth);
  const f = DIRECTION[wall.facing];
  const alongX = Math.abs(f.z) > Math.abs(f.x);
  const w = alongX ? anchor.w : depth;
  const d = alongX ? depth : anchor.w;
  return {
    rect: { x: p.position[0] - w / 2, z: p.position[2] - d / 2, w, d },
    heading: headingFacing(f),
    y: anchor.y - anchor.h / 2,
  };
}
