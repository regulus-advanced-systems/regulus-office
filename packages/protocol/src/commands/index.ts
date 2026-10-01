/**
 * Client→server command union (SPEC §6). Commands travel as Colyseus
 * messages: `room.send(type, payload)`; the server rebuilds `{ type, ...payload }`
 * and validates it with `parseClientCommand`.
 */
import { z } from "zod";
import { agentCommands } from "./agent.ts";
import { lobbyCommands } from "./lobby.ts";
import { operationCommands } from "./operation.ts";
import { presenceCommands } from "./presence.ts";

export * from "./agent.ts";
export * from "./lobby.ts";
export * from "./operation.ts";
export * from "./presence.ts";

export const ClientCommand = z.discriminatedUnion("type", [
  ...presenceCommands,
  ...agentCommands,
  ...operationCommands,
  ...lobbyCommands,
]);
export type ClientCommand = z.infer<typeof ClientCommand>;
export type ClientCommandType = ClientCommand["type"];

/** Every command type, in the order listed in SPEC §6. */
export const CLIENT_COMMAND_TYPES = ClientCommand.options.map(
  (option) => option.shape.type.value,
) as ClientCommandType[];

/** Payload of one command type, without the `type` discriminant. */
export type ClientCommandPayload<T extends ClientCommandType> = Omit<
  Extract<ClientCommand, { type: T }>,
  "type"
>;

/** Validate `{ type, ...payload }`; use for a Colyseus `onMessage(type, payload)` handler. */
export function parseClientCommand(type: string, payload: unknown) {
  const input = payload !== null && typeof payload === "object" ? { ...payload, type } : { type };
  return ClientCommand.safeParse(input);
}

export function isClientCommandType(type: unknown): type is ClientCommandType {
  return typeof type === "string" && (CLIENT_COMMAND_TYPES as string[]).includes(type);
}
