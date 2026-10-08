/**
 * `BuildingState.closedRooms` (SPEC D26; #270): one entry per project room
 * with its id, level and footprint only. Each viewer is shown the entries of
 * rooms they may not enter on levels they reach (viewers.ts); everyone else
 * never receives them. Nothing about the room's repo is in an entry: no
 * name, no counts, no settings, no build state.
 */
import {
  type BuildingStateSchema,
  ClosedRoomSchema,
  HOLDING_LEVEL_ID,
  LOBBY_OPERATION_ID,
  UNPLACED_ROOM,
} from "@regulus/protocol";
import type { CompoundSnapshot } from "../../compound/room-state.ts";
import type { OperationRecord } from "./operations.ts";

type ClosedRooms = InstanceType<typeof BuildingStateSchema>["closedRooms"];

const FOOTPRINT = ["gridX", "gridY", "width", "depth", "doorSide", "doorX", "doorY"] as const;

/** Mirror the project rooms into `closedRooms`, touching only what changed. */
export function applyClosedRooms(
  target: ClosedRooms,
  known: readonly OperationRecord[],
  compound: CompoundSnapshot | undefined,
): void {
  const seen = new Set<string>();
  for (const record of known) {
    if (record.operationId === LOBBY_OPERATION_ID) continue;
    seen.add(record.operationId);
    const existing = target.get(record.operationId);
    const entry = existing ?? new ClosedRoomSchema();
    const levelId = record.levelId ?? HOLDING_LEVEL_ID;
    if (entry.operationId !== record.operationId) entry.operationId = record.operationId;
    if (entry.levelId !== levelId) entry.levelId = levelId;
    const placement = compound?.rooms.get(record.operationId) ?? UNPLACED_ROOM;
    const fields = entry as unknown as Record<(typeof FOOTPRINT)[number], unknown>;
    for (const key of FOOTPRINT) if (fields[key] !== placement[key]) fields[key] = placement[key];
    if (!existing) target.set(record.operationId, entry);
  }
  for (const id of [...target.keys()]) if (!seen.has(id)) target.delete(id);
}
