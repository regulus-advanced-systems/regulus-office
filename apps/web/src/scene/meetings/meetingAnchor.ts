/**
 * Where a meeting sits in its room (#50): the desk pod its members took.
 * The hologram floats over that pod's table (or, when the members are spread
 * over several pods, over the middle of their seats).
 */
import type { RoomTemplate } from "@regulus/room-layout";

export interface MeetingAnchor {
  x: number;
  z: number;
  /** Seat poses of the members, by seat id (the speaker markers). */
  seats: ReadonlyMap<string, { x: number; z: number }>;
}

export function meetingAnchor(
  template: Pick<RoomTemplate, "seats" | "obstacles">,
  seatIds: readonly string[],
): MeetingAnchor | null {
  const seats = new Map<string, { x: number; z: number }>();
  const tables = new Set<string>();
  for (const id of seatIds) {
    const seat = template.seats.find((s) => s.id === id);
    if (!seat) continue;
    seats.set(id, { x: seat.pose.x, z: seat.pose.z });
    tables.add(seat.furnitureId ?? "");
  }
  if (seats.size === 0) return null;
  const [table] = [...tables];
  const obstacle =
    tables.size === 1 && table ? template.obstacles.find((o) => o.id === table) : undefined;
  if (obstacle) {
    return {
      x: obstacle.rect.x + obstacle.rect.w / 2,
      z: obstacle.rect.z + obstacle.rect.d / 2,
      seats,
    };
  }
  const points = [...seats.values()];
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    z: points.reduce((s, p) => s + p.z, 0) / points.length,
    seats,
  };
}
