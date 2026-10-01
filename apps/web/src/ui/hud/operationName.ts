/** Which room name the top bar shows (SPEC §9.1). */
import type { OperationSummary } from "@regulus/protocol";
import { type CompoundWorld, roomAt } from "../../scene/compound/world.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { usePlayerStore } from "../../state/player.ts";

export const LOBBY_NAME = "Lobby";

export function currentOperationName(
  operations: Readonly<Record<string, OperationSummary>> | null | undefined,
  operationId: string | null,
): string {
  if (!operationId) return LOBBY_NAME;
  const operation = operations?.[operationId];
  if (!operation) return "Room …";
  return operation.index === 0 ? LOBBY_NAME : operation.name;
}

/**
 * Where the player is in the compound (#186): the room under them (a
 * project room's name, or Lobby, War room, Break room), "Corridors" between
 * rooms and "Outside" on the beach; the lobby until the layout is known.
 */
export function locationName(
  world: CompoundWorld | null,
  at: { x: number; z: number } | null,
): string {
  if (!world || !at) return LOBBY_NAME;
  const room = roomAt(world, at.x, at.z);
  if (room) return room.name;
  return at.z >= world.depth * world.tileMetres ? "Outside" : "Corridors";
}

/** The location name, re-rendering only when it changes (not on every step). */
export function useLocationName(): string {
  const world = useCompoundStore((s) => s.world);
  return usePlayerStore((s) => locationName(world, s.spawned ? s : null));
}
