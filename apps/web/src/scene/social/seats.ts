/**
 * Seats humans may take, as the client sees them (#49): every chair and
 * couch of the rooms this viewer can see into, from the same lists the
 * server validates `sit` against (`@regulus/room-layout` compound/seats.ts),
 * keyed `<roomId>/<seatId>` (protocol social.ts). Pure (no three.js): the
 * seat layer, the avatars, the e2e probe and tests share it.
 */
import { type BuildingState, parseSeatKey, SIT_REACH_METRES, seatKey } from "@regulus/protocol";
import { isHumanSeat, type Seat, specialRoomSeats } from "@regulus/room-layout";
import { humansOnViewedLevel } from "../../state/level.ts";
import { roomLayout } from "../compound/layouts.ts";
import { type CompoundWorld, isOpenRoom, roomById, type WorldRoom } from "../compound/world.ts";

/** A human seat placed in the compound. */
export interface HumanSeat {
  key: string;
  room: WorldRoom;
  /** Room frame. */
  seat: Seat;
  /** Seat point, compound metres. */
  x: number;
  z: number;
  heading: number;
}

/** The human seats of one room (room frame); none behind a door this viewer may not open. */
export function roomSeats(room: WorldRoom): Seat[] {
  if (!isOpenRoom(room)) return [];
  if (room.kind === "project") return (roomLayout(room)?.seats ?? []).filter(isHumanSeat);
  return specialRoomSeats(room.kind, room.size.w, room.size.d);
}

const place = (room: WorldRoom, seat: Seat): HumanSeat => ({
  key: seatKey(room.id, seat.id),
  room,
  seat,
  x: room.origin.x + seat.pose.x,
  z: room.origin.z + seat.pose.z,
  heading: seat.pose.heading,
});

/** Every human seat of the open rooms, compound metres. */
export function worldSeats(world: CompoundWorld): HumanSeat[] {
  return world.rooms.flatMap((room) => roomSeats(room).map((seat) => place(room, seat)));
}

/** The seat a key names, if this viewer can see it. */
export function seatByKey(world: CompoundWorld, key: string): HumanSeat | null {
  const parsed = parseSeatKey(key);
  const room = parsed ? roomById(world, parsed.roomId) : undefined;
  const seat = room ? roomSeats(room).find((s) => s.id === parsed?.seatId) : undefined;
  return room && seat ? place(room, seat) : null;
}

/** Seat keys held by humans other than `selfSessionId` on the level being viewed (#268). */
export function takenSeats(
  state: Pick<BuildingState, "humans"> | null | undefined,
  selfSessionId: string | null,
): Set<string> {
  const taken = new Set<string>();
  for (const [id, h] of humansOnViewedLevel(state))
    if (id !== selfSessionId && h.seatId) taken.add(h.seatId);
  return taken;
}

/** How close the player must stand for `E` to sit (a little inside the server's reach). */
export const SIT_KEY_REACH = SIT_REACH_METRES - 0.5;

/** The nearest free seat within `reach` of a point, or null. */
export function nearestFreeSeat(
  seats: readonly HumanSeat[],
  p: { x: number; z: number },
  taken: ReadonlySet<string>,
  reach: number = SIT_KEY_REACH,
): HumanSeat | null {
  let best: HumanSeat | null = null;
  let bestD = reach;
  for (const s of seats) {
    if (taken.has(s.key)) continue;
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
