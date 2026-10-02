import { describe, expect, test } from "bun:test";
import { ClockEstimator, clockSample } from "./clock-sync.ts";

/** A ping through a link with `up`/`down` ms each way to a server `skew` ms ahead. */
function ping(t0: number, skew: number, up: number, down: number, serverMs = 1) {
  const t1 = t0 + up + skew;
  const t2 = t1 + serverMs;
  const t3 = t2 - skew + down;
  return clockSample(t0, t1, t2, t3);
}

describe("clockSample", () => {
  test("a symmetric link gives the exact offset and the wire time", () => {
    const s = ping(1_000, 5_000, 20, 20);
    expect(s?.offset).toBe(5_000);
    expect(s?.rtt).toBe(40);
  });

  test("an asymmetric link errs by half the asymmetry, never more than rtt / 2", () => {
    const s = ping(1_000, -250, 10, 50);
    expect(s?.rtt).toBe(60);
    expect(Math.abs((s?.offset ?? 0) - -250)).toBe(20);
    expect(Math.abs((s?.offset ?? 0) - -250)).toBeLessThanOrEqual((s?.rtt ?? 0) / 2);
  });

  test("inconsistent timestamps are dropped", () => {
    expect(clockSample(100, 50, 40, 120)).toBeNull();
    expect(clockSample(100, 500, 600, 150)).toBeNull();
  });
});

describe("ClockEstimator", () => {
  test("nothing before the first sample", () => {
    expect(new ClockEstimator().estimate()).toBeNull();
  });

  test("trusts the lowest round trips: congested pings cannot pull the offset", () => {
    const clock = new ClockEstimator(12, 3);
    clock.add(ping(0, 1_000, 5, 5));
    clock.add(ping(100, 1_000, 6, 4));
    clock.add(ping(200, 1_000, 4, 6));
    // Badly asymmetric, slow round trips (a busy uplink): 200 ms off each.
    for (let i = 0; i < 6; i++) clock.add(ping(300 + i * 100, 1_000, 420, 20));
    const est = clock.estimate();
    expect(est).not.toBeNull();
    expect(Math.abs((est?.offset ?? 0) - 1_000)).toBeLessThanOrEqual(1);
    expect(est?.error).toBe(5);
  });

  test("a single lucky outlier does not move the median", () => {
    const clock = new ClockEstimator(12, 3);
    clock.add(ping(0, 2_000, 10, 10));
    clock.add(ping(10, 2_000, 9, 9));
    clock.add({ offset: 9_999, rtt: 1, at: 20 });
    expect(clock.estimate()?.offset).toBe(2_000);
  });

  test("keeps only the window", () => {
    const clock = new ClockEstimator(4, 2);
    for (let i = 0; i < 10; i++) clock.add(ping(i * 10, 300, 5, 5));
    expect(clock.size).toBe(4);
    clock.reset();
    expect(clock.size).toBe(0);
  });
});
