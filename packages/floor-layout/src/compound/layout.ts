/**
 * The whole compound from its spec and the project rooms' placements:
 * special rooms, doors, routed corridors and the blast door. Pure and
 * deterministic; the server publishes it and the client walks it.
 */
import type { DoorSide, RoomPlacement, SpecialRoomKind, TileRect } from "@regulus/protocol";
import { OUTSIDE_STRIP_TILES } from "@regulus/protocol";
import { doorFront, doorStart, placementRect, type TilePoint, tilesToRects } from "./grid.ts";
import { type CorridorNetwork, type RouteRoom, routeCorridors } from "./routing.ts";
import { blastDoor, type CompoundSpec, mainCorridor, specialRooms } from "./special.ts";

/** A project room as the compound sees it: its floor id and placement. */
export interface CompoundRoomInput {
  readonly id: string;
  readonly placement: RoomPlacement;
}

/** A room with its door, special or project. Special rooms use their kind as id. */
export interface LaidOutRoom {
  readonly id: string;
  /** Set for the lobby, conference room and break room. */
  readonly kind?: SpecialRoomKind;
  readonly rect: TileRect;
  readonly doorSide: DoorSide;
  /** Grid point where the door segment starts (see protocol compound.ts). */
  readonly door: TilePoint;
}

export interface CompoundLayout {
  readonly spec: CompoundSpec;
  readonly width: number;
  readonly depth: number;
  readonly outsideDepth: number;
  readonly specialRooms: readonly LaidOutRoom[];
  /** Project rooms, sorted by id. */
  readonly rooms: readonly LaidOutRoom[];
  readonly mainCorridor: TileRect;
  readonly network: CorridorNetwork;
  /** Corridor tiles (main corridor included) as disjoint rectangles. */
  readonly corridors: readonly TileRect[];
  readonly blastDoor: { readonly x: number; readonly y: number; readonly width: number };
  /** Rooms with no corridor to the lobby (never set for a layout the server accepted). */
  readonly unreachable: readonly string[];
}

export function laidOut(id: string, rect: TileRect, doorSide: DoorSide): LaidOutRoom {
  return { id, rect, doorSide, door: doorStart(rect, doorSide) };
}

export function computeCompoundLayout(
  spec: CompoundSpec,
  rooms: readonly CompoundRoomInput[],
): CompoundLayout {
  const specials = specialRooms(spec).map((s) => ({
    ...laidOut(s.kind, s.rect, s.doorSide),
    kind: s.kind,
  }));
  const projects = [...rooms]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => laidOut(r.id, placementRect(r.placement), r.placement.doorSide));
  const lobby = specials[0] as LaidOutRoom;
  const root = mainCorridor(spec);
  const routeRooms: RouteRoom[] = [
    ...specials.map((s) => ({ id: s.id, rect: s.rect, doorSide: s.doorSide, special: true })),
    ...projects.map((p) => ({ id: p.id, rect: p.rect, doorSide: p.doorSide })),
  ];
  const lobbyDoor = doorFront(lobby.rect, lobby.doorSide);
  const network = routeCorridors(spec.width, spec.depth, routeRooms, root, lobbyDoor);
  return {
    spec,
    width: spec.width,
    depth: spec.depth,
    outsideDepth: OUTSIDE_STRIP_TILES,
    specialRooms: specials,
    rooms: projects,
    mainCorridor: root,
    network,
    corridors: tilesToRects(network.tiles, spec.width, spec.depth),
    blastDoor: blastDoor(spec),
    unreachable: network.unreachable,
  };
}
