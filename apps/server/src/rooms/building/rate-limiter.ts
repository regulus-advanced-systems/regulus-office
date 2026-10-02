/**
 * Per-client message rate limiter used for `move` (SPEC §6: positions at
 * 10-20 Hz from clients). Updates faster than the limit are dropped, not
 * queued: a position update that arrives 5 ms after the last one carries
 * nothing the next one will not.
 */

export interface RateLimiterOptions {
  /** Maximum accepted messages per second per key. */
  maxHz: number;
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number;
  /**
   * Fraction of the minimum interval tolerated early, so a client sending at
   * exactly `maxHz` with jitter is not dropped every other message. Default 0.1.
   */
  tolerance?: number;
}

export class RateLimiter {
  readonly #minIntervalMs: number;
  readonly #now: () => number;
  readonly #last = new Map<string, number>();

  constructor(options: RateLimiterOptions) {
    if (!(options.maxHz > 0)) throw new Error("maxHz must be positive");
    const tolerance = options.tolerance ?? 0.1;
    this.#minIntervalMs = (1000 / options.maxHz) * (1 - tolerance);
    this.#now = options.now ?? (() => performance.now());
  }

  /** True when a message for `key` is accepted now; records the acceptance. */
  allow(key: string): boolean {
    const now = this.#now();
    const last = this.#last.get(key);
    if (last !== undefined && now - last < this.#minIntervalMs) return false;
    this.#last.set(key, now);
    return true;
  }

  /** Drop the bookkeeping for a key (client left). */
  forget(key: string): void {
    this.#last.delete(key);
  }

  get size(): number {
    return this.#last.size;
  }
}

export interface TokenBucketOptions {
  /** Messages a key may send at once. */
  burst: number;
  /** One message is refilled per this many milliseconds. */
  refillMs: number;
  now?: () => number;
}

/**
 * Per-key token bucket (chat, #49): a short burst is fine, a sustained flood
 * is refused. Unlike `RateLimiter` the caller tells the sender it was refused.
 */
export class TokenBucket {
  readonly #burst: number;
  readonly #refillMs: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, { tokens: number; at: number }>();

  constructor(options: TokenBucketOptions) {
    if (!(options.burst >= 1) || !(options.refillMs > 0)) throw new Error("bad token bucket");
    this.#burst = options.burst;
    this.#refillMs = options.refillMs;
    this.#now = options.now ?? (() => performance.now());
  }

  /** Take a token for `key`; false when none is left. */
  take(key: string): boolean {
    const now = this.#now();
    const b = this.#buckets.get(key) ?? { tokens: this.#burst, at: now };
    b.tokens = Math.min(this.#burst, b.tokens + (now - b.at) / this.#refillMs);
    b.at = now;
    this.#buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  forget(key: string): void {
    this.#buckets.delete(key);
  }
}
