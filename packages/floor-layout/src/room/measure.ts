/**
 * Checks for generated rooms (#182) beyond `loadTemplate`: free floor,
 * furniture overlaps, seat facing and the shared roominess rules
 * (`spacing.ts`: 1.5 m lanes to every seat and stand point, 1.5 m between
 * desk pods). Tests hold every size, door side, style and desk count to
 * `roomProblems`; `maxDeskCount` uses `roomFreeFraction`.
 */
import { facingError, MAX_FACING_ERROR, seatFocus } from "../facing.ts";
import { type Rect, rectsOverlap } from "../geometry.ts";
import { chairRect, clearanceGrid, clusterGapProblems, laneProblems } from "../spacing.ts";
import type { FloorTemplate } from "../types.ts";
import { templateProblems } from "../validate.ts";

/**
 * Share of the interior that is free floor on the clearance grid (chairs
 * count as taken). The outermost ring of cells, under the walls, is left
 * out so small rooms are not penalised for their walls.
 */
export function roomFreeFraction(t: FloorTemplate): number {
  const grid = clearanceGrid(t);
  let free = 0;
  let total = 0;
  for (let row = 1; row < grid.rows - 1; row++) {
    for (let col = 1; col < grid.cols - 1; col++) {
      total++;
      if (grid.isCellWalkable({ col, row })) free++;
    }
  }
  return total === 0 ? 0 : free / total;
}

/** Furniture that overlaps other furniture, or a chair standing in furniture or another chair. */
export function overlapProblems(t: FloorTemplate): string[] {
  const problems: string[] = [];
  const items: Array<{ id: string; rect: Rect; owner?: string }> = [
    ...t.obstacles.map((o) => ({ id: o.id, rect: o.rect })),
    ...t.seats.map((s) => ({ id: `chair ${s.id}`, rect: chairRect(s), owner: s.furnitureId })),
  ];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i] as (typeof items)[number];
      const b = items[j] as (typeof items)[number];
      // An armchair's own backrest is part of its seat.
      if (a.owner === b.id || b.owner === a.id) continue;
      if (rectsOverlap(a.rect, b.rect)) problems.push(`"${a.id}" overlaps "${b.id}"`);
    }
  }
  return problems;
}

/** Seats not facing what they belong to (their desk, or a nook's coffee table). */
export function facingProblems(t: FloorTemplate): string[] {
  return t.seats.flatMap((seat) => {
    const focus = seatFocus(t, seat);
    if (!focus) return [`seat "${seat.id}" faces nothing`];
    const err = facingError(seat.pose.heading, seat.pose, focus);
    return err > MAX_FACING_ERROR
      ? [`seat "${seat.id}" is ${((err * 180) / Math.PI).toFixed(0)}° off`]
      : [];
  });
}

/** Every problem a generated room can have; empty when it is sound. */
export function roomProblems(t: FloorTemplate, minFree: number): string[] {
  const free = roomFreeFraction(t);
  return [
    ...templateProblems(t),
    ...overlapProblems(t),
    ...facingProblems(t),
    ...laneProblems(t),
    ...clusterGapProblems(t),
    ...(free < minFree ? [`only ${(free * 100).toFixed(0)}% of the interior is free`] : []),
  ];
}
