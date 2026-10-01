/**
 * Stable seat ids for generated rooms (#182): `d<desk>s<seat>`, desks and
 * seats 1-based. Desk n always has the same four ids, so adding desks never
 * renumbers a seat and a robot keeps its seat when the room grows.
 *
 * Seat order around a desk: s1 north-west, s2 north-east (both facing
 * south), s3 south-west, s4 south-east (both facing north).
 */
import { SEATS_PER_DESK } from "@regulus/protocol";

const SEAT_ID = /^d([1-9]\d{0,2})s([1-4])$/;

export function roomSeatId(desk: number, seat: number): string {
  return `d${desk}s${seat}`;
}

export function roomDeskId(desk: number): string {
  return `d${desk}`;
}

/** The desk and seat numbers of a generated seat id, or null for any other id. */
export function parseRoomSeatId(seatId: string): { desk: number; seat: number } | null {
  const m = SEAT_ID.exec(seatId);
  if (!m) return null;
  return { desk: Number(m[1]), seat: Number(m[2]) };
}

/** The four seat ids of desk `desk`. */
export function deskSeatIds(desk: number): string[] {
  return Array.from({ length: SEATS_PER_DESK }, (_, i) => roomSeatId(desk, i + 1));
}

/** Every desk seat id of a room with `deskCount` desks, desk by desk. */
export function roomDeskSeatIds(deskCount: number): string[] {
  return Array.from({ length: deskCount }, (_, i) => deskSeatIds(i + 1)).flat();
}
