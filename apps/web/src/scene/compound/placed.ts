/**
 * Room art moved into compound metres (#186): each room's pieces, doors,
 * lamps and looks offset by its origin, cached per room art, plus the
 * room's bounds for culling. Pure.
 */

import type { WorldLamp } from "../lair/components/BlinkingLamps.tsx";
import type { DoorState } from "../lair/components/SlidingDoors.tsx";
import type { Vec3 } from "../lair/geometry/builder.ts";
import { type PiecePlacement, transformPlacements } from "../lair/placements.ts";
import type { LookItem } from "../lair/roomScene.ts";
import { type RoomArt, roomArt } from "./interiors.ts";
import type { WorldRoom } from "./world.ts";

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface PlacedRoom {
  room: WorldRoom;
  art: RoomArt;
  bounds: Bounds;
  pieces: PiecePlacement[];
  laptops: PiecePlacement[];
  /** The desk seat of each of `laptops`. */
  laptopSeats: string[];
  /** Mutable `open` flags (the door controller animates them in place). */
  doors: DoorState[];
  beacons: Omit<PiecePlacement, "piece">[];
  lamps: PiecePlacement[];
  consoleLamps: WorldLamp[];
  looks: LookItem[];
}

const shift = (p: Vec3, x: number, z: number): Vec3 => [p[0] + x, p[1], p[2] + z];

const cache = new WeakMap<RoomArt, Map<string, PlacedRoom>>();

export function placeRoom(room: WorldRoom): PlacedRoom {
  const art = roomArt(room);
  const key = `${room.origin.x},${room.origin.z}`;
  let byOrigin = cache.get(art);
  const hit = byOrigin?.get(key);
  if (hit) return { ...hit, room };
  const { x, z } = room.origin;
  const off: Vec3 = [x, 0, z];
  const placed: PlacedRoom = {
    room,
    art,
    bounds: { minX: x - 1, minZ: z - 1, maxX: x + room.size.w + 1, maxZ: z + room.size.d + 1 },
    pieces: transformPlacements(art.pieces, off),
    laptops: transformPlacements(art.laptops, off),
    laptopSeats: art.laptopSeats,
    doors: art.doors.map((d, i) => ({
      id: `${room.id}#${i}`,
      position: shift(d.position, x, z),
      rotationY: d.rotationY,
      span: d.span,
      open: false,
    })),
    beacons: art.beacons.map((b) => ({
      position: shift(b.position, x, z),
      rotationY: b.rotationY,
    })),
    lamps: transformPlacements(art.lamps, off),
    consoleLamps: art.consoleLamps.map((l) => ({ ...l, pos: shift(l.pos, x, z) })),
    looks: art.looks.map((l) => ({ ...l, position: shift(l.position, x, z) })),
  };
  if (!byOrigin) {
    byOrigin = new Map();
    cache.set(art, byOrigin);
  }
  byOrigin.set(key, placed);
  return placed;
}

/** The lobby's blast door (#188 opens it): a wide door pair in its south wall, shut. */
export function blastDoors(
  lobby: WorldRoom,
  tileMetres: number,
  blast: { x: number; width: number },
): DoorState[] {
  const z = lobby.origin.z + lobby.size.d + 0.18;
  const start = blast.x * tileMetres;
  const out: DoorState[] = [];
  for (let i = 0; i < blast.width; i += 2) {
    out.push({
      id: `blast#${i}`,
      position: [start + (i + 1) * tileMetres, 0, z],
      rotationY: Math.PI,
      span: 2,
      open: false,
    });
  }
  return out;
}

/** Whether two bounds overlap (for frustum boxes and culling tests). */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}
