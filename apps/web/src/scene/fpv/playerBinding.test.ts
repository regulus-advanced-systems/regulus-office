import { describe, expect, test } from "bun:test";
import { HEADING } from "@regulus/room-layout";
import { createPlayerStore } from "../../state/player.ts";
import { createPlayerBinding } from "./playerBinding.ts";

function setup() {
  const store = createPlayerStore();
  store.getState().spawnAt({ x: 5, z: 5, heading: HEADING.south });
  return { store, binding: createPlayerBinding(store) };
}

describe("first-person player binding", () => {
  test("getPose reads the live store pose", () => {
    const { store, binding } = setup();
    expect(binding.getPose()).toMatchObject({ x: 5, z: 5, heading: HEADING.south });
    store.getState().setPose(6, 7, 1);
    expect(binding.getPose()).toMatchObject({ x: 6, z: 7, heading: 1 });
  });

  test("a step moves the avatar, plays walk and faces the camera yaw", () => {
    const { store, binding } = setup();
    binding.onMove(0.1, 0, 0.05, HEADING.north);
    const s = store.getState();
    expect(s.x).toBeGreaterThan(5);
    expect(s.z).toBe(5);
    expect(s.animation).toBe("walk");
    expect(s.distanceWalked).toBeGreaterThan(0);
    expect(s.heading).toBe(HEADING.north);
  });

  test("standing still settles to idle and still follows the yaw", () => {
    const { store, binding } = setup();
    binding.onMove(0.1, 0, 0.05, 0);
    binding.onMove(0, 0, 0.05, 0.7);
    const s = store.getState();
    expect(s.animation).toBe("idle");
    expect(s.heading).toBe(0.7);
  });

  test("an unchanged yaw does not touch the store", () => {
    const { store, binding } = setup();
    binding.onMove(0, 0, 0.05, HEADING.south);
    const before = store.getState();
    binding.onMove(0, 0, 0.05, HEADING.south);
    expect(store.getState()).toBe(before);
  });

  test("entering first person drops a pending click-to-walk target", () => {
    const { store, binding } = setup();
    store.getState().setTarget(9, 9);
    expect(store.getState().target).not.toBeNull();
    binding.onMove(0, 0, 0.05, HEADING.south);
    expect(store.getState().target).toBeNull();
    expect(store.getState().path).toBeNull();
  });
});
