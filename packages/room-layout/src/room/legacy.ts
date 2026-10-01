/**
 * Pre-compound operations (#182 migration): henchmen keep their seats.
 *
 * Decision: a legacy-id map, not a rewrite. Migrated operations keep their old
 * template seat ids in `desks.seat_id` and `agents.desk_seat_id`, because the
 * scene still draws them from their template until #186 switches it to
 * generated rooms. Each old desk seat maps to one generated seat: the
 * template's desk seats in template order, four per desk, so `table-a-n1`
 * becomes `d1s1` and an operation with n desk seats gets ceil(n / 4) desks. The
 * migration sets `operations.desk_count` to that, so the generated room always
 * has a seat for every henchman; the compound sizes migrated rooms with
 * `legacyRoomSize` (#181), which always fits that many desks (tested). #186
 * can rename the rows with this map when it switches the scene, or resolve
 * ids through `canonicalSeatId`.
 */
import { SEATS_PER_DESK } from "@regulus/protocol";
import { deskSeats } from "../query.ts";
import { TIER_TEMPLATES } from "../templates/tiers.ts";
import type { RoomTemplate } from "../types.ts";
import { roomSeatId } from "./seat-ids.ts";

function seatMapOf(template: RoomTemplate): Record<string, string> {
  const map: Record<string, string> = {};
  deskSeats(template).forEach((seat, i) => {
    map[seat.id] = roomSeatId(Math.floor(i / SEATS_PER_DESK) + 1, (i % SEATS_PER_DESK) + 1);
  });
  return map;
}

/** Old template seat id → generated seat id, per legacy template id. */
export const LEGACY_SEAT_IDS: Readonly<Record<string, Readonly<Record<string, string>>>> =
  Object.fromEntries(Object.values(TIER_TEMPLATES).map((t) => [t.id, seatMapOf(t)]));

export function isLegacyTemplateId(templateId: string): boolean {
  return templateId in LEGACY_SEAT_IDS;
}

/** Desks a migrated operation needs so every old desk seat has a generated seat. */
export function legacyDeskCount(templateId: string): number | undefined {
  const map = LEGACY_SEAT_IDS[templateId];
  return map ? Math.ceil(Object.keys(map).length / SEATS_PER_DESK) : undefined;
}

/** The generated seat id for a seat of an operation on `templateId`; other ids pass through. */
export function canonicalSeatId(templateId: string, seatId: string): string {
  return LEGACY_SEAT_IDS[templateId]?.[seatId] ?? seatId;
}

/** The old template seat id behind a generated seat id, if the operation has one. */
export function legacySeatId(templateId: string, roomSeat: string): string | undefined {
  const map = LEGACY_SEAT_IDS[templateId];
  if (!map) return undefined;
  return Object.keys(map).find((old) => map[old] === roomSeat);
}
