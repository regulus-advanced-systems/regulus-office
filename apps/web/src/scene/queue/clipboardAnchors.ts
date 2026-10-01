/**
 * Where the room's task queue hangs (SPEC §9.4 "a clipboard on the wall next
 * to the boards"; #37): every `queue_clipboard` wall anchor of the room
 * layout. Data-driven, so a compound room (M2.5) re-homes it by listing the
 * anchor wherever it wants. Pure.
 */
import {
  anchorStandPose,
  type RoomTemplate,
  type Wall,
  type WallAnchor,
  wallById,
} from "@regulus/room-layout";

export const CLIPBOARD_ANCHOR_KIND = "queue_clipboard";
/** How far from its stand point `E` still reaches the clipboard, metres. */
export const CLIPBOARD_INTERACT_RADIUS = 1.4;

export interface ClipboardAnchor {
  anchor: WallAnchor;
  wall: Wall;
  stand: { x: number; z: number };
}

export function clipboardAnchors(template: RoomTemplate): ClipboardAnchor[] {
  const out: ClipboardAnchor[] = [];
  for (const anchor of template.wallAnchors) {
    if (anchor.kind !== CLIPBOARD_ANCHOR_KIND) continue;
    const wall = wallById(template, anchor.wallId);
    if (wall) out.push({ anchor, wall, stand: anchorStandPose(wall, anchor) });
  }
  return out;
}

export function clipboardInReach(
  clipboards: readonly ClipboardAnchor[],
  at: { x: number; z: number },
  radius = CLIPBOARD_INTERACT_RADIUS,
): ClipboardAnchor | null {
  let best: ClipboardAnchor | null = null;
  let bestD = radius * radius;
  for (const c of clipboards) {
    const d = (c.stand.x - at.x) ** 2 + (c.stand.z - at.z) ** 2;
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
