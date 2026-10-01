/**
 * Where humans may sit (#49, SPEC §10 M3 "sitting"): the chairs and couches
 * of every room in the compound, never a henchman's desk seat nor the
 * reception chair (the PM's home). Shared by the server, which validates
 * `sit`, and the client, which draws the seats' click targets and the
 * seated avatars, so both always agree on the seat ids and points.
 *
 * - Project rooms: the non-desk seats of the generated interior (#182), the
 *   lounge nook's armchairs when the room has one.
 * - Special rooms: the lobby's sofa and armchairs, the break room's couch and
 *   bar stools, the war room's chairs. Their points mirror the hand-placed
 *   dressing in apps/web/src/scene/compound/special.ts (a web test keeps the
 *   two together), in the room's own frame (metres from its north-west corner).
 *
 * Seat `furnitureId` names the model a special seat is drawn with, so the
 * client can sit the avatar on that model's cushion.
 */
import type { DecorStyle, DoorSide, SpecialRoomKind } from "@regulus/protocol";
import { HEADING } from "../geometry.ts";
import { generateRoom, maxDeskCount } from "../room/generate.ts";
import type { RoomLayout } from "../room/types.ts";
import type { Seat, SeatKind } from "../types.ts";

/** Seat kinds a human may take. */
export const HUMAN_SEAT_KINDS: readonly SeatKind[] = ["chair", "couch"];

export function isHumanSeat(seat: Seat): boolean {
  return HUMAN_SEAT_KINDS.includes(seat.kind);
}

const seat = (
  id: string,
  kind: SeatKind,
  furnitureId: string,
  x: number,
  z: number,
  facing: DoorSide,
): Seat => ({ id, kind, furnitureId, pose: { x, z, heading: HEADING[facing] } });

/** `n` seats spread along a couch of footprint `(x, z, w, d)` facing `facing`. */
function couchSeats(
  prefix: string,
  rect: { x: number; z: number; w: number; d: number },
  facing: DoorSide,
  n: number,
): Seat[] {
  const alongX = facing === "north" || facing === "south";
  const length = alongX ? rect.w : rect.d;
  const out: Seat[] = [];
  for (let i = 0; i < n; i++) {
    const t = (length * (i + 0.5)) / n;
    const x = alongX ? rect.x + t : rect.x + rect.w / 2;
    const z = alongX ? rect.z + rect.d / 2 : rect.z + t;
    out.push(seat(`${prefix}-${i + 1}`, "couch", "couch", x, z, facing));
  }
  return out;
}

function lobbySeats(w: number, d: number): Seat[] {
  return [
    ...couchSeats("sofa", { x: w - 7.6, z: d - 3.6, w: 4, d: 1.1 }, "north", 3),
    seat("armchair-w", "couch", "armchair", w - 9.4 + 0.55, d - 6.4 + 0.55, "east"),
    seat("armchair-e", "couch", "armchair", w - 2.6 + 0.55, d - 6.4 + 0.55, "west"),
  ];
}

function conferenceSeats(w: number, d: number): Seat[] {
  const table = { x: w / 2 - 3, z: d / 2 - 1, w: 6, d: 2.6 };
  const out: Seat[] = [];
  for (let i = 0; i < 3; i++) {
    const x = table.x + 1 + i * 2;
    out.push(seat(`chair-n${i + 1}`, "chair", "leather_chair", x, table.z - 0.7, "south"));
    out.push(
      seat(`chair-s${i + 1}`, "chair", "leather_chair", x, table.z + table.d + 0.7, "north"),
    );
  }
  const mid = table.z + table.d / 2;
  out.push(seat("chair-w", "chair", "leather_chair", table.x - 0.7, mid, "east"));
  out.push(seat("chair-e", "chair", "leather_chair", table.x + table.w + 0.7, mid, "west"));
  return out;
}

/** Bistro tables of the break room (north-west corners), shared with the dressing. */
export function breakRoomTables(w: number, d: number): ReadonlyArray<readonly [number, number]> {
  return [
    [w / 2 - 3, d / 2 - 2],
    [w / 2 + 1.5, d / 2 - 2],
    [w / 2 - 1, d / 2 + 2.2],
  ];
}

function breakRoomSeats(w: number, d: number): Seat[] {
  const out = couchSeats("couch", { x: 0.5, z: d / 2 - 1, w: 1.1, d: 3.4 }, "east", 3);
  breakRoomTables(w, d).forEach(([tx, tz], i) => {
    out.push(seat(`stool-${i + 1}w`, "chair", "stool_chair", tx - 0.45, tz + 0.5, "east"));
    out.push(seat(`stool-${i + 1}e`, "chair", "stool_chair", tx + 1.45, tz + 0.5, "west"));
  });
  return out;
}

/** The seats of a special room of `w × d` metres, room frame. */
export function specialRoomSeats(kind: SpecialRoomKind, w: number, d: number): Seat[] {
  if (kind === "lobby") return lobbySeats(w, d);
  if (kind === "conference") return conferenceSeats(w, d);
  return breakRoomSeats(w, d);
}

/** What decides a project room's interior: its published size, door and room settings. */
export interface ProjectRoomInput {
  /** Tiles. */
  readonly width: number;
  readonly depth: number;
  readonly doorSide: DoorSide;
  readonly deskCount: number;
  readonly decorStyle: DecorStyle;
}

const layouts = new Map<string, RoomLayout | null>();

/**
 * A project room's generated interior with its desk count clamped to what
 * the size fits (at least one), cached per setting; null when it cannot be
 * generated. The scene, quick travel and the server's seat check all use it.
 */
export function projectRoomLayout(room: ProjectRoomInput): RoomLayout | null {
  let desks = Math.max(1, room.deskCount);
  try {
    desks = Math.min(desks, maxDeskCount(room.width, room.depth));
  } catch {
    return null;
  }
  const key = `${room.width}x${room.depth}:${room.doorSide}:${desks}:${room.decorStyle}`;
  if (layouts.has(key)) return layouts.get(key) ?? null;
  let layout: RoomLayout | null = null;
  try {
    layout = generateRoom({ ...room, deskCount: desks });
  } catch {
    layout = null;
  }
  layouts.set(key, layout);
  return layout;
}

/** The seats humans may take in a project room, room frame. */
export function projectRoomSeats(room: ProjectRoomInput): Seat[] {
  return (projectRoomLayout(room)?.seats ?? []).filter(isHumanSeat);
}
