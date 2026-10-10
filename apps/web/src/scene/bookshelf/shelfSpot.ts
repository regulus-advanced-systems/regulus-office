/**
 * Where the room's docs bookshelf stands (#264): the obstacle the room
 * generator places with the id `DOCS_SHELF_ID` and a stand point. Pure.
 */
import { DOCS_SHELF_ID, type Rect, type RoomTemplate } from "@regulus/room-layout";

/** How far from its stand point `E` still reaches the shelf, metres. */
export const SHELF_REACH = 1;
/** Height of the kit's shelving, metres (the click target and the highlight). */
export const SHELF_HEIGHT = 1.8;

export interface ShelfSpot {
  rect: Rect;
  stand: { x: number; z: number };
}

export function shelfSpot(template: RoomTemplate): ShelfSpot | null {
  const shelf = template.obstacles.find((o) => o.id === DOCS_SHELF_ID);
  if (!shelf?.standAt) return null;
  return { rect: shelf.rect, stand: { x: shelf.standAt.x, z: shelf.standAt.z } };
}

export function shelfInReach(
  spot: ShelfSpot | null,
  at: { x: number; z: number },
  reach = SHELF_REACH,
): boolean {
  return spot !== null && Math.hypot(at.x - spot.stand.x, at.z - spot.stand.z) <= reach;
}
