import { describe, expect, test } from "bun:test";
import { HEADING } from "@regulus/room-layout";
import {
  angleDelta,
  headingOfTravel,
  lerpHeading,
  stepWithCollision,
  turnToward,
  wrapAngle,
} from "./kinematics.ts";

describe("kinematics", () => {
  test("wraps angles into (-pi, pi] so due south stays +pi like HEADING.south", () => {
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(HEADING.south)).toBe(HEADING.south);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
  });

  test("turns toward a target by at most the allowed step, along the short arc", () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(0, -1, 0.25)).toBeCloseTo(-0.25);
    expect(turnToward(0, 0.1, 0.25)).toBeCloseTo(0.1);
    expect(turnToward(3, -3, 0.2)).toBeCloseTo(3.2 - 2 * Math.PI);
    expect(lerpHeading(-3, 3, 0.5)).toBeCloseTo(Math.PI);
  });

  test("heading of travel follows the room-layout convention", () => {
    expect(headingOfTravel(0, -1)).toBeCloseTo(HEADING.north);
    expect(headingOfTravel(0, 1)).toBeCloseTo(HEADING.south);
    expect(headingOfTravel(1, 0)).toBeCloseTo(HEADING.east);
    expect(headingOfTravel(-1, 0)).toBeCloseTo(HEADING.west);
  });

  test("steps slide along a wall instead of stopping dead", () => {
    const wallAtX2 = (x: number) => x < 2;
    expect(stepWithCollision(wallAtX2, { x: 1, z: 1 }, 0.5, 0.5)).toEqual({ x: 1.5, z: 1.5 });
    const slid = stepWithCollision(wallAtX2, { x: 1.8, z: 1 }, 0.5, 0.5);
    expect(slid.x).toBeGreaterThan(1.9); // walks up flush to the wall (probes of <= 0.1 m)...
    expect(slid.x).toBeLessThan(2); // ...never through it...
    expect(slid.z).toBeCloseTo(1.5); // ...and keeps the free axis for the whole step
    const boxed = () => false;
    expect(stepWithCollision(boxed, { x: 1, z: 1 }, 0.5, 0)).toEqual({ x: 1, z: 1 });
  });

  test("long steps are probed in pieces so they stop at a thin wall instead of tunnelling", () => {
    const thinWall = (x: number) => x < 2 || x > 2.2;
    const stopped = stepWithCollision(thinWall, { x: 1, z: 0 }, 3, 0);
    expect(stopped.x).toBeLessThan(2);
    expect(stopped.x).toBeGreaterThan(1.8);
    expect(stepWithCollision(thinWall, { x: 1, z: 0 }, 3, 0, 5)).toEqual({ x: 4, z: 0 });
  });
});
