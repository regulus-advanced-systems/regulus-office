/**
 * Room wiring for the office server: builds the transport, defines the
 * BuildingRoom on top of the database, and hands back what boot needs.
 * and the FloorRoom (SPEC §6 channel 2, one instance per floor).
 */
import { ROOM_NAMES } from "@regulus/protocol";
import { originPolicyFor } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import type { Logger } from "../logging.ts";
import type { RoomAuth } from "./auth.ts";
import { DrizzleFloorSource } from "./building/floors.ts";
import { type BuildingRoom, createBuildingRoom } from "./building/room.ts";
import { DrizzleChatStore } from "./chat/store.ts";
import { ColyseusRoomTransport } from "./colyseus/transport.ts";
import { createFloorRooms, type FloorRooms } from "./floor/room.ts";
import { DrizzleFloorRoomSource } from "./floor/source.ts";
import type { RoomTransport } from "./transport.ts";

export type { RoomAuth, RoomAuthUser } from "./auth.ts";
export {
  composeRoomAuth,
  createDevHeaderAuth,
  createSessionRoomAuth,
  DEV_USER_HEADER,
  denyAllAuth,
} from "./auth.ts";
export { FLOOR_CLOSED_CODE, type FloorRooms } from "./floor/room.ts";
export type {
  HttpAttachment,
  RoomClient,
  RoomDefinition,
  RoomHandle,
  RoomTransport,
} from "./transport.ts";

export interface RoomsOptions {
  db: Db;
  logger: Logger;
  auth: RoomAuth;
  /** OFFICE_PUBLIC_URL; browsers may only connect from this origin (plus localhost in dev). */
  publicUrl: string;
  production: boolean;
}

export interface Rooms {
  transport: RoomTransport;
  building: BuildingRoom;
  /** FloorRoom registry: `publishRobot` / `removeRobot` for the AgentManager (#26). */
  floors: FloorRooms;
  /** Re-read floors and robot counters into the building room (call after floor/agent changes). */
  refreshFloors(): Promise<void>;
  /** A floor changed (created, archived, repo cloned): refresh the building list and its room. */
  floorChanged(floorId: string): Promise<void>;
}

export function createRooms(options: RoomsOptions): Rooms {
  const { db, logger, auth, publicUrl, production } = options;
  const transport = new ColyseusRoomTransport({
    auth,
    logger,
    originPolicy: originPolicyFor(publicUrl, production),
  });
  const floorSource = new DrizzleFloorRoomSource(db);
  const building = createBuildingRoom({
    chat: new DrizzleChatStore(db),
    floors: new DrizzleFloorSource(db),
    logger: logger.child({ room: ROOM_NAMES.building }),
    canVisit: (user, floorId) => floorSource.canEnter(user, floorId),
  });
  const floors = createFloorRooms({
    source: floorSource,
    logger: logger.child({ room: ROOM_NAMES.floor }),
  });
  transport.defineRoom(ROOM_NAMES.building, building);
  transport.defineRoom(ROOM_NAMES.floor, floors.definition);
  return {
    transport,
    building,
    floors,
    refreshFloors: () => building.refreshFloors(),
    async floorChanged(floorId) {
      floors.refreshFloor(floorId);
      await building.refreshFloors();
    },
  };
}
