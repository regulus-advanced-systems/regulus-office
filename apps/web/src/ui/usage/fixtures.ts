/** Sample usage data for the usage tests (#40). */
import type { MyUsage, UsageSummary } from "@regulus/protocol";

export const NOW = Date.parse("2026-09-30T12:00:00Z");

export const MINE: MyUsage = {
  generatedAt: NOW,
  dayStart: NOW - 12 * 3_600_000,
  limits: [
    {
      provider: "claude-code",
      windowKind: "five_hour",
      usedPct: 72.4,
      resetsAt: NOW + 130 * 60_000,
      observedAt: NOW,
      source: "statusline",
      reset: false,
    },
    {
      provider: "codex",
      windowKind: "seven_day",
      usedPct: 0,
      observedAt: NOW,
      source: "inband",
      reset: true,
    },
  ],
  today: {
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 40_000,
    cacheWriteTokens: 0,
    costUsd: 3.456,
  },
  last7Days: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 21,
  },
  byProvider: [
    {
      provider: "claude-code",
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 40_000,
      cacheWriteTokens: 0,
      costUsd: 3.456,
    },
  ],
  pricesAsOf: "2026-09-30",
};

export const OFFICE: UsageSummary = {
  todayInputTokens: 10_000,
  todayOutputTokens: 2_000,
  todayCacheTokens: 1_000_000,
  todayCostUsdEstimate: 42.5,
  officeKeysCostUsdEstimate: 4,
  activeHumans: 3,
  topHenchmen: [
    {
      agentId: "a1",
      name: "Ada's Codex henchman",
      ownerName: "Ada",
      provider: "codex",
      tokens: 900_000,
    },
  ],
  dayStart: NOW - 12 * 3_600_000,
  observedAt: NOW,
};
