/**
 * Usage tracker (SPEC §5 `usage_samples` / `usage_limits`, §9.4 usage wall,
 * D13; issue #40): the viewer's own part.
 *
 * Office totals and the top henchmen (henchman name and owner only) are shared
 * BuildingRoom state (`BuildingState.usage`). A human's plan limits and spend
 * are private: each human reads only their own, over REST, and the server
 * takes the viewer from the session. Usage is shown only; nothing is
 * enforced (D13).
 */
import { z } from "zod";
import { Count, TimestampMs } from "./common.ts";
import { LIMIT_WINDOW_KINDS, PROVIDER_IDS, USAGE_SOURCES } from "./enums.ts";

/** GET: the signed-in viewer's own usage. Query `tz` = `Date#getTimezoneOffset()`. */
export const MY_USAGE_API_PATH = "/api/usage/me";

/** How many henchmen the usage wall's leaderboard shows. */
export const USAGE_TOP_HENCHMEN = 5;

export const UsageTotals = z.object({
  inputTokens: Count,
  outputTokens: Count,
  cacheReadTokens: Count,
  cacheWriteTokens: Count,
  /** Estimate in USD (provider-reported cost, else the office's price table). */
  costUsd: z.number().nonnegative(),
});
export type UsageTotals = z.infer<typeof UsageTotals>;

export const UsageLimitView = z.object({
  provider: z.enum(PROVIDER_IDS),
  windowKind: z.enum(LIMIT_WINDOW_KINDS),
  usedPct: z.number().min(0).max(100),
  resetsAt: TimestampMs.optional(),
  observedAt: TimestampMs,
  source: z.enum(USAGE_SOURCES),
  /** The window has reset since it was observed; `usedPct` then reads 0. */
  reset: z.boolean(),
});
export type UsageLimitView = z.infer<typeof UsageLimitView>;

export const ProviderUsage = UsageTotals.extend({ provider: z.enum(PROVIDER_IDS) });
export type ProviderUsage = z.infer<typeof ProviderUsage>;

export const MyUsage = z.object({
  generatedAt: TimestampMs,
  /** Start of the viewer's local day that `today` counts from. */
  dayStart: TimestampMs,
  limits: z.array(UsageLimitView),
  today: UsageTotals,
  last7Days: UsageTotals,
  /** Today, per provider. */
  byProvider: z.array(ProviderUsage),
  /** Date the price table used for estimates was last checked (YYYY-MM-DD). */
  pricesAsOf: z.string().max(10),
});
export type MyUsage = z.infer<typeof MyUsage>;

/** All tokens of a total: input, output, cache reads and cache writes. */
export function totalTokens(
  t: Pick<UsageTotals, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">,
): number {
  return t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;
}
