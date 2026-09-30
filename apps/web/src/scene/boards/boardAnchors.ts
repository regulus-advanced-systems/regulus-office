/**
 * Which wall anchors carry boards and which one the player can reach (SPEC
 * §9.2 `E` interacts with the nearest interactable; #36). Pure. Boards come
 * from the layout's data-driven anchors (`issue_board`, `pr_board`), so a
 * room generated for the compound (#182/#186) gets its boards by listing
 * those anchors, wherever they hang.
 */
import {
  anchorStandPose,
  type FloorTemplate,
  type Wall,
  type WallAnchor,
  wallById,
} from "@regulus/floor-layout";
import type { CardKind } from "@regulus/protocol";

export const BOARD_ANCHOR_KINDS: Readonly<Record<string, CardKind>> = {
  issue_board: "issue",
  pr_board: "pr",
};

/** How far from an anchor's stand point `E` still reaches it, metres. */
export const BOARD_INTERACT_RADIUS = 1.4;

export interface BoardAnchor {
  anchor: WallAnchor;
  wall: Wall;
  kind: CardKind;
  stand: { x: number; z: number };
}

export function boardAnchors(template: FloorTemplate): BoardAnchor[] {
  const out: BoardAnchor[] = [];
  for (const anchor of template.wallAnchors) {
    const kind = BOARD_ANCHOR_KINDS[anchor.kind];
    const wall = kind ? wallById(template, anchor.wallId) : undefined;
    if (!kind || !wall) continue;
    out.push({ anchor, wall, kind, stand: anchorStandPose(wall, anchor) });
  }
  return out;
}

/** The board whose stand point is nearest `at`, within `radius`; null if none. */
export function boardInReach(
  boards: readonly BoardAnchor[],
  at: { x: number; z: number },
  radius = BOARD_INTERACT_RADIUS,
): BoardAnchor | null {
  let best: BoardAnchor | null = null;
  let bestD = radius * radius;
  for (const b of boards) {
    const d = (b.stand.x - at.x) ** 2 + (b.stand.z - at.z) ** 2;
    if (d <= bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}
