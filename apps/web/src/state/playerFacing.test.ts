/**
 * #119: in third person the standing player turns toward the cursor at the
 * turn rate, faces its travel while walking, turns back to the cursor on
 * arrival, and each heading-only change is relayed through the move throttle.
 */
import { describe, expect, test } from "bun:test";
import { HEADING } from "@regulus/room-layout";
import { angleDelta, headingOfTravel, type Pose, TURN_RATE } from "../scene/movement/kinematics.ts";
import { createMoveThrottle } from "../scene/movement/moveThrottle.ts";
import { createPlayerStore } from "./player.ts";

const FRAME = 1 / 60;

function standing(heading = HEADING.south) {
  const store = createPlayerStore();
  store.getState().spawnAt({ x: 5, z: 5, heading });
  return store;
}

describe("facing the cursor", () => {
  test("turns toward the cursor no faster than the turn rate, then holds", () => {
    const store = standing(HEADING.south);
    store.getState().faceToward(5, 1, 0.1); // cursor due north: a half turn away
    expect(Math.abs(angleDelta(HEADING.south, store.getState().heading))).toBeCloseTo(
      TURN_RATE * 0.1,
    );
    for (let i = 0; i < 60; i++) store.getState().faceToward(5, 1, FRAME);
    expect(store.getState().heading).toBeCloseTo(HEADING.north);
    expect(store.getState()).toMatchObject({ x: 5, z: 5, animation: "idle" });
  });

  test("a cursor at the henchman's feet leaves the heading alone", () => {
    const store = standing(HEADING.east);
    store.getState().faceToward(5.1, 5.1, 1);
    expect(store.getState().heading).toBe(HEADING.east);
  });

  test("while walking a path the henchman faces its travel, not the cursor", () => {
    const store = standing(HEADING.west);
    store.getState().setTarget(9, 5); // due east, behind the henchman
    for (let i = 0; i < 30; i++) {
      store.getState().advance(FRAME);
      store.getState().faceToward(5, 9, FRAME); // cursor to the south: ignored while walking
    }
    const s = store.getState();
    expect(s.x).toBeGreaterThan(5.5);
    expect(s.heading).toBeCloseTo(headingOfTravel(1, 0));
  });

  test("turns on the spot before walking a click path face-first", () => {
    const store = standing(HEADING.west);
    store.getState().setTarget(9, 5);
    const poses: Pose[] = [];
    for (let i = 0; i < 40; i++) {
      store.getState().advance(FRAME);
      const s = store.getState();
      poses.push({ x: s.x, z: s.z, heading: s.heading });
    }
    const firstStep = poses.findIndex((p) => p.x > 5);
    expect(firstStep).toBeGreaterThan(0); // a few frames of turning first
    for (const p of poses.slice(firstStep)) {
      expect(Math.abs(angleDelta(p.heading, HEADING.east))).toBeLessThanOrEqual(Math.PI / 4 + 1e-9);
    }
  });

  test("on arrival it turns back toward the cursor", () => {
    const store = standing(HEADING.south);
    store.getState().setTarget(8, 5);
    for (let i = 0; i < 200 && store.getState().path; i++) store.getState().advance(FRAME);
    expect(store.getState().x).toBeCloseTo(8);
    expect(store.getState().heading).toBeCloseTo(HEADING.east);
    for (let i = 0; i < 60; i++) store.getState().faceToward(8, 1, FRAME); // cursor north
    expect(store.getState().heading).toBeCloseTo(HEADING.north);
  });

  test("heading-only changes are sent through the throttle at no more than 20 Hz", () => {
    const store = standing(HEADING.south);
    let now = 0;
    const sent: Pose[] = [];
    const throttle = createMoveThrottle({ now: () => now, send: (p) => sent.push(p) });
    throttle.update(store.getState());
    throttle.tick();
    sent.length = 0;
    for (let i = 0; i < 30; i++) {
      now += 1000 * FRAME;
      store.getState().faceToward(5, 1, FRAME); // cursor north: a half turn
      throttle.update(store.getState());
      throttle.tick();
    }
    now += 1000;
    throttle.tick();
    expect(sent.length).toBeGreaterThan(2);
    expect(sent.length).toBeLessThanOrEqual(Math.ceil(0.5 * 20) + 1);
    for (const p of sent) expect(p).toMatchObject({ x: 5, z: 5 });
    expect(sent.at(-1)?.heading).toBeCloseTo(HEADING.north);
    // Settled: facing the same cursor sends nothing more.
    store.getState().faceToward(5, 1, FRAME);
    throttle.update(store.getState());
    now += 1000;
    expect(throttle.tick()).toBe(false);
  });
});
