/**
 * Room wiring for the office server: builds the transport, defines the
 * BuildingRoom on top of the database, and hands back what boot needs.
 * and the OperationRoom (SPEC §6 channel 2, one instance per operation).
 */
import { ROOM_NAMES } from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import type { LiveAccess } from "../auth/live-access.ts";
import { originPolicyFor } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import type { JukeboxPlayer } from "../jukebox/player.ts";
import type { Logger } from "../logging.ts";
import { lairViewFor } from "../operations/access.ts";
import type { RoomAuth } from "./auth.ts";
import { DrizzleOperationSource } from "./building/operations.ts";
import { DrizzlePlaceStore, type PlaceStore } from "./building/place-store.ts";
import { type BuildingRoom, createBuildingRoom } from "./building/room.ts";
import { createScreenShareRules } from "./building/screen-share.ts";
import { DrizzleChatStore } from "./chat/store.ts";
import { ColyseusRoomTransport } from "./colyseus/transport.ts";
import { createOperationRooms, type OperationRooms } from "./operation/room.ts";
import { DrizzleOperationRoomSource } from "./operation/source.ts";
import type { RoomTransport } from "./transport.ts";

export type { RoomAuth, RoomAuthUser } from "./auth.ts";
export {
  composeRoomAuth,
  createDevHeaderAuth,
  createSessionRoomAuth,
  DEV_USER_HEADER,
  denyAllAuth,
} from "./auth.ts";
export { OPERATION_CLOSED_CODE, type OperationRooms } from "./operation/room.ts";
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
  /** Ends room seats on lost access, sign-out and role change (#244). */
  liveAccess?: LiveAccess;
  /** How long the blast door stays open after a press, ms (default 60 s, #188). */
  blastDoorMs?: number;
  /** The lobby jukebox the building room runs (#47). */
  jukebox?: JukeboxPlayer;
  /** LiveKit is configured (#48): the lounge TV may be shared. */
  mediaEnabled?: boolean;
  /**
   * Where each person last stood (#262); the database by default. `null`:
   * nobody is remembered and everyone arrives at the lobby spawn.
   */
  places?: PlaceStore | null;
}

export interface Rooms {
  transport: RoomTransport;
  building: BuildingRoom;
  /** OperationRoom registry: `publishHenchman` / `removeHenchman` for the AgentManager (#26). */
  operations: OperationRooms;
  /** Re-read operations and henchman counters into the building room (call after operation/agent changes). */
  refreshOperations(): Promise<void>;
  /** An operation changed (created, archived, repo cloned): refresh the building list and its room. */
  operationChanged(operationId: string): Promise<void>;
}

export function createRooms(options: RoomsOptions): Rooms {
  const { db, logger, auth, publicUrl, production, blastDoorMs, jukebox, mediaEnabled } = options;
  const transport = new ColyseusRoomTransport({
    auth,
    logger,
    originPolicy: originPolicyFor(publicUrl, production),
    liveAccess: options.liveAccess,
  });
  const operationSource = new DrizzleOperationRoomSource(db);
  const building = createBuildingRoom({
    chat: new DrizzleChatStore(db),
    operations: new DrizzleOperationSource(db),
    logger: logger.child({ room: ROOM_NAMES.building }),
    // The one gate (operations/access.ts): what each person may see of the lair.
    lairView: (user) => lairViewFor(db, { id: user.userId, role: user.role }),
    places: options.places === null ? undefined : (options.places ?? new DrizzlePlaceStore(db)),
    jukebox,
    screenShare: createScreenShareRules({
      enabled: mediaEnabled ?? false,
      audit: (takedown) => {
        try {
          writeAudit(db, {
            userId: takedown.byUserId,
            action: AUDIT_ACTIONS.mediaScreenShareStop,
            targetKind: "user",
            targetId: takedown.userId,
            meta: { sessionId: takedown.sessionId },
          });
        } catch (err) {
          logger.error({ err }, "screen share audit failed");
        }
      },
    }),
    blastDoor: {
      openMs: blastDoorMs,
      audit: (press) => {
        try {
          writeAudit(db, {
            userId: press.userId,
            action: AUDIT_ACTIONS.compoundBlastDoorOpen,
            targetKind: "compound",
            targetId: "blast_door",
            meta: { side: press.side, held: press.held },
          });
        } catch (err) {
          logger.error({ err }, "blast door audit failed");
        }
      },
    },
  });
  const operations = createOperationRooms({
    source: operationSource,
    logger: logger.child({ room: ROOM_NAMES.operation }),
  });
  transport.defineRoom(ROOM_NAMES.building, building);
  transport.defineRoom(ROOM_NAMES.operation, operations.definition);
  return {
    transport,
    building,
    operations,
    refreshOperations: () => building.refreshOperations(),
    async operationChanged(operationId) {
      operations.refreshOperation(operationId);
      await building.refreshOperations();
    },
  };
}
