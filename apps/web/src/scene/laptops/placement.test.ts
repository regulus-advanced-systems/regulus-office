import { describe, expect, test } from "bun:test";
import type { Rect } from "@regulus/room-layout";
import { lobbyTemplate, rectContains, TEMPLATES } from "@regulus/room-layout";
import { LAPTOP_DIMENSIONS, LAPTOP_SCALE, LAPTOP_TOP } from "./dimensions.ts";
import {
  EDGE_GAP,
  facing,
  LAPTOP_SIZE,
  type LaptopPlacement,
  laptopPlacements,
  rayEntry,
} from "./placement.ts";

/** Ground footprint of a placed laptop (axis-aligned; laptops turn in quarter turns). */
function footprint(l: LaptopPlacement): Rect {
  const across = Math.abs(Math.sin(l.rotationY)) > 0.5;
  const w = across ? LAPTOP_SIZE.d : LAPTOP_SIZE.w;
  const d = across ? LAPTOP_SIZE.w : LAPTOP_SIZE.d;
  return { x: l.position[0] - w / 2, z: l.position[2] - d / 2, w, d };
}

const EPS = 1e-6;
const inside = (a: Rect, b: Rect) =>
  a.x >= b.x - EPS &&
  a.z >= b.z - EPS &&
  a.x + a.w <= b.x + b.w + EPS &&
  a.z + a.d <= b.z + b.d + EPS;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.z < b.z + b.d - EPS && b.z < a.z + a.d - EPS;

describe("laptop placement", () => {
  test("one laptop per desk seat, on that seat's desk, facing the chair", () => {
    for (const template of TEMPLATES.values()) {
      const desks = template.seats.filter((s) => s.kind === "desk");
      const laptops = laptopPlacements(template);
      expect(laptops.map((l) => l.seatId)).toEqual(desks.map((s) => s.id));
      for (const l of laptops) {
        const seat = desks.find((s) => s.id === l.seatId);
        const desk = template.obstacles.find((o) => o.id === seat?.furnitureId);
        if (!seat || !desk) throw new Error(`seat ${l.seatId} has no desk`);
        expect(rectContains(desk.rect, { x: l.position[0], z: l.position[2] })).toBe(true);
        expect(l.position[1]).toBeCloseTo(0.76, 2);
        // The screen's normal (+z rotated by rotationY) points from the laptop back to the seat.
        const normal = { x: Math.sin(l.rotationY), z: Math.cos(l.rotationY) };
        const toSeat = { x: seat.pose.x - l.position[0], z: seat.pose.z - l.position[2] };
        expect(normal.x * toSeat.x + normal.z * toSeat.z).toBeGreaterThan(0.3);
      }
    }
  });

  test("the medium template has 12 laptops; the lobby none", () => {
    expect(laptopPlacements(TEMPLATES.get("office-l2") as never)).toHaveLength(12);
    expect(laptopPlacements(lobbyTemplate)).toHaveLength(0);
  });

  test("the laptop is 1.4x the #111 one and its screen follows", () => {
    expect(LAPTOP_SCALE).toBe(1.4);
    expect(LAPTOP_DIMENSIONS.w).toBeCloseTo(0.476, 3);
    expect(LAPTOP_DIMENSIONS.d).toBeCloseTo(0.336, 3);
    expect(LAPTOP_DIMENSIONS.screenW).toBeCloseTo(0.434, 3);
    expect(LAPTOP_DIMENSIONS.screenH).toBeCloseTo(0.266, 3);
    expect(LAPTOP_DIMENSIONS.screenW).toBeLessThan(LAPTOP_DIMENSIONS.w);
    expect(LAPTOP_TOP).toBeGreaterThan(0.3);
    expect(LAPTOP_SIZE).toEqual({ w: LAPTOP_DIMENSIONS.w, d: LAPTOP_DIMENSIONS.d });
  });

  test("the bigger laptops stay on their desk, clear of the chair and of each other", () => {
    for (const template of TEMPLATES.values()) {
      const laptops = laptopPlacements(template);
      const rects = laptops.map(footprint);
      laptops.forEach((l, i) => {
        const seat = template.seats.find((s) => s.id === l.seatId);
        const desk = template.obstacles.find((o) => o.id === seat?.furnitureId);
        const r = rects[i];
        if (!seat || !desk || !r) throw new Error(`seat ${l.seatId} has no desk`);
        expect(inside(r, desk.rect)).toBe(true);
        // The front edge keeps its gap from the desk edge the henchman sits at.
        const dir = facing(seat.pose.heading);
        const edge = rayEntry(seat.pose, dir, desk.rect) ?? 0;
        const front = rayEntry(seat.pose, dir, r) ?? 0;
        expect(front - edge).toBeCloseTo(EDGE_GAP, 6);
        rects.forEach((other, j) => {
          if (j !== i) expect(overlaps(r, other)).toBe(false);
        });
      });
    }
  });

  test("ray entry into a rect", () => {
    const rect = { x: 0, z: 0, w: 2, d: 1 };
    expect(rayEntry({ x: 1, z: 2 }, facing(0), rect)).toBeCloseTo(1);
    expect(rayEntry({ x: 5, z: 2 }, facing(0), rect)).toBeNull();
    expect(rayEntry({ x: 1, z: 0.5 }, facing(0), rect)).toBe(0);
  });
});
