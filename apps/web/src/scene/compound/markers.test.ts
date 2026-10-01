import { describe, expect, test } from "bun:test";
import { DOOR_OPEN_RADIUS, someoneNear } from "./Doors.tsx";
import { signLines } from "./signTexture.ts";

describe("door plaques (#186)", () => {
  test("name and henchman counts; restricted rooms say so; build sites say they are building", () => {
    expect(
      signLines({ name: "Apollo", working: 2, waiting: 1, building: false, locked: false }),
    ).toEqual({
      title: "Apollo",
      status: "2 WORKING · 1 WAITING",
    });
    expect(
      signLines({ name: "Zeus", working: 0, waiting: 0, building: false, locked: true }).status,
    ).toBe("0 WORKING · 0 WAITING · RESTRICTED");
    expect(
      signLines({ name: "Hermes", working: 0, waiting: 0, building: true, locked: false }).status,
    ).toBe("UNDER CONSTRUCTION");
    expect(
      signLines({
        name: "A very long project room name",
        working: 0,
        waiting: 0,
        building: false,
        locked: false,
      }).title,
    ).toHaveLength(22);
  });
});

describe("doors open for people near them (#186)", () => {
  const door = { id: "d", position: [10, 0, 10] as const, open: false };
  test("within the radius, anyone", () => {
    expect(someoneNear(door, [{ x: 10 + DOOR_OPEN_RADIUS - 0.1, z: 10 }])).toBe(true);
    expect(someoneNear(door, [{ x: 10 + DOOR_OPEN_RADIUS + 0.1, z: 10 }])).toBe(false);
    expect(someoneNear(door, [])).toBe(false);
  });
});
