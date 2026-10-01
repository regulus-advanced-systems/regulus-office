/**
 * What the usage wall shows (#40, SPEC §9.4):
 *
 * - `mine(viewer)`: that viewer's own plan limits and own spend (today, last
 *   7 days, per provider). The only filter is the viewer's own user id, taken
 *   from the session by the route.
 * - `office()`: shared BuildingRoom state: everyone's totals for the office's
 *   day as plain sums, office-key spend, how many humans used anything, and
 *   the top henchmen by tokens with only the henchman's display name and owner.
 *
 * Never another human's limits or per-human spend.
 */
import {
  henchmanDisplayName,
  type MyUsage,
  USAGE_TOP_HENCHMEN,
  type UsageLimitView,
  type UsageSummary,
  type UsageTotals,
} from "@regulus/protocol";
import { and, desc, eq, gte, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents, usageLimits, usageSamples, userProfiles, users } from "../db/schema/index.ts";
import { PRICES_AS_OF } from "./prices.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Start of a local day. `tzOffsetMinutes` is JavaScript's `getTimezoneOffset()`
 * (UTC minus local, e.g. -120 for UTC+2); out-of-range values mean UTC.
 */
export function localDayStart(now: number, tzOffsetMinutes = 0): number {
  const tz =
    Number.isFinite(tzOffsetMinutes) && Math.abs(tzOffsetMinutes) <= 14 * 60 ? tzOffsetMinutes : 0;
  const local = now - tz * 60_000;
  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS) + tz * 60_000;
}

const tokenSum = sql<number>`coalesce(sum(${usageSamples.inputTokens} + ${usageSamples.outputTokens} + ${usageSamples.cacheReadTokens} + ${usageSamples.cacheWriteTokens}), 0)`;

const totalsSelect = {
  inputTokens: sql<number>`coalesce(sum(${usageSamples.inputTokens}), 0)`,
  outputTokens: sql<number>`coalesce(sum(${usageSamples.outputTokens}), 0)`,
  cacheReadTokens: sql<number>`coalesce(sum(${usageSamples.cacheReadTokens}), 0)`,
  cacheWriteTokens: sql<number>`coalesce(sum(${usageSamples.cacheWriteTokens}), 0)`,
  costUsd: sql<number>`coalesce(sum(${usageSamples.costUsdEstimate}), 0)`,
};

const ZERO: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

function clean(t: UsageTotals): UsageTotals {
  return {
    inputTokens: Number(t.inputTokens),
    outputTokens: Number(t.outputTokens),
    cacheReadTokens: Number(t.cacheReadTokens),
    cacheWriteTokens: Number(t.cacheWriteTokens),
    costUsd: Math.round(Number(t.costUsd) * 1e4) / 1e4,
  };
}

export class UsageSummaries {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
    /** The office's own day for shared totals (server time zone by default). */
    private readonly officeTzOffset: () => number = () => new Date().getTimezoneOffset(),
  ) {}

  #totals(where: SQL | undefined): UsageTotals {
    return clean(this.db.select(totalsSelect).from(usageSamples).where(where).get() ?? ZERO);
  }

  /** The viewer's own usage. Nothing here is about anyone else. */
  mine(viewerId: string, tzOffsetMinutes = 0): MyUsage {
    const now = this.now();
    const dayStart = localDayStart(now, tzOffsetMinutes);
    const own = eq(usageSamples.userId, viewerId);
    const today = and(own, gte(usageSamples.ts, new Date(dayStart)));
    const byProvider = this.db
      .select({ provider: usageSamples.provider, ...totalsSelect })
      .from(usageSamples)
      .where(today)
      .groupBy(usageSamples.provider)
      .all()
      .map((r) => ({ provider: r.provider, ...clean(r) }));
    return {
      generatedAt: now,
      dayStart,
      limits: this.limitsFor(viewerId, now),
      today: this.#totals(today),
      last7Days: this.#totals(and(own, gte(usageSamples.ts, new Date(now - 7 * DAY_MS)))),
      byProvider,
      pricesAsOf: PRICES_AS_OF,
    };
  }

  /** The viewer's own windows; a window whose reset time has passed reads 0 %. */
  limitsFor(viewerId: string, now: number): UsageLimitView[] {
    return this.db
      .select()
      .from(usageLimits)
      .where(eq(usageLimits.userId, viewerId))
      .orderBy(usageLimits.provider, usageLimits.windowKind)
      .all()
      .map((r) => {
        const resetsAt = r.resetsAt?.getTime();
        const reset = resetsAt !== undefined && resetsAt <= now;
        return {
          provider: r.provider,
          windowKind: r.windowKind,
          usedPct: reset ? 0 : r.usedPct,
          ...(resetsAt !== undefined && !reset ? { resetsAt } : {}),
          observedAt: r.observedAt.getTime(),
          source: r.source,
          reset,
        };
      });
  }

  /** Shared office totals for today (BuildingRoom state). */
  office(): UsageSummary {
    const now = this.now();
    const dayStart = localDayStart(now, this.officeTzOffset());
    const today = gte(usageSamples.ts, new Date(dayStart));
    const all = this.#totals(today);
    const officeKeys = this.#totals(and(isNull(usageSamples.userId), today));
    const active = this.db
      .select({ n: sql<number>`count(distinct ${usageSamples.userId})` })
      .from(usageSamples)
      .where(today)
      .get();
    return {
      todayInputTokens: all.inputTokens,
      todayOutputTokens: all.outputTokens,
      todayCacheTokens: all.cacheReadTokens + all.cacheWriteTokens,
      todayCostUsdEstimate: all.costUsd,
      officeKeysCostUsdEstimate: officeKeys.costUsd,
      activeHumans: Number(active?.n ?? 0),
      topHenchmen: this.topHenchmen(dayStart),
      dayStart,
      observedAt: now,
    };
  }

  /** Henchman name and owner name only: no operation, task, model or cost. */
  topHenchmen(since: number): UsageSummary["topHenchmen"] {
    const rows = this.db
      .select({
        agentId: usageSamples.agentId,
        provider: agents.provider,
        ownerName: sql<string | null>`coalesce(${userProfiles.displayName}, ${users.name})`,
        tokens: tokenSum,
      })
      .from(usageSamples)
      .innerJoin(agents, eq(agents.id, usageSamples.agentId))
      .leftJoin(userProfiles, eq(userProfiles.userId, agents.ownerUserId))
      .leftJoin(users, eq(users.id, agents.ownerUserId))
      .where(gte(usageSamples.ts, new Date(since)))
      .groupBy(usageSamples.agentId)
      .orderBy(desc(tokenSum))
      .limit(USAGE_TOP_HENCHMEN)
      .all();
    return rows.flatMap((r) => {
      if (!r.agentId || Number(r.tokens) <= 0) return [];
      const ownerName = (r.ownerName ?? "").slice(0, 64);
      return [
        {
          agentId: r.agentId,
          name: henchmanDisplayName(ownerName, r.provider).slice(0, 120),
          ownerName,
          provider: r.provider,
          tokens: Number(r.tokens),
        },
      ];
    });
  }
}
