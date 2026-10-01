/**
 * What the usage wall, the room screens and the HUD panel show (#40), as
 * plain strings and numbers: the viewer's own windows and spend (REST, only
 * ever their own) and the office totals and top henchmen (BuildingRoom state,
 * henchman name and owner only). Pure, so it is unit-tested without a canvas.
 */
import {
  type LimitWindowKind,
  type MyUsage,
  type ProviderId,
  totalTokens,
  type UsageSummary,
} from "@regulus/protocol";
import { formatCompact, formatUsd } from "../hud/format.ts";

export type LimitTone = "ok" | "warn" | "high";

export interface LimitRow {
  key: string;
  label: string;
  /** 0..100. */
  pct: number;
  tone: LimitTone;
  /** "resets in 2h 10m", "reset", or "". */
  detail: string;
}

export interface UsageModel {
  /** False until the viewer's own usage has loaded (or when signed out). */
  mineLoaded: boolean;
  limits: LimitRow[];
  myTodayUsd: string;
  myTodayTokens: string;
  my7dUsd: string;
  byProvider: { label: string; usd: string; tokens: string }[];
  officeTodayUsd: string;
  officeTodayTokens: string;
  officeKeysUsd: string;
  activeHumans: number;
  top: { key: string; name: string; owner: string; tokens: string }[];
  pricesAsOf: string;
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  "gemini-cli": "Gemini",
  opencode: "OpenCode",
  "kimi-code": "Kimi",
  custom: "Custom",
};

const WINDOW_LABELS: Record<LimitWindowKind, string> = {
  five_hour: "5-hour",
  seven_day: "Weekly",
  monthly: "Monthly",
  credits: "Credits",
};

export function providerShort(provider: ProviderId): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function limitTone(pct: number): LimitTone {
  if (pct >= 90) return "high";
  if (pct >= 70) return "warn";
  return "ok";
}

/** "45m", "2h 10m", "3d 4h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function buildUsageModel(
  mine: MyUsage | null,
  office: UsageSummary | null,
  now: number,
): UsageModel {
  const limits: LimitRow[] = (mine?.limits ?? []).map((l) => {
    const pct = Math.max(0, Math.min(100, l.usedPct));
    let detail = "";
    if (l.reset) detail = "reset";
    else if (l.resetsAt !== undefined && l.resetsAt > now)
      detail = `resets in ${formatDuration(l.resetsAt - now)}`;
    return {
      key: `${l.provider}:${l.windowKind}`,
      label: `${providerShort(l.provider)} · ${WINDOW_LABELS[l.windowKind]}`,
      pct,
      tone: limitTone(pct),
      detail,
    };
  });
  const officeTokens = office
    ? office.todayInputTokens + office.todayOutputTokens + office.todayCacheTokens
    : 0;
  return {
    mineLoaded: mine !== null,
    limits,
    myTodayUsd: formatUsd(mine?.today.costUsd ?? 0),
    myTodayTokens: formatCompact(mine ? totalTokens(mine.today) : 0),
    my7dUsd: formatUsd(mine?.last7Days.costUsd ?? 0),
    byProvider: (mine?.byProvider ?? []).map((p) => ({
      label: providerShort(p.provider),
      usd: formatUsd(p.costUsd),
      tokens: formatCompact(totalTokens(p)),
    })),
    officeTodayUsd: formatUsd(office?.todayCostUsdEstimate ?? 0),
    officeTodayTokens: formatCompact(officeTokens),
    officeKeysUsd: formatUsd(office?.officeKeysCostUsdEstimate ?? 0),
    activeHumans: office?.activeHumans ?? 0,
    top: (office?.topHenchmen ?? []).map((r) => ({
      key: r.agentId,
      name: r.name,
      owner: r.ownerName,
      tokens: formatCompact(r.tokens),
    })),
    pricesAsOf: mine?.pricesAsOf ?? "",
  };
}
