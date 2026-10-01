/**
 * A generated room's shell (#182): four walls, the door and the spawn point.
 *
 * The door sits where the compound puts it (#181, `doorStart`): two tiles
 * wide, tile-aligned and centred on its side, so the room's opening matches
 * the corridor outside. Its full-height frame (`door`) splits that side's
 * wall in two (`<side>` and `<side>-2`); the painted room name goes on the
 * part before the door, so visitors read it beside the closed door.
 *
 * Cutaway walls: the wall facing the door and its counter-clockwise
 * neighbour are full height and carry the board wall; the door's wall and the
 * other one are low stubs. Entering, you face the boards. The FloorTemplate
 * `elevator` record describes the door: its frame wall, a threshold strip
 * inside it and the pose just inside, which is also the spawn point.
 */
import { DOOR_WIDTH_TILES, type DoorSide } from "@regulus/protocol";
import type { Pose } from "../geometry.ts";
import { HEADING } from "../geometry.ts";
import type { Elevator, Wall } from "../types.ts";
import { DOOR_APPROACH, TILE } from "./constants.ts";

export const DOOR_WALL_ID = "door";

const OPPOSITE: Readonly<Record<DoorSide, DoorSide>> = {
  north: "south",
  south: "north",
  west: "east",
  east: "west",
};

/** Counter-clockwise neighbour, seen from above (north up). */
const COUNTER_CLOCKWISE: Readonly<Record<DoorSide, DoorSide>> = {
  north: "west",
  west: "south",
  south: "east",
  east: "north",
};

/**
 * The two full walls of a room with its door on `doorSide`: the one facing
 * the door, then its counter-clockwise neighbour (north and west for a door
 * on the south side, as the fixed floors had).
 */
export function fullSides(doorSide: DoorSide): [DoorSide, DoorSide] {
  const back = OPPOSITE[doorSide];
  return [back, COUNTER_CLOCKWISE[back]];
}

export interface Shell {
  walls: Wall[];
  elevator: Elevator;
  spawn: Pose;
  nameWallId: string;
  /** Where the door is along its side, metres from the side's west/north end. */
  door: { side: DoorSide; start: number; end: number; pose: Pose };
  /** The full walls, board wall first. */
  full: [DoorSide, DoorSide];
}

function sideLine(side: DoorSide, w: number, d: number) {
  switch (side) {
    case "north":
      return { from: { x: 0, z: 0 }, to: { x: w, z: 0 } };
    case "south":
      return { from: { x: 0, z: d }, to: { x: w, z: d } };
    case "west":
      return { from: { x: 0, z: 0 }, to: { x: 0, z: d } };
    case "east":
      return { from: { x: w, z: 0 }, to: { x: w, z: d } };
  }
}

/** Point `t` metres along a side from its north/west end. */
function along(side: DoorSide, w: number, d: number, t: number) {
  const { from } = sideLine(side, w, d);
  return side === "north" || side === "south" ? { x: t, z: from.z } : { x: from.x, z: t };
}

/** Door span `[start, end]` in metres along its side, as the compound places it. */
export function doorSpan(side: DoorSide, width: number, depth: number) {
  const tiles = Math.round((side === "north" || side === "south" ? width : depth) / TILE);
  const start = Math.floor((tiles - DOOR_WIDTH_TILES) / 2) * TILE;
  return { start, end: start + DOOR_WIDTH_TILES * TILE };
}

/** Walls, door and spawn of a `width` × `depth` metre room with its door on `doorSide`. */
export function roomShell(width: number, depth: number, doorSide: DoorSide): Shell {
  const full = fullSides(doorSide);
  const walls: Wall[] = [];
  const span = doorSpan(doorSide, width, depth);
  for (const side of ["north", "west", "south", "east"] as const) {
    const line = sideLine(side, width, depth);
    const height = full.includes(side) ? "full" : "stub";
    const facing = OPPOSITE[side];
    if (side !== doorSide) {
      walls.push({ id: side, ...line, height, facing, openings: [] });
      continue;
    }
    const a = along(side, width, depth, span.start);
    const b = along(side, width, depth, span.end);
    walls.push({ id: side, from: line.from, to: a, height, facing, openings: [] });
    walls.push({
      id: DOOR_WALL_ID,
      from: a,
      to: b,
      height: "full",
      facing,
      openings: [{ kind: "door", t: 0, w: span.end - span.start }],
    });
    walls.push({ id: `${side}-2`, from: b, to: line.to, height, facing, openings: [] });
  }

  // Just inside the door, on a nav cell centre (the door's centre is on a tile edge).
  const mid = (span.start + span.end) / 2 - 0.25;
  const pose: Pose =
    doorSide === "north"
      ? { x: mid, z: DOOR_APPROACH, heading: HEADING.south }
      : doorSide === "south"
        ? { x: mid, z: depth - DOOR_APPROACH, heading: HEADING.north }
        : doorSide === "west"
          ? { x: DOOR_APPROACH, z: mid, heading: HEADING.east }
          : { x: width - DOOR_APPROACH, z: mid, heading: HEADING.west };

  // Threshold strip just inside the frame; it blocks no more than the wall already does.
  const inset = 0.1;
  const len = span.end - span.start - 2 * inset;
  const rect =
    doorSide === "north"
      ? { x: span.start + inset, z: 0, w: len, d: 0.3 }
      : doorSide === "south"
        ? { x: span.start + inset, z: depth - 0.3, w: len, d: 0.3 }
        : doorSide === "west"
          ? { x: 0, z: span.start + inset, w: 0.3, d: len }
          : { x: width - 0.3, z: span.start + inset, w: 0.3, d: len };

  return {
    walls,
    elevator: { rect, wallId: DOOR_WALL_ID, door: pose },
    spawn: pose,
    nameWallId: doorSide,
    door: { side: doorSide, start: span.start, end: span.end, pose },
    full,
  };
}
