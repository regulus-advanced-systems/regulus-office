import { describe, expect, test } from "bun:test";
import { clientIp, rateLimited, TokenBucketLimiter } from "./rate-limit.ts";

describe("TokenBucketLimiter", () => {
  test("allows a burst, then refills at the configured rate", () => {
    let now = 0;
    const limiter = new TokenBucketLimiter({ capacity: 3, refillPerSecond: 0.5 }, () => now);
    expect(limiter.take("a")).toEqual({ ok: true });
    expect(limiter.take("a")).toEqual({ ok: true });
    expect(limiter.take("a")).toEqual({ ok: true });
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterSeconds: 2 });
    now += 1000;
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterSeconds: 1 });
    now += 1000;
    expect(limiter.take("a")).toEqual({ ok: true });
    now += 60_000;
    for (let i = 0; i < 3; i++) expect(limiter.take("a").ok).toBe(true);
    expect(limiter.take("a").ok).toBe(false);
  });

  test("keys are independent and reset() forgets them", () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 1 }, () => 0);
    expect(limiter.take("a").ok).toBe(true);
    expect(limiter.take("b").ok).toBe(true);
    expect(limiter.take("a").ok).toBe(false);
    limiter.reset();
    expect(limiter.take("a").ok).toBe(true);
  });

  test("drops idle full buckets once the table grows large", () => {
    let now = 0;
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 1 }, () => now);
    for (let i = 0; i < 10_000; i++) limiter.take(`k${i}`);
    expect(limiter.size).toBe(10_000);
    now += 5000;
    limiter.take("fresh");
    expect(limiter.size).toBe(1);
  });

  test("rejects nonsense rules", () => {
    expect(() => new TokenBucketLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0 })).toThrow();
  });
});

describe("clientIp", () => {
  const withHeaders = (h: Record<string, string>) => new Request("http://x/", { headers: h });
  test("prefers the first forwarded hop, then x-real-ip, else 'direct'", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "203.0.113.1, 10.0.0.2" }))).toBe(
      "203.0.113.1",
    );
    expect(clientIp(withHeaders({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(withHeaders({}))).toBe("direct");
  });
});

describe("rateLimited", () => {
  test("answers 429 with retry-after once the bucket is empty", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0.1 }, () => 0);
    const handler = rateLimited(
      limiter,
      "login",
      () => new Response("ok"),
      () => "ip",
    );
    const ctx = { request: new Request("http://x/"), url: new URL("http://x/"), params: {} };
    expect((await handler(ctx)).status).toBe(200);
    const blocked = await handler(ctx);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("10");
  });
});
