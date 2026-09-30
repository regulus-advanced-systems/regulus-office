/**
 * Writes to `usage_samples` and `usage_limits` (SPEC §5, #40).
 *
 * - Samples with a dedupe key are inserted at most once (unique index), so
 *   re-reading a transcript or a repeated in-band notification counts once.
 * - Limits keep the latest reading per (human, provider, window).
 * - Claude statusline samples are provisional: once the transcript scan has
 *   read a session, its statusline samples from before the scan are dropped,
 *   because the transcript now counts the same requests.
 */
import type { LimitSample, ProviderId, UsageSample } from "@regulus/protocol";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { usageLimits, usageSamples } from "../db/schema/index.ts";

export interface SampleRow {
  /** Null = the office (office-wide key, D2). */
  userId: string | null;
  agentId: string | null;
  provider: ProviderId;
  model: string | null;
  sample: UsageSample;
  costUsd: number;
  /** Full key, already scoped (see tracker.ts); null = no dedupe. */
  dedupeKey: string | null;
}

export class UsageStore {
  constructor(private readonly db: Db) {}

  /** True when stored; false when the same request was already counted. */
  insertSample(row: SampleRow): boolean {
    const s = row.sample;
    const res = this.db
      .insert(usageSamples)
      .values({
        userId: row.userId,
        agentId: row.agentId,
        provider: row.provider,
        ts: new Date(s.ts),
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheReadTokens: s.cacheReadTokens,
        cacheWriteTokens: s.cacheWriteTokens,
        costUsdEstimate: row.costUsd,
        source: s.source,
        model: row.model,
        sessionId: s.sessionId ?? null,
        dedupeKey: row.dedupeKey,
      })
      .onConflictDoNothing()
      .returning({ id: usageSamples.id })
      .all();
    return res.length > 0;
  }

  /** Keeps the newest reading; an older one arriving late is ignored. */
  upsertLimit(userId: string, provider: ProviderId, limit: LimitSample): void {
    const values = {
      userId,
      provider,
      windowKind: limit.windowKind,
      usedPct: limit.usedPct,
      resetsAt: limit.resetsAt === undefined ? null : new Date(limit.resetsAt),
      observedAt: new Date(limit.observedAt),
      source: limit.source,
    };
    this.db
      .insert(usageLimits)
      .values(values)
      .onConflictDoUpdate({
        target: [usageLimits.userId, usageLimits.provider, usageLimits.windowKind],
        set: {
          usedPct: values.usedPct,
          resetsAt: values.resetsAt,
          observedAt: values.observedAt,
          source: values.source,
          updatedAt: new Date(),
        },
        setWhere: sql`${usageLimits.observedAt} <= ${values.observedAt.getTime()}`,
      })
      .run();
  }

  /**
   * Drop Claude statusline samples older than `before` for sessions the
   * transcript scan has counted. Returns how many were dropped.
   */
  supersedeStatusline(sessionIds: readonly string[], before: number): number {
    let dropped = 0;
    for (let i = 0; i < sessionIds.length; i += 200) {
      const chunk = sessionIds.slice(i, i + 200);
      const res = this.db
        .delete(usageSamples)
        .where(
          and(
            eq(usageSamples.source, "statusline"),
            eq(usageSamples.provider, "claude-code"),
            isNotNull(usageSamples.sessionId),
            inArray(usageSamples.sessionId, chunk),
            lt(usageSamples.ts, new Date(before)),
          ),
        )
        .returning({ id: usageSamples.id })
        .all();
      dropped += res.length;
    }
    return dropped;
  }
}
