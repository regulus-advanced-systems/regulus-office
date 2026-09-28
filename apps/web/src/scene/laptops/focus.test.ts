import { describe, expect, test } from "bun:test";
import type { Seat } from "@regulus/floor-layout";
import { nearestSeat } from "./focus.ts";

const seat = (id: string, x: number, z: number, kind: Seat["kind"] = "desk"): Seat => ({
  id,
  kind,
  pose: { x, z, heading: 0 },
});

describe("nearestSeat", () => {
  const seats = [seat("a", 0, 0), seat("b", 3, 0), seat("r", 0.2, 0, "reception")];
  test("nearest desk seat within the radius, honouring the filter", () => {
    expect(nearestSeat(seats, { x: 0.5, z: 0 }, 1.6)?.id).toBe("a");
    expect(nearestSeat(seats, { x: 2.5, z: 0 }, 1.6)?.id).toBe("b");
    expect(nearestSeat(seats, { x: 1.5, z: 5 }, 1.6)).toBeNull();
    expect(nearestSeat(seats, { x: 0.5, z: 0 }, 5, (s) => s.id !== "a")?.id).toBe("b");
  });
});
