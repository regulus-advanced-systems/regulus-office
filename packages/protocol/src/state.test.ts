import { describe, expect, test } from "bun:test";
import { BuildingState, HumanPresence } from "./building-state.ts";
import { buildingFixture, floorFixture, humanFixture, robotFixture } from "./fixtures.ts";
import { boardCardKey, FloorState, RobotState } from "./floor-state.ts";

describe("state shapes", () => {
  test("building fixture validates and round-trips unchanged", () => {
    const result = BuildingState.safeParse(buildingFixture);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(buildingFixture);
  });

  test("floor fixture validates and round-trips unchanged", () => {
    const result = FloorState.safeParse(floorFixture);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(floorFixture);
  });

  test("rejects enum values outside the shared lists", () => {
    expect(HumanPresence.safeParse({ ...humanFixture, role: "root" }).success).toBe(false);
    expect(RobotState.safeParse({ ...robotFixture, status: "busy" }).success).toBe(false);
    expect(RobotState.safeParse({ ...robotFixture, action: "dancing" }).success).toBe(false);
  });

  test("rejects negative counters and non-finite positions", () => {
    expect(RobotState.safeParse({ ...robotFixture, issueNumber: -1 }).success).toBe(false);
    const pos = { ...humanFixture.position, x: Number.NaN };
    expect(HumanPresence.safeParse({ ...humanFixture, position: pos }).success).toBe(false);
  });

  test("board card key matches fixture keys", () => {
    expect(boardCardKey("r1", 8)).toBe("r1#8");
    expect(Object.keys(floorFixture.issues)).toContain(boardCardKey("r1", 8));
  });
});
