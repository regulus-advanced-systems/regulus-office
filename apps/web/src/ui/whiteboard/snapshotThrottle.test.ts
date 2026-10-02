import { describe, expect, test } from "bun:test";
import { createSnapshotThrottle } from "./snapshotThrottle.ts";

/** A fake clock with timers that fire on `advance`. */
function clock() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      seq += 1;
      timers.set(seq, { at: t + ms, fn });
      return seq;
    },
    clearTimer: (h: unknown) => {
      timers.delete(h as number);
    },
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        t = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        // Let the run's promise chain settle.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
      t = end;
    },
  };
}

function setup() {
  const c = clock();
  const runs: number[] = [];
  const throttle = createSnapshotThrottle({
    intervalMs: 2000,
    run: async () => {
      runs.push(c.now());
    },
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
  });
  return { c, runs, throttle };
}

describe("snapshot throttle", () => {
  test("the first change renders at once; a burst renders at most every 2 s", async () => {
    const { c, runs, throttle } = setup();
    throttle.poke();
    await c.advance(0);
    expect(runs).toEqual([0]);
    for (let i = 0; i < 30; i++) {
      throttle.poke();
      await c.advance(100);
    }
    // 3 s of changes after the first render: renders at 2 s, then 4 s for the tail.
    await c.advance(5000);
    expect(runs).toEqual([0, 2000, 4000]);
  });

  test("no change, no render", async () => {
    const { c, runs } = setup();
    await c.advance(10_000);
    expect(runs).toEqual([]);
  });

  test("flush renders a due snapshot now; cancel drops it", async () => {
    const { c, runs, throttle } = setup();
    throttle.poke();
    await c.advance(0);
    throttle.poke();
    expect(throttle.pending).toBe(true);
    await c.advance(500);
    await throttle.flush();
    expect(runs).toEqual([0, 500]);
    throttle.poke();
    throttle.cancel();
    await c.advance(5000);
    expect(runs).toEqual([0, 500]);
    expect(throttle.pending).toBe(false);
  });

  test("a change during a slow render is rendered after it", async () => {
    const c = clock();
    const runs: number[] = [];
    let release: () => void = () => {};
    const throttle = createSnapshotThrottle({
      intervalMs: 2000,
      run: () =>
        new Promise<void>((resolve) => {
          runs.push(c.now());
          release = resolve;
        }),
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
    });
    throttle.poke();
    await c.advance(0);
    throttle.poke();
    await c.advance(3000);
    expect(runs).toEqual([0]);
    release();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await c.advance(0);
    expect(runs).toEqual([0, 3000]);
  });
});
