import { describe, expect, test } from "bun:test";
import { RateLimiter } from "./rate-limiter.ts";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("RateLimiter", () => {
  test("accepts the first message and drops faster-than-limit repeats", () => {
    const c = clock();
    const limiter = new RateLimiter({ maxHz: 20, now: c.now, tolerance: 0 });
    expect(limiter.allow("a")).toBe(true);
    c.advance(10);
    expect(limiter.allow("a")).toBe(false);
    c.advance(40);
    expect(limiter.allow("a")).toBe(true);
  });

  test("keys are independent", () => {
    const c = clock();
    const limiter = new RateLimiter({ maxHz: 20, now: c.now, tolerance: 0 });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  test("a steady 20 Hz sender with jitter is never dropped; 40 Hz loses half", () => {
    const c = clock();
    const limiter = new RateLimiter({ maxHz: 20, now: c.now });
    let accepted = 0;
    for (let i = 0; i < 100; i++) {
      if (limiter.allow("a")) accepted++;
      c.advance(i % 2 === 0 ? 47 : 53);
    }
    expect(accepted).toBe(100);

    const fast = new RateLimiter({ maxHz: 20, now: c.now });
    let fastAccepted = 0;
    for (let i = 0; i < 100; i++) {
      if (fast.allow("a")) fastAccepted++;
      c.advance(25);
    }
    expect(fastAccepted).toBe(50);
  });

  test("forget clears a key", () => {
    const c = clock();
    const limiter = new RateLimiter({ maxHz: 20, now: c.now, tolerance: 0 });
    limiter.allow("a");
    expect(limiter.size).toBe(1);
    limiter.forget("a");
    expect(limiter.size).toBe(0);
    expect(limiter.allow("a")).toBe(true);
  });

  test("rejects a non-positive rate", () => {
    expect(() => new RateLimiter({ maxHz: 0 })).toThrow();
  });
});
