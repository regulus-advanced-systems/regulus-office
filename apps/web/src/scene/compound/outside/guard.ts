/**
 * When the nav grid changes under the player (#188: the blast door shuts,
 * or anything else closes), nobody is left standing inside a wall: a player
 * on a cell that is no longer walkable steps out to the nearest open cell
 * (out of the doorway, onto whichever side is closer), and a walk in
 * progress is planned again on the new grid (and given up when its goal is
 * now out of reach, behind the shut door).
 */
import type { NavGrid, Vec2 } from "@regulus/room-layout";
import { useEffect } from "react";
import { usePlayerStore } from "../../../state/player.ts";
import { nearestWalkable } from "../../movement/navigation.ts";

/** How far the player may be moved out of a closing doorway, metres. */
export const EVICT_RADIUS = 3;

/** Where a player at `p` goes when its cell stops being walkable; null when it still is. */
export function evictionPoint(grid: NavGrid, p: Vec2): Vec2 | null {
  if (grid.isWalkable(p.x, p.z)) return null;
  return nearestWalkable(grid, p, EVICT_RADIUS);
}

export function useDoorwayGuard(grid: NavGrid): void {
  useEffect(() => {
    const s = usePlayerStore.getState();
    if (!s.spawned) return;
    const to = evictionPoint(grid, { x: s.x, z: s.z });
    if (to) {
      s.clearTarget();
      s.setPose(to.x, to.z, s.heading);
      return;
    }
    if (s.target) s.setTarget(s.target.x, s.target.z);
  }, [grid]);
}
