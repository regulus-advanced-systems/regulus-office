/**
 * Where the merge gong hangs (#43): on the room layout's data-driven `gong`
 * wall anchor, like the boards (#36), so a compound room (#182/#186) gets
 * its gong by listing that anchor wherever it wants it. Rooms without one
 * (the lobby) have no gong. Pure.
 */
import {
  anchorStandPose,
  type FloorTemplate,
  type Wall,
  type WallAnchor,
  wallById,
} from "@regulus/floor-layout";

/** How far from the gong's stand point `E` still bangs it, metres. */
export const GONG_INTERACT_RADIUS = 1.2;

export interface GongAnchor {
  anchor: WallAnchor;
  wall: Wall;
  stand: { x: number; z: number };
  /** A point just in front of the gong (confetti comes out here). */
  front: { x: number; z: number };
}

export function gongAnchors(template: FloorTemplate): GongAnchor[] {
  const out: GongAnchor[] = [];
  for (const anchor of template.wallAnchors) {
    if (anchor.kind !== "gong") continue;
    const wall = wallById(template, anchor.wallId);
    if (!wall) continue;
    const front = anchorStandPose(wall, { ...anchor, approach: 0.3 });
    out.push({
      anchor,
      wall,
      stand: anchorStandPose(wall, anchor),
      front: { x: front.x, z: front.z },
    });
  }
  return out;
}

/** The gong whose stand point is nearest `at`, within `radius`; null if none. */
export function gongInReach(
  gongs: readonly GongAnchor[],
  at: { x: number; z: number },
  radius = GONG_INTERACT_RADIUS,
): GongAnchor | null {
  let best: GongAnchor | null = null;
  let bestD = radius * radius;
  for (const g of gongs) {
    const d = (g.stand.x - at.x) ** 2 + (g.stand.z - at.z) ** 2;
    if (d <= bestD) {
      best = g;
      bestD = d;
    }
  }
  return best;
}
