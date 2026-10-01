/**
 * A project room's generated interior (#182) from its published size, door
 * and settings, cached per setting. Pure (no three.js), so the HUD's quick
 * travel and search jumps can use it without pulling in the scene.
 */
import { generateRoom, maxDeskCount, type RoomLayout } from "@regulus/room-layout";
import type { WorldRoom } from "./world.ts";

const layouts = new Map<string, RoomLayout | null>();

/** The generated interior of a project room, or null when its settings cannot be generated. */
export function roomLayout(room: WorldRoom): RoomLayout | null {
  const desks = Math.min(Math.max(1, room.deskCount), maxDeskCount(room.rect.w, room.rect.d));
  const key = `${room.rect.w}x${room.rect.d}:${room.doorSide}:${desks}:${room.decorStyle}`;
  if (layouts.has(key)) return layouts.get(key) ?? null;
  let layout: RoomLayout | null = null;
  try {
    layout = generateRoom({
      width: room.rect.w,
      depth: room.rect.d,
      doorSide: room.doorSide,
      deskCount: desks,
      decorStyle: room.decorStyle,
    });
  } catch {
    layout = null;
  }
  layouts.set(key, layout);
  return layout;
}
