import { describe, expect, test } from "bun:test";
import { OFFICE_AGENT_RUN_ABOVE } from "@regulus/protocol";
import { buildCompoundNavGrid, type NavGrid } from "@regulus/room-layout";
import { angleDelta, headingOfTravel } from "../movement/kinematics.ts";
import { createBodyWalker, type WalkTarget } from "./walker.ts";

/** Two 8 m rooms side by side; the east one's door is shut for this viewer. */
function grid(closed: string[] = []): NavGrid {
  return buildCompoundNavGrid(
    {
      width: 24,
      depth: 12,
      outsideDepth: 0,
      rooms: [
        { id: "open", rect: { x: 2, y: 2, w: 4, d: 4 }, doorSide: "south", door: { x: 3, y: 6 } },
        { id: "shut", rect: { x: 12, y: 2, w: 4, d: 4 }, doorSide: "south", door: { x: 13, y: 6 } },
      ],
      corridors: [{ x: 1, y: 6, w: 20, d: 2 }],
      blastDoor: { x: 0, y: 0, width: 0 },
    },
    { cellSize: 0.25, closedDoors: new Set(closed) },
  );
}

const target = (x: number, z: number, over: Partial<WalkTarget> = {}): WalkTarget => ({
  x,
  z,
  heading: 0,
  hop: 1,
  door: null,
  ...over,
});

function walk(w: ReturnType<typeof createBodyWalker>, seconds: number, each?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    w.step(1 / 60);
    each?.();
  }
}

describe("body walker", () => {
  test("first sight places it at the target; it does not walk in from nowhere", () => {
    const w = createBodyWalker();
    w.retarget(grid(), target(8, 8, { heading: 1 }));
    expect(w.pose).toEqual({ x: 8, z: 8, heading: 1 });
    expect(w.moving).toBe(false);
    expect(w.step(1 / 60)).toBe(false);
  });

  test("a new target is walked to face-first, round the walls, at walking pace", () => {
    const g = grid();
    const w = createBodyWalker();
    w.retarget(g, target(8, 8));
    // Out of the room's door into the corridor, through its doorway.
    w.retarget(g, target(8.6, 12.6));
    expect(w.moving || w.remaining > 0).toBe(true);
    let last = { x: w.pose.x, z: w.pose.z };
    let maxStep = 0;
    walk(w, 6, () => {
      const dx = w.pose.x - last.x;
      const dz = w.pose.z - last.z;
      const step = Math.hypot(dx, dz);
      maxStep = Math.max(maxStep, step);
      // Never through a wall, and always facing the way it goes.
      expect(g.isWalkable(w.pose.x, w.pose.z)).toBe(true);
      if (step > 1e-4) {
        expect(Math.abs(angleDelta(w.pose.heading, headingOfTravel(dx, dz)))).toBeLessThan(
          Math.PI / 4 + 0.01,
        );
      }
      last = { x: w.pose.x, z: w.pose.z };
    });
    expect(Math.hypot(w.pose.x - 8.6, w.pose.z - 12.6)).toBeLessThan(0.2);
    expect(w.moving).toBe(false);
    expect(maxStep).toBeLessThan(2.4 / 60 + 1e-6);
    // Still: nothing to do per frame.
    expect(w.step(1 / 60)).toBe(false);
  });

  test("far behind, it runs, then slows to a walk to arrive", () => {
    const g = grid();
    const w = createBodyWalker();
    w.retarget(g, target(4, 13));
    w.retarget(g, target(38, 13));
    expect(w.remaining).toBeGreaterThan(OFFICE_AGENT_RUN_ABOVE);
    expect(w.running).toBe(true);
    walk(w, 12);
    expect(w.running).toBe(false);
    expect(Math.hypot(w.pose.x - 38, w.pose.z - 13)).toBeLessThan(0.2);
  });

  test("into a room this viewer cannot see into: to the door, then out of sight", () => {
    const g = grid(["shut"]);
    const w = createBodyWalker();
    w.retarget(g, target(20, 13));
    const door = { x: 28, z: 14 };
    w.retarget(g, target(28, 8, { door }));
    expect(w.hidden).toBe(false);
    walk(w, 8, () => expect(g.isWalkable(w.pose.x, w.pose.z)).toBe(true));
    expect(Math.hypot(w.pose.x - door.x, w.pose.z - door.z)).toBeLessThan(0.2);
    expect(w.hidden).toBe(true);
    // Sent back out: it shows again, at the door it went in by.
    w.retarget(g, target(20, 13));
    expect(w.hidden).toBe(false);
    expect(Math.hypot(w.pose.x - door.x, w.pose.z - door.z)).toBeLessThan(0.2);
  });

  test("a hop (a change of level) puts it there at once", () => {
    const g = grid();
    const w = createBodyWalker();
    w.retarget(g, target(8, 8));
    w.retarget(g, target(38, 13, { hop: 2 }));
    expect(w.pose.x).toBe(38);
    expect(w.moving).toBe(false);
  });

  test("a target in furniture or a wall is walked up to, not into", () => {
    const g = grid();
    const w = createBodyWalker();
    w.retarget(g, target(8, 8));
    // Just outside the room's west wall line.
    w.retarget(g, target(4.05, 8));
    walk(w, 5);
    expect(g.isWalkable(w.pose.x, w.pose.z)).toBe(true);
  });
});
