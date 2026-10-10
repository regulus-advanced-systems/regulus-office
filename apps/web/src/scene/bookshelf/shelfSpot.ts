/**
 * Where the room's docs bookshelf stands and when `E` is its (#264): the
 * obstacle the room generator places with the id `DOCS_SHELF_ID` and a
 * stand point. Pure.
 *
 * Whose `E` it is (SPEC §9.2 "the nearest interactable"): the shelf's
 * within `SHELF_REACH` of its stand point, unless a desk seat is nearer to
 * the player than that stand point is. Desks answer `E` up to 2.2 m from a
 * seat, and in a small room a seat is 2 m from the shelf, so reach alone
 * would let both answer. Boards, the clipboard and the gong need no rule:
 * the generator keeps their stand points `SHELF_CLEARANCE` (2.5 m) away,
 * more than their reach (1.4 m) and the shelf's together.
 */
import { DOCS_SHELF_ID, type Rect, type RoomTemplate } from "@regulus/room-layout";

/** How far from its stand point `E` still reaches the shelf, metres. */
export const SHELF_REACH = 1;
/** Height of the kit's shelving, metres (the click target and the highlight). */
export const SHELF_HEIGHT = 1.8;

type Point = { x: number; z: number };

export interface ShelfSpot {
  rect: Rect;
  stand: Point;
  /** Desk seats of the room: the other things `E` could mean nearby. */
  desks: readonly Point[];
}

export function shelfSpot(template: RoomTemplate): ShelfSpot | null {
  const shelf = template.obstacles.find((o) => o.id === DOCS_SHELF_ID);
  if (!shelf?.standAt) return null;
  return {
    rect: shelf.rect,
    stand: { x: shelf.standAt.x, z: shelf.standAt.z },
    desks: template.seats
      .filter((s) => s.kind === "desk")
      .map((s) => ({ x: s.pose.x, z: s.pose.z })),
  };
}

/** True when `E` pressed at `at` is the shelf's. */
export function shelfTakesE(spot: ShelfSpot | null, at: Point, reach = SHELF_REACH): boolean {
  if (!spot) return false;
  const away = Math.hypot(at.x - spot.stand.x, at.z - spot.stand.z);
  if (away > reach) return false;
  return spot.desks.every((desk) => Math.hypot(at.x - desk.x, at.z - desk.z) >= away);
}
