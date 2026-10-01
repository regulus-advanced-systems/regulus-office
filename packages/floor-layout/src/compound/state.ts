/**
 * The compound layout as published in the BuildingRoom (protocol
 * `CompoundState`, plus the placement fields of each `FloorSummary`), and
 * back again for the client's nav grid.
 */
import {
  COMPOUND_TILE_METRES,
  type CompoundState,
  type FloorSummary,
  type SpecialRoomState,
} from "@regulus/protocol";
import type { CompoundLayout, LaidOutRoom } from "./layout.ts";
import type { CompoundNavInput } from "./nav.ts";

/** FNV-1a over a string: a stable 32-bit layout version. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function specialState(room: LaidOutRoom): SpecialRoomState {
  return {
    kind: room.kind ?? "lobby",
    gridX: room.rect.x,
    gridY: room.rect.y,
    width: room.rect.w,
    depth: room.rect.d,
    doorSide: room.doorSide,
    doorX: room.door.x,
    doorY: room.door.y,
  };
}

/**
 * The published layout. `version` hashes everything else including the
 * project rooms' placements, so it changes whenever any of it does.
 */
export function compoundStateOf(layout: CompoundLayout): CompoundState {
  const body: Omit<CompoundState, "version"> = {
    width: layout.width,
    depth: layout.depth,
    tileMetres: COMPOUND_TILE_METRES,
    outsideDepth: layout.outsideDepth,
    specialRooms: layout.specialRooms.map(specialState),
    corridors: layout.corridors.map((c) => ({ x: c.x, y: c.y, w: c.w, d: c.d })),
    blastDoorX: layout.blastDoor.x,
    blastDoorY: layout.blastDoor.y,
    blastDoorWidth: layout.blastDoor.width,
  };
  const rooms = layout.rooms.map((r) => [r.id, r.rect, r.doorSide]);
  return { ...body, version: fnv1a(JSON.stringify([body, rooms])) };
}

/** The placement fields of a project room's summary (`gridX` .. `doorY`). */
export function roomSummaryPlacement(
  room: LaidOutRoom,
): Pick<FloorSummary, "gridX" | "gridY" | "width" | "depth" | "doorSide" | "doorX" | "doorY"> {
  return {
    gridX: room.rect.x,
    gridY: room.rect.y,
    width: room.rect.w,
    depth: room.rect.d,
    doorSide: room.doorSide,
    doorX: room.door.x,
    doorY: room.door.y,
  };
}

/**
 * Nav input from the BuildingRoom state: the special rooms, the placed
 * project rooms (`gridX >= 0`) and the corridors. The lobby's summary is
 * skipped; it is the `lobby` special room.
 */
export function compoundNavInputFromState(
  compound: CompoundState,
  floors: Iterable<FloorSummary>,
  lobbyFloorId = "lobby",
): CompoundNavInput {
  const rooms: Array<CompoundNavInput["rooms"][number]> = compound.specialRooms.map((s) => ({
    id: s.kind,
    rect: { x: s.gridX, y: s.gridY, w: s.width, d: s.depth },
    doorSide: s.doorSide,
    door: { x: s.doorX, y: s.doorY },
  }));
  for (const f of floors) {
    if (f.floorId === lobbyFloorId || f.gridX < 0 || f.gridY < 0) continue;
    rooms.push({
      id: f.floorId,
      rect: { x: f.gridX, y: f.gridY, w: f.width, d: f.depth },
      doorSide: f.doorSide,
      door: { x: f.doorX, y: f.doorY },
    });
  }
  return {
    width: compound.width,
    depth: compound.depth,
    outsideDepth: compound.outsideDepth,
    rooms,
    corridors: compound.corridors,
    blastDoor: { x: compound.blastDoorX, y: compound.blastDoorY, width: compound.blastDoorWidth },
  };
}

/** Nav input straight from a computed layout. */
export function compoundNavInput(layout: CompoundLayout): CompoundNavInput {
  return {
    width: layout.width,
    depth: layout.depth,
    outsideDepth: layout.outsideDepth,
    rooms: [...layout.specialRooms, ...layout.rooms],
    corridors: layout.corridors,
    blastDoor: layout.blastDoor,
  };
}
