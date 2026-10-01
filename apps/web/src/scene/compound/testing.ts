/**
 * Small compounds for tests (#186): a published `BuildingState` slice built
 * by the real layout code (#181) and the client world made from it.
 */

import {
  DEFAULT_ROOM_SETTINGS,
  type DecorStyle,
  LOBBY_OPERATION_ID,
  type OperationSummary,
  type RoomPlacement,
  UNPLACED_ROOM,
} from "@regulus/protocol";
import {
  compoundStateOf,
  computeCompoundLayout,
  defaultCompoundSpec,
  roomSummaryPlacement,
} from "@regulus/room-layout";
import { type CompoundWorld, compoundWorld } from "./world.ts";

export interface TestRoom {
  id: string;
  name?: string;
  placement: RoomPlacement;
  deskCount?: number;
  decorStyle?: DecorStyle;
  building?: boolean;
  working?: number;
  waiting?: number;
}

export function testState(rooms: readonly TestRoom[], size = 48) {
  const spec = defaultCompoundSpec(size);
  const layout = computeCompoundLayout(
    spec,
    rooms.map((r) => ({ id: r.id, placement: r.placement })),
  );
  const operations: Record<string, OperationSummary> = {
    [LOBBY_OPERATION_ID]: {
      operationId: LOBBY_OPERATION_ID,
      name: "Lobby",
      slug: "lobby",
      index: 0,
      paletteId: "teal-cream",
      henchmenWorking: 0,
      henchmenWaiting: 0,
      henchmenTotal: 0,
      humansPresent: 0,
      ...UNPLACED_ROOM,
      ...DEFAULT_ROOM_SETTINGS,
      deskCount: 0,
    },
  };
  rooms.forEach((r, i) => {
    const laid = layout.rooms.find((l) => l.id === r.id);
    operations[r.id] = {
      operationId: r.id,
      name: r.name ?? r.id,
      slug: r.id,
      index: i + 1,
      paletteId: "oak-sky",
      henchmenWorking: r.working ?? 0,
      henchmenWaiting: r.waiting ?? 0,
      henchmenTotal: (r.working ?? 0) + (r.waiting ?? 0),
      humansPresent: 0,
      ...UNPLACED_ROOM,
      ...(laid ? roomSummaryPlacement(laid) : {}),
      buildState: r.building ? "building" : "ready",
      deskCount: r.deskCount ?? 1,
      decorStyle: r.decorStyle ?? "ops_room",
    };
  });
  return { compound: compoundStateOf(layout), operations };
}

/** The client world of a test compound; `enterable` defaults to every room. */
export function testWorld(
  rooms: readonly TestRoom[],
  enterable?: readonly string[],
  size = 48,
): CompoundWorld {
  const world = compoundWorld(testState(rooms, size), new Set(enterable ?? rooms.map((r) => r.id)));
  if (!world) throw new Error("no world");
  return world;
}

/** A placement in the first row north of the main corridor of a 48-tile compound, door south. */
export function rowPlacement(x: number, w = 8, d = 8): RoomPlacement {
  return { gridX: x, gridY: 36 - d, width: w, depth: d, doorSide: "south" };
}
