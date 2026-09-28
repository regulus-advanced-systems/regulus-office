/**
 * Room names, join options and server→client notices shared by the server
 * rooms and the web client's `net/` layer (SPEC §6 channels 1 and 2).
 */
import { z } from "zod";
import { Id } from "./common.ts";

/** Colyseus room names as registered on the server and joined by the client. */
export const ROOM_NAMES = { building: "building", floor: "floor" } as const;
export type RoomName = (typeof ROOM_NAMES)[keyof typeof ROOM_NAMES];

/**
 * Floor id of the lobby (SPEC §9.1: floor 0). The lobby is not a `floors`
 * row, so presence and `floor.go` refer to it by this constant.
 */
export const LOBBY_FLOOR_ID = "lobby";

/** Options sent with `client.joinOrCreate(ROOM_NAMES.floor, options)`. */
export const FloorJoinOptions = z.object({ floorId: Id });
export type FloorJoinOptions = z.infer<typeof FloorJoinOptions>;

/** Options sent with `client.joinOrCreate(ROOM_NAMES.building, options)`; none yet. */
export const BuildingJoinOptions = z.object({}).loose();
export type BuildingJoinOptions = z.infer<typeof BuildingJoinOptions>;

/**
 * Server→client message sent when a command fails validation or authorisation.
 * The command itself is dropped; state is unchanged.
 */
export const COMMAND_REJECTED_MESSAGE = "command.rejected";
export const CommandRejected = z.object({
  /** The `type` of the command that was rejected. */
  type: z.string().max(64),
  reason: z.string().max(500),
});
export type CommandRejected = z.infer<typeof CommandRejected>;
