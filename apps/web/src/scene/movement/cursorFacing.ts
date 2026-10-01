/**
 * Third-person cursor facing (#119): while standing, the local player turns
 * toward the floor point under the mouse. Pure pieces live here so they can
 * be tested without a browser: screen-to-NDC, the ground-plane intersection
 * of the camera ray, the heading toward that point (with a dead zone around
 * the henchman's feet) and the tracker that decides when the cursor counts.
 * The DOM listeners are in useCursorGround.ts; the store turns the avatar in
 * `faceToward` (state/player.ts).
 */
import type { Vec2 } from "@regulus/room-layout";
import { headingOfTravel } from "./kinematics.ts";

/**
 * Cursor points closer than this to the henchman (metres) leave the heading
 * alone: the angle is unstable right at its feet, and after a click-to-walk
 * the cursor rests exactly where the henchman stops.
 */
export const CURSOR_DEADZONE = 0.35;

export interface Ndc {
  readonly x: number;
  readonly y: number;
}

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Client pixel coordinates to normalised device coordinates of `rect` (-1..1, y up). */
export function pointerToNdc(clientX: number, clientY: number, rect: RectLike): Ndc | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  };
}

/**
 * Where a ray hits the horizontal plane `y = planeY`, or null when it runs
 * parallel to the plane or points away from it.
 */
export function groundPointFromRay(origin: Vec3Like, direction: Vec3Like, planeY = 0): Vec2 | null {
  if (Math.abs(direction.y) < 1e-9) return null;
  const t = (planeY - origin.y) / direction.y;
  if (!(t >= 0) || !Number.isFinite(t)) return null;
  return { x: origin.x + direction.x * t, z: origin.z + direction.z * t };
}

/** Heading at `from` that faces the cursor's ground point, or null inside the dead zone. */
export function cursorHeading(
  from: Vec2,
  point: Vec2,
  deadzone: number = CURSOR_DEADZONE,
): number | null {
  const dx = point.x - from.x;
  const dz = point.z - from.z;
  if (Math.hypot(dx, dz) < deadzone) return null;
  return headingOfTravel(dx, dz);
}

export interface CursorContext {
  /** A HUD overlay (modal dialog) owns the input. */
  overlayOpen: boolean;
  /** First person: pointer-lock look drives the heading instead. */
  firstPerson: boolean;
}

export interface CursorTracker {
  /**
   * A pointer move at `ndc`; `overScene` is false when the pointer is over a
   * HUD panel or dialog rather than the 3D view, which drops the cursor.
   */
  move(ndc: Ndc | null, overScene: boolean): void;
  /** The pointer left the window or the window lost focus. */
  clear(): void;
  /** The cursor the henchman should face this frame, or null to leave the heading alone. */
  active(context: CursorContext): Ndc | null;
}

export function createCursorTracker(): CursorTracker {
  let ndc: Ndc | null = null;
  return {
    move(next, overScene) {
      ndc = overScene ? next : null;
    },
    clear() {
      ndc = null;
    },
    active(context) {
      if (context.overlayOpen || context.firstPerson) return null;
      return ndc;
    },
  };
}
