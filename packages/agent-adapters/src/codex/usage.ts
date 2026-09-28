/**
 * Usage and plan-limit mapping for Codex (SPEC §7 "Usage / limits").
 *
 * - `thread/tokenUsage/updated` → `UsageSample` (in-band, per model request).
 * - `account/rateLimits/read` result and `account/rateLimits/updated` →
 *   `LimitSample`s, one per recognised window.
 */
import type { LimitSample, LimitWindowKind, UsageSample } from "@regulus/protocol";
import type {
  GetAccountRateLimitsResponse,
  RateLimitSnapshot,
  RateLimitWindow,
  ThreadTokenUsage,
} from "./generated/v2/index.ts";

const MINUTE = 1;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Window length → the protocol's window kinds. Codex reports the length in
 * minutes (`windowDurationMins`); ChatGPT plans use a five-hour and a weekly
 * window. Anything else (e.g. short test windows) has no kind and is dropped.
 */
export function windowKind(mins: number | null): LimitWindowKind | null {
  if (mins === null || !Number.isFinite(mins)) return null;
  if (mins >= 4 * HOUR && mins <= 6 * HOUR) return "five_hour";
  if (mins >= 6 * DAY && mins <= 8 * DAY) return "seven_day";
  if (mins >= 28 * DAY && mins <= 31 * DAY) return "monthly";
  return null;
}

/** The default Codex bucket; other metered buckets would collide on window kind. */
function isDefaultBucket(snapshot: RateLimitSnapshot): boolean {
  return (
    snapshot.limitId === null || snapshot.limitId === undefined || snapshot.limitId === "codex"
  );
}

function sample(
  window: RateLimitWindow | null | undefined,
  observedAt: number,
): LimitSample | null {
  if (!window) return null;
  const kind = windowKind(window.windowDurationMins);
  if (!kind || !Number.isFinite(window.usedPercent)) return null;
  const out: LimitSample = {
    windowKind: kind,
    usedPct: Math.min(100, Math.max(0, window.usedPercent)),
    observedAt,
    source: "inband",
  };
  // `resetsAt` is Unix seconds on the wire.
  if (typeof window.resetsAt === "number") out.resetsAt = window.resetsAt * 1000;
  return out;
}

/**
 * Samples for one snapshot. `account/rateLimits/updated` is sparse (fields
 * may be absent), so missing windows simply produce no sample.
 */
export function limitSamples(
  snapshot: Partial<RateLimitSnapshot> | null | undefined,
  observedAt: number,
): LimitSample[] {
  if (!snapshot || !isDefaultBucket(snapshot as RateLimitSnapshot)) return [];
  return [sample(snapshot.primary, observedAt), sample(snapshot.secondary, observedAt)].filter(
    (s): s is LimitSample => s !== null,
  );
}

/** Samples from an `account/rateLimits/read` result. */
export function limitSamplesFromRead(
  result: GetAccountRateLimitsResponse,
  observedAt: number,
): LimitSample[] {
  const snapshot = result.rateLimitsByLimitId?.codex ?? result.rateLimits;
  return limitSamples(snapshot, observedAt);
}

const count = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;

/**
 * Tracks cumulative thread usage so repeated notifications for the same
 * request are not counted twice. Emits the `last` breakdown (usage of the most
 * recent model request) whenever the thread total grows.
 *
 * OpenAI counts cached input inside `inputTokens`; the protocol's
 * `inputTokens` excludes cache reads, so the cached part is split out.
 */
export class TokenUsageTracker {
  #lastTotal = -1;

  next(usage: ThreadTokenUsage, ts: number): UsageSample | null {
    const total = count(usage.total?.totalTokens);
    if (total <= this.#lastTotal) return null;
    this.#lastTotal = total;
    const last = usage.last;
    if (!last) return null;
    const cached = count(last.cachedInputTokens);
    return {
      ts,
      inputTokens: Math.max(0, count(last.inputTokens) - cached),
      outputTokens: count(last.outputTokens),
      cacheReadTokens: cached,
      cacheWriteTokens: count(last.cacheWriteInputTokens),
      source: "inband",
    };
  }
}
