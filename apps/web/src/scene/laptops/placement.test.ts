import { describe, expect, test } from "bun:test";
import { lobbyTemplate, rectContains, TEMPLATES } from "@regulus/floor-layout";
import { facing, laptopPlacements, rayEntry } from "./placement.ts";

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

  test("ray entry into a rect", () => {
    const rect = { x: 0, z: 0, w: 2, d: 1 };
    expect(rayEntry({ x: 1, z: 2 }, facing(0), rect)).toBeCloseTo(1);
    expect(rayEntry({ x: 5, z: 2 }, facing(0), rect)).toBeNull();
    expect(rayEntry({ x: 1, z: 0.5 }, facing(0), rect)).toBe(0);
  });
});
