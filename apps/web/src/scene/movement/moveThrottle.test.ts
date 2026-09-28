import { describe, expect, test } from "bun:test";
import type { Pose } from "./kinematics.ts";
import { createMoveThrottle, samePose } from "./moveThrottle.ts";

function harness(hz = 20) {
  let now = 0;
  const sent: Pose[] = [];
  const throttle = createMoveThrottle({ hz, now: () => now, send: (p) => sent.push(p) });
  return { throttle, sent, advance: (ms: number) => (now += ms) };
}

describe("move throttle", () => {
  test("sends a changed pose at most 20 times per second", () => {
    const h = harness();
    h.throttle.update({ x: 1, z: 1, heading: 0 });
    expect(h.throttle.tick()).toBe(true);
    for (let i = 1; i <= 10; i++) {
      h.advance(16);
      h.throttle.update({ x: 1 + i, z: 1, heading: 0 });
      h.throttle.tick();
    }
    // Ticks every 16 ms: sends land at t=0, 64 and 128 (>= 50 ms apart), never faster.
    expect(h.sent.length).toBe(3);
    expect(h.sent.at(-1)).toEqual({ x: 9, z: 1, heading: 0 });
    h.advance(50);
    expect(h.throttle.tick()).toBe(true); // the newest pose follows once the cool-down ends
    expect(h.sent.at(-1)).toEqual({ x: 11, z: 1, heading: 0 });
  });

  test("does not send when the pose is unchanged", () => {
    const h = harness();
    h.throttle.update({ x: 2, z: 3, heading: 1 });
    h.throttle.tick();
    h.advance(1000);
    h.throttle.update({ x: 2, z: 3, heading: 1 });
    expect(h.throttle.tick()).toBe(false);
    expect(h.sent.length).toBe(1);
  });

  test("a change inside the cool-down is sent at the next opportunity (final pose survives)", () => {
    const h = harness();
    h.throttle.update({ x: 0, z: 0, heading: 0 });
    h.throttle.tick();
    h.advance(10);
    h.throttle.update({ x: 0.5, z: 0, heading: 0 });
    expect(h.throttle.tick()).toBe(false);
    h.advance(40);
    expect(h.throttle.tick()).toBe(true);
    expect(h.sent.at(-1)).toEqual({ x: 0.5, z: 0, heading: 0 });
  });

  test("reset re-sends the current pose after a reconnect", () => {
    const h = harness();
    h.throttle.update({ x: 4, z: 4, heading: 0 });
    h.throttle.tick();
    h.throttle.reset();
    h.throttle.update({ x: 4, z: 4, heading: 0 });
    expect(h.throttle.tick()).toBe(true);
    expect(h.sent.length).toBe(2);
  });

  test("samePose tolerates float noise", () => {
    expect(samePose({ x: 1, z: 1, heading: 0 }, { x: 1 + 1e-9, z: 1, heading: 0 })).toBe(true);
    expect(samePose({ x: 1, z: 1, heading: 0 }, { x: 1.01, z: 1, heading: 0 })).toBe(false);
    expect(samePose(null, { x: 1, z: 1, heading: 0 })).toBe(false);
  });
});
