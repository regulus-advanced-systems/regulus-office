/**
 * Exponential backoff with symmetric jitter, used for room re-joins.
 * Pure: the random source is injectable so schedules are testable.
 */
export interface BackoffOptions {
  /** Delay for attempt 0, in ms. */
  baseMs: number;
  /** Upper bound for the un-jittered delay. */
  maxMs: number;
  /** Growth factor per attempt. */
  factor: number;
  /** Jitter as a fraction of the delay, in [0, 1]: 0.3 means +/-30 %. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 500,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.3,
};

/** Delay before retry number `attempt` (0-based). Never negative, never above `maxMs * (1 + jitter)`. */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const n = Math.max(0, Math.floor(attempt));
  const raw = Math.min(options.maxMs, options.baseMs * options.factor ** n);
  const spread = raw * options.jitter * (2 * random() - 1);
  return Math.max(0, Math.round(raw + spread));
}

/** First `count` delays of the schedule; handy for tests and diagnostics. */
export function backoffSchedule(
  count: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number[] {
  return Array.from({ length: count }, (_, i) => backoffDelay(i, options, random));
}
