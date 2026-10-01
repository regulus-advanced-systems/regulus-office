/**
 * Copies the office usage summary (summary.ts `office()`) into the
 * BuildingRoom's `usage` state (SPEC §6 channel 1). Only office totals and
 * the leaderboard (henchman name + owner) go there: shared state is seen by
 * everyone, so no human's own limits or spend ever do.
 */
import {
  TopHenchmanUsageSchema,
  type UsageSummary,
  type UsageSummarySchema,
} from "@regulus/protocol";

type UsageState = InstanceType<typeof UsageSummarySchema>;

export function applyUsageSummary(state: UsageState, summary: UsageSummary): void {
  state.todayInputTokens = summary.todayInputTokens;
  state.todayOutputTokens = summary.todayOutputTokens;
  state.todayCacheTokens = summary.todayCacheTokens;
  state.todayCostUsdEstimate = summary.todayCostUsdEstimate;
  state.officeKeysCostUsdEstimate = summary.officeKeysCostUsdEstimate;
  state.activeHumans = summary.activeHumans;
  state.dayStart = summary.dayStart;
  state.observedAt = summary.observedAt;
  state.topHenchmen.clear();
  for (const r of summary.topHenchmen) {
    const row = new TopHenchmanUsageSchema();
    row.agentId = r.agentId;
    row.name = r.name;
    row.ownerName = r.ownerName;
    row.provider = r.provider;
    row.tokens = r.tokens;
    state.topHenchmen.push(row);
  }
}

/** Same totals and leaderboard (ignores `observedAt`), so unchanged summaries are not re-sent. */
export function sameUsage(a: UsageSummary | undefined, b: UsageSummary): boolean {
  if (!a) return false;
  const { observedAt: _a, ...ra } = a;
  const { observedAt: _b, ...rb } = b;
  return JSON.stringify(ra) === JSON.stringify(rb);
}
