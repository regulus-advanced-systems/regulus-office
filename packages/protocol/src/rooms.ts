/**
 * Room names, join options and server→client notices shared by the server
 * rooms and the web client's `net/` layer (SPEC §6 channels 1 and 2).
 */
import { z } from "zod";
import { Id } from "./common.ts";

/** Colyseus room names as registered on the server and joined by the client. */
export const ROOM_NAMES = { building: "building", operation: "operation" } as const;
export type RoomName = (typeof ROOM_NAMES)[keyof typeof ROOM_NAMES];

/**
 * Operation id of the lobby (SPEC §9.1: operation 0). The lobby is not an `operations`
 * row, so presence and `operation.go` refer to it by this constant.
 */
export const LOBBY_OPERATION_ID = "lobby";

/** Options sent with `client.joinOrCreate(ROOM_NAMES.operation, options)`. */
export const OperationJoinOptions = z.object({ operationId: Id });
export type OperationJoinOptions = z.infer<typeof OperationJoinOptions>;

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
  /** The henchman an `agent.*` command was about, so its panel can show the reason. */
  agentId: Id.optional(),
  /** Uncommitted files when `agent.pr` was refused over a dirty worktree. */
  files: z.array(z.string().max(1024)).max(500).optional(),
});
export type CommandRejected = z.infer<typeof CommandRejected>;
