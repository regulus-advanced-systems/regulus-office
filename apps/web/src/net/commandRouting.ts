/**
 * Which room each client command goes to (SPEC §6). Presence and lobby
 * commands (humans, chat, jukebox, screen share, PM) belong to the
 * BuildingRoom; agent and floor-object commands to the current FloorRoom.
 * Derived from the command groups exported by @regulus/protocol so a new
 * command cannot be added without a route.
 */
import {
  agentCommands,
  type ClientCommandType,
  floorCommands,
  lobbyCommands,
  presenceCommands,
} from "@regulus/protocol";

export type RoomKind = "building" | "floor";

function typesOf(group: ReadonlyArray<{ shape: { type: { value: string } } }>): string[] {
  return group.map((command) => command.shape.type.value);
}

const buildingTypes = new Set([...typesOf(presenceCommands), ...typesOf(lobbyCommands)]);
const floorTypes = new Set([...typesOf(agentCommands), ...typesOf(floorCommands)]);

export function roomForCommand(type: ClientCommandType): RoomKind {
  if (buildingTypes.has(type)) return "building";
  if (floorTypes.has(type)) return "floor";
  throw new Error(`No room route for command "${type}"`);
}
