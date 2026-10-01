import { describe, expect, test } from "bun:test";
import { HEADING } from "@regulus/room-layout";
import { followPath, TURN_IN_PLACE_ABOVE } from "./pathFollower.ts";

describe("followPath", () => {
  test("moves at speed toward the first waypoint and reports distance", () => {
    const r = followPath({ x: 0, z: 0, heading: HEADING.east }, [{ x: 10, z: 0 }], 0.5, {
      speed: 2,
    });
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
    const r = followPath({ x: 0, z: 0, heading: HEADING.east }, path, 1, { speed: 1.5 });
    expect(r.pose.x).toBeCloseTo(1);
    expect(r.pose.z).toBeCloseTo(0.5);
    expect(r.path).toEqual([{ x: 1, z: 1 }]);
    expect(r.moved).toBeCloseTo(1.5);
  });

  test("arrives exactly on the last waypoint without overshooting", () => {
    const r = followPath({ x: 0, z: 0, heading: HEADING.east }, [{ x: 0.3, z: 0 }], 1, {
      speed: 5,
    });
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
    expect(slow.moved).toBe(0); // still turning on the spot: 90 degrees off the way
  });

  test("turns on the spot toward the way before walking face-first", () => {
    // Facing west, path due east: 180 degrees off.
    const start = { x: 0, z: 0, heading: HEADING.west };
    const turnRate = 10;
    const spotTurn = (Math.PI - TURN_IN_PLACE_ABOVE) / turnRate;
    const turning = followPath(start, [{ x: 5, z: 0 }], spotTurn / 2, { speed: 1, turnRate });
    expect(turning.moved).toBe(0);
    expect(turning.pose).toMatchObject({ x: 0, z: 0 });
    expect(turning.arrived).toBe(false);
    expect(turning.path).toEqual([{ x: 5, z: 0 }]);

    // Past the spot turn it walks the rest of the frame, finishing the turn on the move.
    const off = followPath(start, [{ x: 5, z: 0 }], spotTurn + 0.2, { speed: 1, turnRate });
    expect(off.moved).toBeCloseTo(0.2);
    expect(off.pose.x).toBeCloseTo(0.2);
    expect(off.pose.heading).toBeCloseTo(HEADING.east);
  });

  test("small corners are taken on the move", () => {
    const r = followPath({ x: 0, z: 0, heading: HEADING.north }, [{ x: 1, z: -1 }], 0.1, {
      speed: 1,
      turnRate: 100,
    });
    expect(r.moved).toBeCloseTo(0.1); // 45 degrees off: no stop
    expect(r.pose.heading).toBeCloseTo(-Math.PI / 4);
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
