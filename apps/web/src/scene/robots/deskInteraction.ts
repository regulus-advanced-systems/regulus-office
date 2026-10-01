/**
 * `E` at a free desk (SPEC §9.2) opens the spawn dialog. The nearest desk
 * seat within reach decides (same rule and radius as the laptop focus of
 * scene/laptops, which already opens the terminal for `E` at an occupied
 * desk); an occupied nearest desk is left to it. Pure.
 */
import type { Seat } from "@regulus/room-layout";
import { DESK_INTERACT_RADIUS, nearestSeat } from "../laptops/focus.ts";

export function freeDeskAt(
  seats: readonly Seat[],
  at: { x: number; z: number },
  occupied: (seatId: string) => boolean,
  radius = DESK_INTERACT_RADIUS,
): Seat | null {
  const seat = nearestSeat(seats, at, radius);
  return seat && !occupied(seat.id) ? seat : null;
}
