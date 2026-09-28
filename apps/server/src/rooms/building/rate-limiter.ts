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
