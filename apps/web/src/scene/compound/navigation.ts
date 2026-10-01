/**
 * Walking the compound (SPEC §9.1, §9.2; #186): one nav grid over the whole
 * compound from the published layout (#181 `buildCompoundNavGrid`) with
 * every room's furniture as obstacles. Doors of rooms this viewer may not
 * enter, and of rooms still being built, stay shut. Room walls stand just
 * outside each room's footprint (the lair kit's walls are 0.36 m thick), so
 * a thin band outside each wall is blocked too, except at the doorway.
 * Built once per layout, access and furniture change.
 */
import {
  buildCompoundNavGrid,
  type CompoundNavInput,
  HEADING,
  type NavGrid,
  type Pose,
  type Rect,
} from "@regulus/floor-layout";
import { DOOR_WIDTH_TILES } from "@regulus/protocol";
import { WALL_THICKNESS } from "../lair/dimensions.ts";
import { type RoomArt, roomArt } from "./interiors.ts";
import { type CompoundWorld, isOpenRoom, lobbyOf, roomCentre, type WorldRoom } from "./world.ts";

/** Fine cells, like the old floor grids (#15), while the grid stays small enough. */
export const FINE_CELL = 0.25;
export const COARSE_CELL = 0.5;
const MAX_FINE_CELLS = 1_200_000;

export function cellSizeFor(world: CompoundWorld): number {
  const w = world.width * world.tileMetres;
  const d = (world.depth + world.outsideDepth) * world.tileMetres;
  return (w / FINE_CELL) * (d / FINE_CELL) <= MAX_FINE_CELLS ? FINE_CELL : COARSE_CELL;
}

export function navInput(world: CompoundWorld): CompoundNavInput {
  return {
    width: world.width,
    depth: world.depth,
    outsideDepth: world.outsideDepth,
    rooms: world.rooms.map((r) => ({ id: r.id, rect: r.rect, doorSide: r.doorSide, door: r.door })),
    corridors: world.corridors,
    blastDoor: world.blastDoor,
  };
}

/** Furniture of a room, compound metres. */
export function roomObstacles(room: WorldRoom, art: RoomArt = roomArt(room)): Rect[] {
  return art.obstacles.map((o) => ({
    x: o.x + room.origin.x,
    z: o.z + room.origin.z,
    w: o.w,
    d: o.d,
  }));
}

/** Bands just outside a room's walls (where the wall meshes stand), the doorway left open. */
export function wallBands(room: WorldRoom, tileMetres: number): Rect[] {
  const t = WALL_THICKNESS;
  const { x, z } = room.origin;
  const { w, d } = room.size;
  const door = {
    x: room.door.x * tileMetres,
    z: room.door.y * tileMetres,
    span: DOOR_WIDTH_TILES * tileMetres,
  };
  const out: Rect[] = [];
  const run = (side: "north" | "south" | "east" | "west", band: Rect) => {
    if (side !== room.doorSide) {
      out.push(band);
      return;
    }
    if (side === "north" || side === "south") {
      out.push({ ...band, w: door.x - band.x });
      out.push({ ...band, x: door.x + door.span, w: band.x + band.w - (door.x + door.span) });
    } else {
      out.push({ ...band, d: door.z - band.z });
      out.push({ ...band, z: door.z + door.span, d: band.z + band.d - (door.z + door.span) });
    }
  };
  run("north", { x: x - t, z: z - t, w: w + 2 * t, d: t });
  run("south", { x: x - t, z: z + d, w: w + 2 * t, d: t });
  run("west", { x: x - t, z: z - t, w: t, d: d + 2 * t });
  run("east", { x: x + w, z: z - t, w: t, d: d + 2 * t });
  return out.filter((r) => r.w > 0 && r.d > 0);
}

/** Rooms whose door stays shut for this viewer. */
export function closedDoors(world: CompoundWorld): Set<string> {
  return new Set(world.rooms.filter((r) => !isOpenRoom(r)).map((r) => r.id));
}

/** Everything that decides the grid; the grid is rebuilt only when this changes. */
export function navKey(world: CompoundWorld): string {
  return [
    world.version,
    ...world.rooms.map((r) =>
      [r.id, r.enterable ? 1 : 0, r.buildState, r.deskCount, r.decorStyle].join(":"),
    ),
  ].join("|");
}

export function compoundNavGrid(world: CompoundWorld): NavGrid {
  const obstacles: Rect[] = [];
  for (const room of world.rooms) {
    obstacles.push(...roomObstacles(room));
    obstacles.push(...wallBands(room, world.tileMetres));
  }
  return buildCompoundNavGrid(navInput(world), {
    cellSize: cellSizeFor(world),
    closedDoors: closedDoors(world),
    obstacles,
  });
}

/** Where a new player appears: the middle of the lobby, facing its door to the corridors. */
export function lobbySpawn(world: CompoundWorld): Pose {
  const lobby = lobbyOf(world);
  if (!lobby) return { x: 0, z: 0, heading: 0 };
  const c = roomCentre(lobby);
  return { x: c.x, z: c.z, heading: HEADING[lobby.doorSide] };
}
