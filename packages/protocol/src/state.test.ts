import { describe, expect, test } from "bun:test";
import { BuildingState, HumanPresence } from "./building-state.ts";
import { buildingFixture, henchmanFixture, humanFixture, operationFixture } from "./fixtures.ts";
import { boardCardKey, HenchmanState, OperationState } from "./operation-state.ts";

describe("state shapes", () => {
  test("building fixture validates and round-trips unchanged", () => {
    const result = BuildingState.safeParse(buildingFixture);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(buildingFixture);
  });

  test("operation fixture validates and round-trips unchanged", () => {
    const result = OperationState.safeParse(operationFixture);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(operationFixture);
  });

  test("rejects enum values outside the shared lists", () => {
    expect(HumanPresence.safeParse({ ...humanFixture, role: "root" }).success).toBe(false);
    expect(HenchmanState.safeParse({ ...henchmanFixture, status: "busy" }).success).toBe(false);
    expect(HenchmanState.safeParse({ ...henchmanFixture, action: "dancing" }).success).toBe(false);
  });

  test("rejects negative counters and non-finite positions", () => {
    expect(HenchmanState.safeParse({ ...henchmanFixture, issueNumber: -1 }).success).toBe(false);
    const pos = { ...humanFixture.position, x: Number.NaN };
    expect(HumanPresence.safeParse({ ...humanFixture, position: pos }).success).toBe(false);
  });

  test("board card key matches fixture keys", () => {
    expect(boardCardKey("r1", 8)).toBe("r1#8");
    expect(Object.keys(operationFixture.issues)).toContain(boardCardKey("r1", 8));
  });
});
