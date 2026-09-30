import { describe, expect, test } from "bun:test";
import {
  ARRIVE_RADIUS,
  JUMP_TIMEOUT_MS,
  type JumpProgress,
  type JumpTarget,
  type JumpWorld,
  nextJumpStep,
  WALK_TIMEOUT_MS,
} from "./jump.ts";

const target: JumpTarget = { agentId: "a1", floorId: "f1", docId: 7, query: "q", startedAt: 0 };
const world = (over: Partial<JumpWorld> = {}): JumpWorld => ({
  now: 1000,
  floorId: "f1",
  floorLoaded: true,
  playerReady: true,
  player: { x: 0, z: 0 },
  walking: false,
  seat: { x: 10, z: 0 },
  ...over,
});
const fresh = (): JumpProgress => ({ rode: false, walkingSince: null });

describe("nextJumpStep", () => {
  test("another floor: quick travel once, then wait", () => {
    expect(nextJumpStep(target, world({ floorId: "lobby" }), fresh())).toEqual({ kind: "ride" });
    expect(
      nextJumpStep(target, world({ floorId: "lobby" }), { rode: true, walkingSince: null }),
    ).toEqual({ kind: "wait" });
  });

  test("waits for the floor state and the respawn", () => {
    expect(nextJumpStep(target, world({ floorLoaded: false }), fresh()).kind).toBe("wait");
    expect(nextJumpStep(target, world({ playerReady: false }), fresh()).kind).toBe("wait");
  });

  test("walks to the desk, then opens once there", () => {
    expect(nextJumpStep(target, world(), fresh())).toEqual({ kind: "walk", to: { x: 10, z: 0 } });
    const walking = { rode: false, walkingSince: 1000 };
    expect(nextJumpStep(target, world({ walking: true, now: 2000 }), walking).kind).toBe("wait");
    const there = world({ player: { x: 10 - ARRIVE_RADIUS + 0.1, z: 0 }, walking: true });
    expect(nextJumpStep(target, there, walking).kind).toBe("open");
  });

  test("already at the desk: open at once", () => {
    expect(nextJumpStep(target, world({ player: { x: 9.5, z: 0 } }), fresh()).kind).toBe("open");
  });

  test("a walk that ends short or stalls still opens the terminal", () => {
    const walking = { rode: false, walkingSince: 1000 };
    expect(nextJumpStep(target, world({ walking: false }), walking).kind).toBe("open");
    const late = world({ walking: true, now: 1000 + WALK_TIMEOUT_MS + 1 });
    expect(nextJumpStep(target, late, walking).kind).toBe("open");
  });

  test("no desk in the template: open without walking", () => {
    expect(nextJumpStep(target, world({ seat: null }), fresh()).kind).toBe("open");
  });

  test("gives up when the floor never loads", () => {
    const late = world({ floorId: "lobby", now: JUMP_TIMEOUT_MS + 1 });
    expect(nextJumpStep(target, late, { rode: true, walkingSince: null }).kind).toBe("give_up");
    expect(nextJumpStep(target, world({ now: JUMP_TIMEOUT_MS + 1 }), fresh()).kind).toBe("open");
  });
});
