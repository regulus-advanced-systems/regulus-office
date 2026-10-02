/**
 * Decor in the OperationRoom state (SPEC §6 channel 2, §9.4; #46): the
 * operation's wall pictures, published by the pictures service
 * (pictures/service.ts), and the `decor.*` commands the room hands to it.
 * Keyed by decor id; only changed fields are written.
 */
import {
  type ClientCommand,
  COMMAND_REJECTED_MESSAGE,
  DecorState,
  DecorStateSchema,
  type UserRole,
} from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import type { RoomClient } from "../transport.ts";
import { rejection } from "./agent-commands.ts";
import type { OperationRoomState } from "./state.ts";

type DecorSchema = InstanceType<typeof DecorStateSchema>;

export type DecorCommand = Extract<
  ClientCommand,
  { type: "decor.place" | "decor.move" | "decor.remove" }
>;

export function isDecorCommand(command: ClientCommand): command is DecorCommand {
  return (
    command.type === "decor.place" ||
    command.type === "decor.move" ||
    command.type === "decor.remove"
  );
}

/** `decor.*` for an operation (implemented by pictures/service.ts). */
export interface OperationDecorCommands {
  run(
    actor: { id: string; role: UserRole },
    operationId: string,
    command: DecorCommand,
  ): Promise<{ ok: true; decorId: string } | { ok: false; reason: string }>;
}

/** Hand a `decor.*` command to the pictures; a refusal goes back as `command.rejected`. */
export function runDecorCommand(
  commands: OperationDecorCommands | undefined,
  operationId: string,
  client: RoomClient,
  command: DecorCommand,
  logger: Logger,
): void {
  const reject = (reason: string) =>
    client.send(COMMAND_REJECTED_MESSAGE, rejection(command.type, reason));
  if (!commands) return reject("wall pictures are not available");
  const actor = { id: client.user.userId, role: client.user.role };
  commands
    .run(actor, operationId, command)
    .then((outcome) => {
      if (!outcome.ok) reject(outcome.reason);
    })
    .catch((err) => {
      logger.error({ err }, `${command.type} failed`);
      reject("internal error");
    });
}

/** Validate an operation's decor against the protocol shape (throws on a bad one). */
export function parseDecor(decor: readonly DecorState[]): DecorState[] {
  return decor.map((d) => DecorState.parse(d));
}

function writeDecor(target: DecorSchema, d: DecorState): DecorSchema {
  if (target.id !== d.id) target.id = d.id;
  if (target.kind !== d.kind) target.kind = d.kind;
  if (target.wallId !== d.wallId) target.wallId = d.wallId;
  if (target.x !== d.x) target.x = d.x;
  if (target.y !== d.y) target.y = d.y;
  if (target.w !== d.w) target.w = d.w;
  if (target.h !== d.h) target.h = d.h;
  if (target.imageUrl !== d.imageUrl) target.imageUrl = d.imageUrl;
  if (target.placedBy !== d.placedBy) target.placedBy = d.placedBy;
  return target;
}

/** Make `state.decor` equal `decor`. */
export function syncDecor(state: OperationRoomState, decor: readonly DecorState[]): void {
  const next = new Map(decor.map((d) => [d.id, d]));
  for (const key of [...state.decor.keys()]) if (!next.has(key)) state.decor.delete(key);
  for (const [key, d] of next) {
    const existing = state.decor.get(key);
    if (existing) writeDecor(existing, d);
    else state.decor.set(key, writeDecor(new DecorStateSchema(), d));
  }
}
