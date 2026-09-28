import { describe, expect, test } from "bun:test";
import { HEADING } from "@regulus/floor-layout";
import { followPath } from "./pathFollower.ts";

describe("followPath", () => {
  test("moves at speed toward the first waypoint and reports distance", () => {
    const r = followPath({ x: 0, z: 0, heading: 0 }, [{ x: 10, z: 0 }], 0.5, { speed: 2 });
    expect(r.pose.x).toBeCloseTo(1);
    expect(r.pose.z).toBeCloseTo(0);
    expect(r.moved).toBeCloseTo(1);
    expect(r.arrived).toBe(false);
    expect(r.path).toEqual([{ x: 10, z: 0 }]);
  });

  test("carries leftover distance across waypoints within one frame", () => {
    const path = [
      { x: 1, z: 0 },
      { x: 1, z: 1 },
    ];
    const r = followPath({ x: 0, z: 0, heading: 0 }, path, 1, { speed: 1.5 });
    expect(r.pose.x).toBeCloseTo(1);
    expect(r.pose.z).toBeCloseTo(0.5);
    expect(r.path).toEqual([{ x: 1, z: 1 }]);
    expect(r.moved).toBeCloseTo(1.5);
  });

  test("arrives exactly on the last waypoint without overshooting", () => {
    const r = followPath({ x: 0, z: 0, heading: 0 }, [{ x: 0.3, z: 0 }], 1, { speed: 5 });
    expect(r.pose).toMatchObject({ x: 0.3, z: 0 });
    expect(r.arrived).toBe(true);
    expect(r.path).toEqual([]);
    expect(r.moved).toBeCloseTo(0.3);
  });

  test("turns toward the travel direction at the turn rate", () => {
    const east = followPath({ x: 0, z: 0, heading: 0 }, [{ x: 5, z: 0 }], 0.1, {
      speed: 1,
      turnRate: 100,
    });
    expect(east.pose.heading).toBeCloseTo(HEADING.east);
    const slow = followPath({ x: 0, z: 0, heading: 0 }, [{ x: 5, z: 0 }], 0.1, {
      speed: 1,
      turnRate: 1,
    });
    expect(slow.pose.heading).toBeCloseTo(-0.1);
  });

  test("an empty path is an immediate arrival and does not mutate the input", () => {
    const path = [{ x: 2, z: 2 }];
    const r = followPath({ x: 0, z: 0, heading: 0 }, [], 1);
    expect(r.arrived).toBe(true);
    expect(r.moved).toBe(0);
    followPath({ x: 0, z: 0, heading: 0 }, path, 10);
    expect(path).toEqual([{ x: 2, z: 2 }]);
  });
});
