import { describe, expect, test } from "bun:test";
import {
  beaconLevel,
  DOOR_TRAVEL_S,
  easeDoor,
  LAMP_OFF,
  lampLevel,
  poolLights,
  stepOpenness,
} from "./animation.ts";
import { DOOR_OPENING } from "./dimensions.ts";
import { DOOR_LEAF, doorOpening, leafOffsets, leafWidth } from "./geometry/doors.ts";

describe("sliding doors", () => {
  test("openness moves toward the target at constant speed and stops there", () => {
    expect(stepOpenness(0, 1, DOOR_TRAVEL_S / 2)).toBeCloseTo(0.5);
    expect(stepOpenness(0.9, 1, 1)).toBe(1);
    expect(stepOpenness(1, 0, DOOR_TRAVEL_S / 4)).toBeCloseTo(0.75);
    expect(stepOpenness(0.3, 0.3, 1)).toBe(0.3);
    expect(stepOpenness(0.5, 1, -1)).toBe(0.5);
  });

  test("travel is eased at both ends", () => {
    expect(easeDoor(0)).toBe(0);
    expect(easeDoor(1)).toBe(1);
    expect(easeDoor(0.5)).toBeCloseTo(0.5);
    expect(easeDoor(0.1)).toBeLessThan(0.1);
  });

  test("closed leaves meet in the middle and cover the opening; open leaves clear it", () => {
    const closed = leafOffsets(0);
    expect(closed.left).toBeCloseTo(-closed.right);
    expect(closed.right - DOOR_LEAF.w / 2).toBeLessThan(0);
    expect(closed.right + DOOR_LEAF.w / 2).toBeGreaterThan(DOOR_OPENING.w / 2);
    const open = leafOffsets(1);
    // Only a lip of each leaf stays in the opening.
    expect(open.right - DOOR_LEAF.w / 2).toBeGreaterThan(DOOR_OPENING.w / 2 - 0.1);
  });

  test("a two-tile door's wider leaves meet in the middle and clear the wider opening", () => {
    const closed = leafOffsets(0, 2);
    expect(closed.right + leafWidth(2) / 2).toBeGreaterThan(doorOpening(2) / 2);
    expect(closed.right - leafWidth(2) / 2).toBeLessThan(0);
    const open = leafOffsets(1, 2);
    expect(open.right - leafWidth(2) / 2).toBeGreaterThan(doorOpening(2) / 2 - 0.1);
    expect(doorOpening(2)).toBeGreaterThan(2 * DOOR_OPENING.w);
  });
});

describe("console lamps and beacons", () => {
  test("lamp levels are deterministic and either lit or dim", () => {
    for (let i = 0; i < 50; i++) {
      for (const t of [0, 0.37, 1.5, 9.9]) {
        const v = lampLevel(i, t);
        expect(v === 1 || v === LAMP_OFF).toBe(true);
        expect(lampLevel(i, t)).toBe(v);
      }
    }
  });

  test("a bank twinkles: some lamps hold steady, others change over a second", () => {
    let steady = 0;
    let blinking = 0;
    for (let i = 0; i < 60; i++) {
      const seen = new Set<number>();
      for (let t = 0; t < 2; t += 0.05) seen.add(lampLevel(i, t));
      if (seen.size === 1) steady++;
      else blinking++;
    }
    expect(steady).toBeGreaterThan(5);
    expect(blinking).toBeGreaterThan(20);
  });

  test("the beacon sweeps between a floor and full", () => {
    const values = Array.from({ length: 100 }, (_, i) => beaconLevel(i / 100));
    expect(Math.min(...values)).toBeCloseTo(0.25, 2);
    expect(Math.max(...values)).toBeGreaterThan(0.95);
  });
});

describe("poolLights", () => {
  const lamps = [
    { x: 0, y: 2, z: 0 },
    { x: 10, y: 2, z: 0 },
    { x: 3, y: 2, z: 4 },
    { x: -1, y: 2, z: 0 },
  ];

  test("picks the nearest lamps to the focus, nearest first", () => {
    expect(poolLights(lamps, { x: 0, z: 0 }, 2)).toEqual([0, 3]);
    expect(poolLights(lamps, { x: 9, z: 0 }, 1)).toEqual([1]);
  });

  test("never more than asked or available", () => {
    expect(poolLights(lamps, { x: 0, z: 0 }, 10)).toHaveLength(4);
    expect(poolLights(lamps, { x: 0, z: 0 }, 0)).toEqual([]);
  });
});
