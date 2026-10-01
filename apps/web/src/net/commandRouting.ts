/**
 * Which room each client command goes to (SPEC §6). Presence and lobby
 * commands (humans, chat, jukebox, screen share, PM) belong to the
 * BuildingRoom; agent and operation-object commands to the current OperationRoom.
 * Derived from the command groups exported by @regulus/protocol so a new
 * command cannot be added without a route.
 */
import {
  agentCommands,
  type ClientCommandType,
  lobbyCommands,
  operationCommands,
  presenceCommands,
} from "@regulus/protocol";

export type RoomKind = "building" | "operation";

function typesOf(group: ReadonlyArray<{ shape: { type: { value: string } } }>): string[] {
  return group.map((command) => command.shape.type.value);
}

const buildingTypes = new Set([...typesOf(presenceCommands), ...typesOf(lobbyCommands)]);
const operationTypes = new Set([...typesOf(agentCommands), ...typesOf(operationCommands)]);

export function roomForCommand(type: ClientCommandType): RoomKind {
  if (buildingTypes.has(type)) return "building";
  if (operationTypes.has(type)) return "operation";
  throw new Error(`No room route for command "${type}"`);
}
