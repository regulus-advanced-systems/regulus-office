/**
 * What an office agent has cost so far (#136): the estimate the usage tracker
 * stored for its turns, summed. Shown on its card to everyone who may see the
 * card, so an office admin can see what a personal agent costs without being
 * able to read anything of it.
 *
 * An agent's samples are found by their dedupe key, which the runtime builds
 * as `office_agent:<agent id>:<message id>` and the tracker stores as
 * `<provider>:inband:api:<that>`; a prefix range uses the key's unique index.
 */
import { and, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { usageSamples } from "../db/schema/index.ts";
import type { OfficeAgentRow } from "./store.ts";

/** The dedupe key the runtime gives a turn's usage (also used to find it again here). */
export const agentUsageKey = (agentId: string, messageId: string) =>
  `office_agent:${agentId}:${messageId}`;

const DAYS_30 = 30 * 24 * 60 * 60_000;

export function agentCost(
  db: Db,
  agent: Pick<OfficeAgentRow, "id" | "provider">,
  now: number,
): { totalUsd: number; last30DaysUsd: number } {
  const prefix = `${agent.provider}:inband:api:${agentUsageKey(agent.id, "")}`;
  const since = now - DAYS_30;
  const row = db
    .select({
      total: sql<number>`coalesce(sum(${usageSamples.costUsdEstimate}), 0)`,
      recent: sql<number>`coalesce(sum(case when ${usageSamples.ts} >= ${since} then ${usageSamples.costUsdEstimate} else 0 end), 0)`,
    })
    .from(usageSamples)
    // ";" is the character after ":", so this is every key that starts with the prefix.
    .where(
      and(
        gte(usageSamples.dedupeKey, prefix),
        lt(usageSamples.dedupeKey, `${prefix.slice(0, -1)};`),
      ),
    )
    .get();
  return { totalUsd: row?.total ?? 0, last30DaysUsd: row?.recent ?? 0 };
}
