import { describe, expect, test } from "bun:test";
import type { FloorSummary } from "@regulus/protocol";
import { currentFloorName, LOBBY_NAME } from "./floorName.ts";

const floor = (index: number, name: string): FloorSummary => ({
  floorId: `f${index}`,
  name,
  slug: name.toLowerCase(),
  index,
  paletteId: "teal",
  robotsWorking: 0,
  robotsWaiting: 0,
  robotsTotal: 0,
  humansPresent: 0,
});

describe("currentFloorName", () => {
  const floors = { f0: floor(0, "Ground"), f1: floor(1, "Regulus Web") };
  test("no floor joined means the lobby", () => {
    expect(currentFloorName(floors, null)).toBe(LOBBY_NAME);
    expect(currentFloorName(null, null)).toBe(LOBBY_NAME);
  });
  test("floor 0 is always shown as the lobby", () => {
    expect(currentFloorName(floors, "f0")).toBe(LOBBY_NAME);
  });
  test("other floors show their project name", () => {
    expect(currentFloorName(floors, "f1")).toBe("Regulus Web");
  });
  test("a floor the building has not listed yet shows a placeholder", () => {
    expect(currentFloorName(floors, "missing")).toBe("Floor …");
    expect(currentFloorName(null, "f1")).toBe("Floor …");
  });
});
