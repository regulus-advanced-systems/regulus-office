/**
 * Room wiring for the office server: builds the transport, defines the
 * BuildingRoom on top of the database, and hands back what boot needs.
 * FloorRoom (SPEC §6 channel 2) is defined here in M1/M2.
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
import type { RoomTransport } from "./transport.ts";

export type { RoomAuth, RoomAuthUser } from "./auth.ts";
export {
  composeRoomAuth,
  createDevHeaderAuth,
  createSessionRoomAuth,
  DEV_USER_HEADER,
  denyAllAuth,
} from "./auth.ts";
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
  /** Re-read floors and robot counters into the building room (call after floor/agent changes). */
  refreshFloors(): Promise<void>;
}

export function createRooms(options: RoomsOptions): Rooms {
  const { db, logger, auth, publicUrl, production } = options;
  const transport = new ColyseusRoomTransport({
    auth,
    logger,
    originPolicy: originPolicyFor(publicUrl, production),
  });
  const building = createBuildingRoom({
    chat: new DrizzleChatStore(db),
    floors: new DrizzleFloorSource(db),
    logger: logger.child({ room: ROOM_NAMES.building }),
  });
  transport.defineRoom(ROOM_NAMES.building, building);
  return { transport, building, refreshFloors: () => building.refreshFloors() };
}
