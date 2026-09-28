/** Which floor name the top bar shows (SPEC §9.1: lobby is floor 0). */
import type { FloorSummary } from "@regulus/protocol";

export const LOBBY_NAME = "Lobby";

export function currentFloorName(
  floors: Readonly<Record<string, FloorSummary>> | null | undefined,
  floorId: string | null,
): string {
  if (!floorId) return LOBBY_NAME;
  const floor = floors?.[floorId];
  if (!floor) return "Floor …";
  return floor.index === 0 ? LOBBY_NAME : floor.name;
}
