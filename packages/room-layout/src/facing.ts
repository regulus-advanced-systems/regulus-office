/**
 * What a seat should face (#143): the table or desk it belongs to, or, for a
 * couch or armchair cushion, the coffee table in front of it. Pure data
 * helpers shared by the template tests and the scene's orientation tests.
 */
import { headingFacing, type Rect, type Vec2 } from "./geometry.ts";
import { wallPoint } from "./query.ts";
import type { Obstacle, RoomTemplate, Seat, WallAnchor } from "./types.ts";

/** Largest angle between a seat's heading and its focus that still reads as "facing it". */
export const MAX_FACING_ERROR = (20 * Math.PI) / 180;

/** How far a lounge seat looks for the coffee table (or TV) it faces, metres. */
const LOUNGE_REACH = 3;

/**
 * The point on a table a seat at `from` faces: the table's centre, or for an
 * elongated table the centre of the part in front of the seat (the closest
 * point on the table's long centre line). A shared table has several
 * workstations along it, so its overall centre is not what each chair faces.
 */
export function tableFocus(rect: Rect, from: Vec2): Vec2 {
  const cx = rect.x + rect.w / 2;
  const cz = rect.z + rect.d / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (rect.w > rect.d) {
    const half = (rect.w - rect.d) / 2;
    return { x: clamp(from.x, cx - half, cx + half), z: cz };
  }
  const half = (rect.d - rect.w) / 2;
  return { x: cx, z: clamp(from.z, cz - half, cz + half) };
}

/** Smallest angle between two headings, radians in [0, pi]. */
export function headingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** Angle between `heading` and the direction from `from` to `to`, radians. */
export function facingError(heading: number, from: Vec2, to: Vec2): number {
  return headingDelta(heading, headingFacing({ x: to.x - from.x, z: to.z - from.z }));
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A TV anchor's centre on its wall. */
function anchorCentre(template: RoomTemplate, a: WallAnchor): Vec2 | null {
  const wall = template.walls.find((w) => w.id === a.wallId);
  return wall ? wallPoint(wall, a.t) : null;
}

/**
 * The point a seat should face, or null when it has no obvious focus.
 * Desk, table and bistro chairs face their own furniture; couch and armchair
 * cushions (seat kind `couch`) face the nearest coffee table within reach,
 * else the nearest TV.
 */
export function seatFocus(template: RoomTemplate, seat: Seat): Vec2 | null {
  const from = { x: seat.pose.x, z: seat.pose.z };
  if (seat.kind !== "couch") {
    const own = template.obstacles.find((o) => o.id === seat.furnitureId);
    return own ? tableFocus(own.rect, from) : null;
  }
  const tables = template.obstacles
    .filter((o: Obstacle) => o.kind === "coffee_table")
    .map((o) => tableFocus(o.rect, from))
    .filter((p) => distance(p, from) <= LOUNGE_REACH)
    .sort((a, b) => distance(a, from) - distance(b, from));
  if (tables[0]) return tables[0];
  const tvs = template.wallAnchors
    .filter((a) => a.kind === "tv")
    .map((a) => anchorCentre(template, a))
    .filter((p): p is Vec2 => p !== null)
    .sort((a, b) => distance(a, from) - distance(b, from));
  return tvs[0] ?? null;
}
