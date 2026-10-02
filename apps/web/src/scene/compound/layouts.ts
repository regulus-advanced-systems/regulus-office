/**
 * A project room's generated interior (#182) from its published size, door
 * and settings, cached per setting (`projectRoomLayout`, shared with the
 * server's seat check, #49). Pure (no three.js), so the HUD's quick travel
 * and search jumps can use it without pulling in the scene.
 */
import { projectRoomLayout, type RoomLayout } from "@regulus/room-layout";
import type { WorldRoom } from "./world.ts";

/** The generated interior of a project room, or null when its settings cannot be generated. */
export function roomLayout(room: WorldRoom): RoomLayout | null {
  return projectRoomLayout({
    width: room.rect.w,
    depth: room.rect.d,
    doorSide: room.doorSide,
    deskCount: room.deskCount,
    decorStyle: room.decorStyle,
  });
}
