/** Running (#223): which speed the player store moves at, and when it drops back to a walk. */
import { describe, expect, test } from "bun:test";
import { HEADING } from "@regulus/room-layout";
import { RUN_SPEED, WALK_SPEED } from "../scene/movement/kinematics.ts";
import { createPlayerStore } from "./player.ts";

/** Open ground, facing east toward the targets so no turn-in-place time is spent. */
function store() {
  const s = createPlayerStore();
  s.getState().spawnAt({ x: 0, z: 0, heading: HEADING.east });
  return s;
}

const dt = 0.1;

describe("player running", () => {
  test("run speed is about 2.2 times the walk", () => {
    expect(RUN_SPEED / WALK_SPEED).toBeCloseTo(2.2);
    expect(RUN_SPEED).toBeCloseTo(5.28);
  });

  test("a single click walks; holding Shift runs the same path", () => {
    const s = store();
    s.getState().setTarget(20, 0);
    s.getState().advance(dt);
    expect(s.getState().x).toBeCloseTo(WALK_SPEED * dt);
    expect(s.getState().gait).toBe("walk");
    s.getState().advance(dt, true);
    expect(s.getState().x).toBeCloseTo(WALK_SPEED * dt + RUN_SPEED * dt);
    expect(s.getState().gait).toBe("run");
    expect(s.getState().animation).toBe("walk");
  });

  test("releasing Shift mid-path drops back to a walk", () => {
    const s = store();
    s.getState().setTarget(20, 0);
    s.getState().advance(dt, true);
    const x = s.getState().x;
    s.getState().advance(dt, false);
    expect(s.getState().x - x).toBeCloseTo(WALK_SPEED * dt);
    expect(s.getState().gait).toBe("walk");
    expect(s.getState().path).not.toBeNull();
  });

  test("a double-click target runs without Shift until the path ends", () => {
    const s = store();
    s.getState().setTarget(2, 0); // the pair's first click: walking
    s.getState().advance(dt);
    s.getState().setTarget(2, 0, true); // the double-click upgrades the same spot
    expect(s.getState().pathRun).toBe(true);
    const x = s.getState().x;
    s.getState().advance(dt);
    expect(s.getState().x - x).toBeCloseTo(RUN_SPEED * dt);
    expect(s.getState().gait).toBe("run");
    for (let i = 0; i < 20; i++) s.getState().advance(dt);
    expect(s.getState()).toMatchObject({ x: 2, path: null, pathRun: false, animation: "idle" });
    expect(s.getState().gait).toBe("walk");
  });

  test("a new single click replaces a run with a walk", () => {
    const s = store();
    s.getState().setTarget(20, 0, true);
    s.getState().advance(dt);
    s.getState().setTarget(20, 1);
    expect(s.getState().pathRun).toBe(false);
  });

  test("WASD input replaces a run path; Shift sets the WASD pace", () => {
    const s = store();
    s.getState().setTarget(20, 0, true);
    s.getState().applyInput(1, 0, dt);
    expect(s.getState()).toMatchObject({ path: null, pathRun: false, gait: "walk" });
    expect(s.getState().x).toBeCloseTo(WALK_SPEED * dt);
    s.getState().applyInput(1, 0, dt, RUN_SPEED);
    expect(s.getState().x).toBeCloseTo(WALK_SPEED * dt + RUN_SPEED * dt);
    expect(s.getState().gait).toBe("run");
  });

  test("an unreachable double-click clears the run", () => {
    const s = store();
    s.getState().setNavigation({ walkable: () => true, plan: () => null });
    expect(s.getState().setTarget(5, 5, true)).toBe(false);
    expect(s.getState().pathRun).toBe(false);
  });
});
