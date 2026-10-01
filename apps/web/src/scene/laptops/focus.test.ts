import { describe, expect, test } from "bun:test";
import type { Seat } from "@regulus/room-layout";
import { DESK_FOCUS_RADIUS, nearestSeat, terminalDeskAt } from "./focus.ts";

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

describe("terminalDeskAt (#205)", () => {
  const seats = [seat("busy", 0, 0), seat("free", 4, 0)];
  const occupied = (id: string) => id === "busy";

  test("reaches the occupied desk as far out as the live panel shows (2.2 m), not just 1.6 m", () => {
    for (let d = 0; d <= DESK_FOCUS_RADIUS; d += 0.05) {
      for (const [dx, dz] of [
        [-1, 0],
        [0, 1],
        [0, -1],
        [0.6, 0.8],
      ] as const) {
        const at = { x: dx * d, z: dz * d };
        // Unless the free desk is the nearest one within reach, E opens this henchman's terminal.
        const free = nearestSeat(seats, at, 1.6)?.id === "free";
        expect(terminalDeskAt(seats, at, occupied)?.id ?? null).toBe(free ? null : "busy");
      }
    }
    expect(terminalDeskAt(seats, { x: 0, z: DESK_FOCUS_RADIUS + 0.05 }, occupied)).toBeNull();
  });

  test("a nearer free desk is the spawn dialog's, not a terminal", () => {
    expect(terminalDeskAt(seats, { x: 3, z: 0 }, occupied)).toBeNull();
    expect(terminalDeskAt(seats, { x: 6, z: 0 }, occupied)).toBeNull();
  });
});
