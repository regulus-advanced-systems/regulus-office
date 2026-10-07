/**
 * Closed rooms from outside (SPEC §14 D26; #269): a room this viewer may
 * not enter is on the map as its footprint and nothing else. It is drawn as
 * rock under a rock cap, its door (when one is known) shut behind welded
 * bars, with one neutral "no entry" plate, the same on every closed room: no
 * name, no counts, no interior, no sound. This is the geometry of that
 * plate and of where a person stands when they are told "no entry". Pure.
 */
import type { DoorSide, TileRect } from "@regulus/protocol";
import { WALL_THICKNESS } from "../lair/dimensions.ts";
import { type CompoundWorld, doorCentre, type WorldRoom } from "./world.ts";

/** The plate's size, metres (the same canvas shape as a room's name plaque). */
export const PLATE = { w: 2.6, h: 0.8125 } as const;
/** It hangs at eye height and leans out at the top, like the name plaques (#190). */
export const PLATE_Y = 2.05;
export const PLATE_TILT = 0.6;
/** From the door's centre along the wall: past the frame of a two-tile door. */
export const PLATE_ALONG = 3.3;

const OUTWARD: Readonly<Record<DoorSide, { x: number; z: number; yaw: number }>> = {
  north: { x: 0, z: -1, yaw: Math.PI },
  south: { x: 0, z: 1, yaw: 0 },
  east: { x: 1, z: 0, yaw: Math.PI / 2 },
  west: { x: -1, z: 0, yaw: -Math.PI / 2 },
};

/** The rooms of a world that are closed to this viewer. */
export function closedRooms(world: CompoundWorld): WorldRoom[] {
  return world.rooms.filter((r) => r.closed);
}

const touches = (a: TileRect, b: TileRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;

/**
 * The wall a closed room's plate hangs on: the door's wall when the door is
 * known, else the first wall with a corridor along it (south, east, west,
 * north: the default camera looks north), else the south wall.
 */
export function plateSide(room: WorldRoom, corridors: readonly TileRect[]): DoorSide {
  if (!room.sealed) return room.doorSide;
  const { x, y, w, d } = room.rect;
  const strips: Array<[DoorSide, TileRect]> = [
    ["south", { x, y: y + d, w, d: 1 }],
    ["east", { x: x + w, y, w: 1, d }],
    ["west", { x: x - 1, y, w: 1, d }],
    ["north", { x, y: y - 1, w, d: 1 }],
  ];
  for (const [side, strip] of strips) if (corridors.some((c) => touches(strip, c))) return side;
  return "south";
}

export interface PlatePose {
  side: DoorSide;
  position: [number, number, number];
  yaw: number;
  /** In front of the plate, on the corridor side: where `E` gets the "no entry" answer. */
  stand: { x: number; z: number };
}

/** Where a closed room's plate hangs, compound metres. */
export function platePose(room: WorldRoom, world: CompoundWorld): PlatePose {
  const side = plateSide(room, world.corridors);
  const o = OUTWARD[side];
  // To the left as you face the wall from the corridor.
  const along = { x: o.z, z: -o.x };
  const mid = room.sealed
    ? wallCentre(room, side)
    : (() => {
        const c = doorCentre(room, world.tileMetres);
        return { x: c.x + along.x * PLATE_ALONG, z: c.z + along.z * PLATE_ALONG };
      })();
  const out = WALL_THICKNESS + 0.03 + (PLATE.h / 2) * Math.sin(PLATE_TILT);
  const front = room.sealed ? mid : doorCentre(room, world.tileMetres);
  return {
    side,
    position: [mid.x + o.x * out, PLATE_Y, mid.z + o.z * out],
    yaw: o.yaw,
    stand: { x: front.x + o.x * 1.6, z: front.z + o.z * 1.6 },
  };
}

function wallCentre(room: WorldRoom, side: DoorSide): { x: number; z: number } {
  const { x, z } = room.origin;
  const { w, d } = room.size;
  if (side === "north") return { x: x + w / 2, z };
  if (side === "south") return { x: x + w / 2, z: z + d };
  if (side === "west") return { x, z: z + d / 2 };
  return { x: x + w, z: z + d / 2 };
}

/** From this far (metres) from a plate's `stand`, `E` is answered with "no entry". */
export const NO_ENTRY_REACH = 2.4;

/** The closed room whose door or plate the point is at, if any. */
export function closedRoomAt(
  world: CompoundWorld,
  p: { x: number; z: number },
  reach: number = NO_ENTRY_REACH,
): WorldRoom | null {
  for (const room of closedRooms(world)) {
    const { stand } = platePose(room, world);
    if (Math.hypot(stand.x - p.x, stand.z - p.z) <= reach) return room;
  }
  return null;
}
