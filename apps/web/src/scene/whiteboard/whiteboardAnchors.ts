/**
 * Where whiteboards hang and which one the player can reach (#45, SPEC §9.2
 * "E interacts with the nearest interactable"). Pure. A generated room gets
 * its board from its `whiteboard` wall anchor (room-layout); the lobby's
 * comes from its dressing (compound/special.ts).
 */
import {
  anchorStandPose,
  type RoomTemplate,
  type Wall,
  type WallAnchor,
  wallById,
} from "@regulus/room-layout";

/** How far from a board's stand point `E` still reaches it, metres. */
export const WHITEBOARD_REACH = 1.6;

export interface WhiteboardAnchor {
  anchor: WallAnchor;
  wall: Wall;
  stand: { x: number; z: number };
}

export function whiteboardAnchors(template: RoomTemplate): WhiteboardAnchor[] {
  const out: WhiteboardAnchor[] = [];
  for (const anchor of template.wallAnchors) {
    if (anchor.kind !== "whiteboard") continue;
    const wall = wallById(template, anchor.wallId);
    if (wall) out.push({ anchor, wall, stand: anchorStandPose(wall, anchor) });
  }
  return out;
}

/** The item whose stand point is nearest `at`, within `radius`; null if none. */
export function nearestInReach<T extends { stand: { x: number; z: number } }>(
  items: readonly T[],
  at: { x: number; z: number },
  radius = WHITEBOARD_REACH,
): T | null {
  let best: T | null = null;
  let bestD = radius * radius;
  for (const item of items) {
    const d = (item.stand.x - at.x) ** 2 + (item.stand.z - at.z) ** 2;
    if (d <= bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}
