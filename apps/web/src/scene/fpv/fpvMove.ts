/**
 * First-person movement maths (SPEC §9.2): WASD relative to the camera yaw,
 * walking speed, and collision against the template's nav grid with sliding
 * along blocked cells. Pure; `FirstPersonRig.tsx` applies it every frame.
 *
 * Headings follow `@regulus/room-layout`: yaw is three.js `rotation.y`,
 * 0 faces -z (north), +pi/2 faces -x (west).
 */
import type { NavGrid } from "@regulus/room-layout";

/** Longest frame step in seconds, so a hitch never tunnels through a wall. */
export const MAX_FRAME_DT = 0.1;
/** Half-width of the player's collision footprint, metres. */
export const BODY_RADIUS = 0.2;
/** Nav-grid cell size for collision (finer than the 0.5 m path-finding grid). */
export const NAV_CELL_SIZE = 0.25;
/** Eye height as a fraction of ROBOT_HEIGHT. */
export const EYE_HEIGHT_RATIO = 0.9;

/** A direction, or `run` (Shift held, #223). */
export type MoveAction = "forward" | "back" | "left" | "right" | "run";

/** `KeyboardEvent.code` to action: WASD, the arrow keys and Shift, layout independent. */
export const KEY_ACTIONS: Readonly<Record<string, MoveAction>> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  ShiftLeft: "run",
  ShiftRight: "run",
};

export function actionForCode(code: string): MoveAction | null {
  return KEY_ACTIONS[code] ?? null;
}

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export const ZERO: Vec2 = { x: 0, z: 0 };

/** Unit vector the camera looks along on the ground plane. */
export function forwardVector(yaw: number): Vec2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Unit vector to the camera's right on the ground plane. */
export function rightVector(yaw: number): Vec2 {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/**
 * Normalised ground direction for the held actions relative to `yaw`, or
 * zero when nothing (or opposing keys) is held. Diagonals are not faster.
 */
export function moveVector(held: Iterable<MoveAction>, yaw: number): Vec2 {
  const set = held instanceof Set ? (held as Set<MoveAction>) : new Set(held);
  const f = (set.has("forward") ? 1 : 0) - (set.has("back") ? 1 : 0);
  const r = (set.has("right") ? 1 : 0) - (set.has("left") ? 1 : 0);
  if (f === 0 && r === 0) return ZERO;
  const fw = forwardVector(yaw);
  const rt = rightVector(yaw);
  const x = fw.x * f + rt.x * r;
  const z = fw.z * f + rt.z * r;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}

export function clampDt(dt: number): number {
  if (!Number.isFinite(dt) || dt < 0) return 0;
  return Math.min(dt, MAX_FRAME_DT);
}

/** True when a body of `radius` centred at (x, z) stands only on walkable cells. */
export function canStand(grid: NavGrid, x: number, z: number, radius = BODY_RADIUS): boolean {
  return (
    grid.isWalkable(x, z) &&
    grid.isWalkable(x - radius, z - radius) &&
    grid.isWalkable(x + radius, z - radius) &&
    grid.isWalkable(x - radius, z + radius) &&
    grid.isWalkable(x + radius, z + radius)
  );
}

export interface Step {
  x: number;
  z: number;
  /** Displacement actually applied (after collision). */
  dx: number;
  dz: number;
  blocked: boolean;
}

/**
 * Move from (x, z) by (dx, dz). When the full step is blocked, slide along
 * whichever axis stays free (x first), otherwise stay put.
 */
export function stepWithCollision(
  grid: NavGrid,
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius = BODY_RADIUS,
): Step {
  if (dx === 0 && dz === 0) return { x, z, dx: 0, dz: 0, blocked: false };
  if (canStand(grid, x + dx, z + dz, radius))
    return { x: x + dx, z: z + dz, dx, dz, blocked: false };
  if (dx !== 0 && canStand(grid, x + dx, z, radius)) {
    return { x: x + dx, z, dx, dz: 0, blocked: true };
  }
  if (dz !== 0 && canStand(grid, x, z + dz, radius)) {
    return { x, z: z + dz, dx: 0, dz, blocked: true };
  }
  return { x, z, dx: 0, dz: 0, blocked: true };
}
