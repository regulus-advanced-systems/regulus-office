/**
 * Where a robot and its extras go around a desk seat (SPEC §9.1 seats carry
 * a pose facing the desk): the robot in the chair, the point on its laptop
 * (scene/laptops) the bubbles pop out of, and the floor decal with the owner's name (research 03 §4:
 * printed on the floor next to the seat, along the iso axis). Pure maths.
 */
import type { FloorTemplate, Seat } from "@regulus/floor-layout";
import { type SeatedBody, type SitAnchor, seatedOffset } from "../avatar/seatedFit.ts";
import { FALLBACK_ANCHOR } from "../furniture/sitAnchor.ts";
import { LAPTOP_TOP } from "../laptops/dimensions.ts";
import { facing, laptopPlacement } from "../laptops/placement.ts";

export { facing };

/** Bubbles pop out of the top of the laptop screen, this far above its base. */
export const SCREEN_TOP = LAPTOP_TOP + 0.01;
/** Decal centre: behind the chair, in the aisle. */
export const DECAL_BEHIND = 1.0;

export interface RobotPlacement {
  position: [number, number, number];
  rotationY: number;
}

/**
 * Where an avatar at a seat goes: seated, on the seat's sit anchor
 * (furniture/sitAnchor.ts: hips on the cushion, back just in front of the
 * backrest, #163); standing, on the seat point. Henchmen (robots, #184) and
 * seated humans both use it, each with its own seated `body` measurements.
 */
export function robotPlacement(
  seat: Seat,
  seated: boolean,
  anchor: SitAnchor = FALLBACK_ANCHOR,
  body?: SeatedBody,
): RobotPlacement {
  const f = facing(seat.pose.heading);
  const { forward, lift } = seated ? seatedOffset(anchor, body) : { forward: 0, lift: 0 };
  return {
    position: [seat.pose.x + f.x * forward, lift, seat.pose.z + f.z * forward],
    rotationY: seat.pose.heading,
  };
}

/** Where a desk's bubbles start: its laptop (scene/laptops placement), at the screen top. */
export function laptopOrigin(
  template: FloorTemplate,
  seat: Seat,
): { x: number; y: number; z: number } {
  const [x, y, z] = laptopPlacement(template, seat).position;
  return { x, y: y + SCREEN_TOP, z };
}

export interface DecalPlacement {
  position: [number, number, number];
  /** Rotation about y applied after laying the plane flat: text runs along +x or -z. */
  rotationY: number;
}

/**
 * The decal lies behind the chair and reads left-to-right on screen: the
 * iso camera looks from +x/+z, so text runs along +x for seats facing
 * north/south and along -z for seats facing east/west (its top edge points
 * away from the camera either way).
 */
export function decalPlacement(seat: Seat): DecalPlacement {
  const f = facing(seat.pose.heading);
  const alongX = Math.abs(f.z) >= Math.abs(f.x);
  return {
    position: [seat.pose.x - f.x * DECAL_BEHIND, 0.012, seat.pose.z - f.z * DECAL_BEHIND],
    rotationY: alongX ? 0 : Math.PI / 2,
  };
}
