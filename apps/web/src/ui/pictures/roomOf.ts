/** The generated interior of an operation's room in the compound (#46), for the HUD. */
import type { RoomLayout } from "@regulus/room-layout";
import { roomLayout } from "../../scene/compound/layouts.ts";
import { useCompoundStore } from "../../state/compound.ts";

export function roomLayoutOf(operationId: string): RoomLayout | null {
  const room = useCompoundStore
    .getState()
    .world?.rooms.find((r) => r.id === operationId && r.kind === "project");
  return room ? roomLayout(room) : null;
}
