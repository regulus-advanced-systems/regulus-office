/**
 * Desk pods and the lounge nook (#182). A desk is a shared table with four
 * seats (`d<n>s1..4`) facing it, a rug under it and a little personal
 * clutter on it. The nook (two armchairs facing a coffee table, a lamp and a
 * rug) takes the last free pod slot once the room has more than one desk.
 */
import { HEADING } from "../geometry.ts";
import { armchair } from "../templates/decor.ts";
import type { Decor, Obstacle, Rug, Seat } from "../types.ts";
import { SEAT_NORTH_Z, SEAT_SOUTH_Z, SEAT_X, TABLE_D, TABLE_W } from "./constants.ts";
import { roomDeskId, roomSeatId } from "./seat-ids.ts";
import type { PodSlot } from "./slots.ts";
import type { DecorStyleSpec } from "./styles.ts";
import type { RoomDesk } from "./types.ts";

export interface Furnishing {
  obstacles: Obstacle[];
  seats: Seat[];
  rugs: Rug[];
  decor: Decor[];
  desks: RoomDesk[];
}

export function emptyFurnishing(): Furnishing {
  return { obstacles: [], seats: [], rugs: [], decor: [], desks: [] };
}

/** Desk `n` in `slot`: table, four seats, a rug and two clutter props. */
export function addDesk(f: Furnishing, n: number, slot: PodSlot, style: DecorStyleSpec): void {
  const id = roomDeskId(n);
  const tableId = `${id}-table`;
  const x = slot.tableX;
  const z = slot.tableZ;
  f.obstacles.push({
    id: tableId,
    kind: "shared_table",
    rect: { x, z, w: TABLE_W, d: TABLE_D },
  });
  const poses = [
    { x: x + SEAT_X[0], z: z + SEAT_NORTH_Z, heading: HEADING.south },
    { x: x + SEAT_X[1], z: z + SEAT_NORTH_Z, heading: HEADING.south },
    { x: x + SEAT_X[0], z: z + SEAT_SOUTH_Z, heading: HEADING.north },
    { x: x + SEAT_X[1], z: z + SEAT_SOUTH_Z, heading: HEADING.north },
  ];
  const seatIds = poses.map((pose, i) => {
    const seatId = roomSeatId(n, i + 1);
    f.seats.push({ id: seatId, kind: "desk", furnitureId: tableId, pose });
    return seatId;
  });
  f.desks.push({ id, number: n, tableId, seatIds });
  const r = slot.rect;
  f.rugs.push({
    id: `${id}-rug`,
    rect: { x: r.x - 0.3, z: r.z - 0.3, w: r.w + 0.6, d: r.d + 0.6 },
    tone: style.rugTone,
    style: "rug",
  });
  // Clutter on the table's centre line, clear of the laptops at each seat.
  const mid = z + TABLE_D / 2;
  const kinds = style.clutter;
  const first = kinds[(2 * (n - 1)) % kinds.length] ?? "mugs";
  const second = kinds[(2 * (n - 1) + 1) % kinds.length] ?? "books";
  f.decor.push(
    { id: `${id}-clutter-1`, kind: first, on: tableId, x: x + 0.4, z: mid, heading: 0 },
    {
      id: `${id}-clutter-2`,
      kind: second,
      on: tableId,
      x: x + TABLE_W - 0.4,
      z: mid,
      heading: 0.6,
    },
  );
}

/** Two armchairs facing a coffee table, a floor lamp and a rug, inside `slot`. */
export function addNook(f: Furnishing, slot: PodSlot): string {
  const x = slot.tableX;
  const z = slot.tableZ + 0.5;
  const west = armchair("nook-chair-w", x + 0.75, z, HEADING.east);
  const east = armchair("nook-chair-e", x + 2.25, z, HEADING.west);
  f.obstacles.push(...west.obstacles, ...east.obstacles);
  f.seats.push(...west.seats, ...east.seats);
  f.obstacles.push(
    { id: "nook-table", kind: "coffee_table", rect: { x: x + 1.1, z: z - 0.3, w: 0.8, d: 0.6 } },
    { id: "nook-lamp", kind: "floor_lamp", rect: { x: x + 2.4, z: z + 0.7, w: 0.35, d: 0.35 } },
  );
  f.decor.push({ id: "nook-mugs", kind: "mugs", on: "nook-table", x: x + 1.5, z, heading: 0 });
  f.rugs.push({
    id: "nook-rug",
    rect: { x: x - 0.1, z: z - 1, w: TABLE_W + 0.2, d: 2.4 },
    tone: "light",
    style: "patch",
  });
  return "nook-lamp";
}
