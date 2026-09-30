/**
 * Rate limit for banging the merge gong by hand (#43). Two rules, both
 * checked before anything is broadcast:
 *
 * - per floor: no bang while the gong still rings from any cause (a merge, a
 *   bang or the queue emptying): `floorCooldownMs` after the last ring;
 * - per human: a token bucket (`burst` bangs, then one every `refillMs`), so
 *   one person cannot keep a floor dancing by waiting out the floor cooldown.
 *
 * Pure apart from the injected clock; the maps are pruned as they are used,
 * so they stay as small as the set of recently active floors and humans.
 */

export interface BangLimits {
  floorCooldownMs: number;
  burst: number;
  refillMs: number;
}

export const DEFAULT_BANG_LIMITS: Readonly<BangLimits> = {
  // The celebration lasts about 3 s; let it finish before the next one.
  floorCooldownMs: 4_000,
  burst: 3,
  refillMs: 20_000,
};

export type BangVerdict = { ok: true } | { ok: false; reason: string };

export const GONG_STILL_RINGING = "The gong is still ringing.";
export const GONG_REST = "Give the gong a rest for a moment.";

interface Bucket {
  tokens: number;
  at: number;
}

export class BangLimiter {
  readonly #limits: BangLimits;
  readonly #now: () => number;
  readonly #rungAt = new Map<string, number>();
  readonly #buckets = new Map<string, Bucket>();

  constructor(limits: Partial<BangLimits> = {}, now: () => number = Date.now) {
    this.#limits = { ...DEFAULT_BANG_LIMITS, ...limits };
    this.#now = now;
  }

  /** The gong on `floorId` rang now (any cause): bangs wait for the cooldown. */
  rang(floorId: string): void {
    this.#rungAt.set(floorId, this.#now());
  }

  /** May `userId` bang the gong on `floorId` now? Records the bang when allowed. */
  bang(floorId: string, userId: string): BangVerdict {
    const now = this.#now();
    this.#prune(now);
    const last = this.#rungAt.get(floorId);
    if (last !== undefined && now - last < this.#limits.floorCooldownMs) {
      return { ok: false, reason: GONG_STILL_RINGING };
    }
    const bucket = this.#refilled(userId, now);
    if (bucket.tokens < 1) return { ok: false, reason: GONG_REST };
    bucket.tokens -= 1;
    this.#buckets.set(userId, bucket);
    this.#rungAt.set(floorId, now);
    return { ok: true };
  }

  #refilled(userId: string, now: number): Bucket {
    const { burst, refillMs } = this.#limits;
    const bucket = this.#buckets.get(userId) ?? { tokens: burst, at: now };
    const earned = Math.floor((now - bucket.at) / refillMs);
    if (earned > 0) {
      bucket.tokens = Math.min(burst, bucket.tokens + earned);
      bucket.at = bucket.tokens >= burst ? now : bucket.at + earned * refillMs;
    }
    return bucket;
  }

  #prune(now: number): void {
    const { floorCooldownMs, burst, refillMs } = this.#limits;
    for (const [floorId, at] of this.#rungAt) {
      if (now - at >= floorCooldownMs) this.#rungAt.delete(floorId);
    }
    for (const [userId, bucket] of this.#buckets) {
      if (now - bucket.at >= burst * refillMs) this.#buckets.delete(userId);
    }
  }
}
