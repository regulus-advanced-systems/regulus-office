/**
 * In-memory token-bucket rate limiting for the auth endpoints (SPEC §11
 * "rate limits on auth"). Keyed by client IP + route class. Good enough for
 * the single office-server process of M0; a shared store would be needed only
 * if the server were ever scaled out.
 */
import { json, type RouteContext, type RouteHandler } from "../http/router.ts";

export interface RateLimitRule {
  /** Burst size: requests allowed instantly from a fresh bucket. */
  capacity: number;
  /** Sustained rate at which tokens come back. */
  refillPerSecond: number;
}

export type RateLimitDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Buckets are dropped once they are full again; this bounds memory under a key flood. */
const SWEEP_ABOVE = 10_000;

export class TokenBucketLimiter {
  readonly #rule: RateLimitRule;
  readonly #now: () => number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(rule: RateLimitRule, now: () => number = Date.now) {
    if (rule.capacity < 1 || rule.refillPerSecond <= 0) {
      throw new Error("rate limit rule needs capacity >= 1 and refillPerSecond > 0");
    }
    this.#rule = rule;
    this.#now = now;
  }

  get size(): number {
    return this.#buckets.size;
  }

  /** Spend one token for `key`, or say how long until one is available. */
  take(key: string): RateLimitDecision {
    const now = this.#now();
    const bucket = this.#refill(key, now);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((1 - bucket.tokens) / this.#rule.refillPerSecond),
    );
    return { ok: false, retryAfterSeconds };
  }

  /** Forget every bucket (tests). */
  reset(): void {
    this.#buckets.clear();
  }

  #refill(key: string, now: number): Bucket {
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      if (this.#buckets.size >= SWEEP_ABOVE) this.#sweep(now);
      bucket = { tokens: this.#rule.capacity, updatedAt: now };
      this.#buckets.set(key, bucket);
      return bucket;
    }
    const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(
      this.#rule.capacity,
      bucket.tokens + elapsedSeconds * this.#rule.refillPerSecond,
    );
    bucket.updatedAt = now;
    return bucket;
  }

  #sweep(now: number): void {
    const fullAfterMs = (this.#rule.capacity / this.#rule.refillPerSecond) * 1000;
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.updatedAt >= fullAfterMs) this.#buckets.delete(key);
    }
  }
}

/**
 * Best-effort client address. Caddy (deploy/) sets `x-forwarded-for`; without
 * a proxy every direct client shares one bucket, which is still a working
 * brute-force brake for a self-hosted office.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = request.headers.get("x-real-ip")?.trim();
  return real && real.length > 0 ? real : "direct";
}

export function rateLimitedResponse(decision: { retryAfterSeconds: number }): Response {
  return json(
    { error: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds },
    { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
  );
}

/** Wrap a route so each `${ip}:${routeClass}` bucket must have a token before the handler runs. */
export function rateLimited(
  limiter: TokenBucketLimiter,
  routeClass: string,
  handler: RouteHandler,
  ipOf: (request: Request) => string = clientIp,
): RouteHandler {
  return (ctx: RouteContext) => {
    const decision = limiter.take(`${ipOf(ctx.request)}:${routeClass}`);
    if (!decision.ok) return rateLimitedResponse(decision);
    return handler(ctx);
  };
}
