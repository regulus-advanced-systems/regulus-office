/**
 * Which desk the local player is at (SPEC §9.2 `E` interacts with the
 * nearest interactable; §9.4 the focused desk gets the live terminal).
 */
import type { Seat } from "@regulus/floor-layout";

/** How close to a seat counts as "at the desk" for `E` and the live screen. */
export const DESK_INTERACT_RADIUS = 1.6;
export const DESK_FOCUS_RADIUS = 2.2;

export function nearestSeat(
  seats: readonly Seat[],
  at: { x: number; z: number },
  radius: number,
  filter: (seat: Seat) => boolean = () => true,
): Seat | null {
  let best: Seat | null = null;
  let bestD = radius * radius;
  for (const s of seats) {
    if (s.kind !== "desk" || !filter(s)) continue;
    const d = (s.pose.x - at.x) ** 2 + (s.pose.z - at.z) ** 2;
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
