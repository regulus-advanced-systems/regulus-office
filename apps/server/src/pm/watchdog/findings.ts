/**
 * The watchdog's findings (#253, D30).
 *
 * One fault is one finding with exactly one disposition, however often it is
 * met: `watchdog_finding_sources.key` is unique in the office, so a second
 * record of the same Sentry issue or PM2 signal, in the same round, in a
 * later one, after a retry or after a restart, finds the first and changes
 * nothing but "last seen".
 *
 * A finding gets a new verdict only when **the office** determined the fault
 * is back (`NewSource.regressed`: Sentry's own record of a regression later
 * than the verdict, or an error line back after a week of silence). Then, and
 * only then, are people told again. Whatever the watchdog writes on a
 * re-record, it never:
 *
 * - changes a finding a person marked as noise;
 * - overwrites a person's "declined", or a fix that is being written or open;
 * - moves a finding to another room (`scope` and `operationId` are set once).
 */
import type {
  WatchdogCommentState,
  WatchdogDisposition,
  WatchdogFixState,
  WatchdogScope,
  WatchdogSourceKind,
} from "@regulus/protocol";
import { and, desc, eq, gt, gte, inArray, isNull, max, ne } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { watchdogFindingSources, watchdogFindings } from "../../db/schema/index.ts";

export type FindingRow = typeof watchdogFindings.$inferSelect;
export type SourceRow = typeof watchdogFindingSources.$inferSelect;
type FindingPatch = Partial<typeof watchdogFindings.$inferInsert>;

export interface NewSource {
  kind: WatchdogSourceKind;
  /** The stored key: the signal's key and the room (signals.ts `storedKey`). */
  key: string;
  label: string;
  url?: string;
  project?: string;
  ref?: string;
  /** The office determined the fault is back. Never the model's word. */
  regressed: boolean;
}

export interface NewFinding {
  roundId: string;
  title: string;
  evidence: string;
  disposition: WatchdogDisposition;
  reason: string;
  scope: WatchdogScope;
  operationId: string | null;
  sources: readonly NewSource[];
  /** What a finding with this verdict starts with. */
  fixState: WatchdogFixState;
  fixSummary: string;
  sentryComment: WatchdogCommentState;
}

export type Recorded =
  | { status: "recorded" | "regressed"; finding: FindingRow }
  /** Known already: nothing was changed but when it was last seen. */
  | { status: "already_recorded"; finding: FindingRow };

/** A person's decision, or work under way: a new verdict leaves these as they are. */
const FIX_KEPT: readonly WatchdogFixState[] = ["declined", "queued", "pr_open"];

export class FindingStore {
  constructor(
    readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  finding(id: string): FindingRow | undefined {
    return this.db.select().from(watchdogFindings).where(eq(watchdogFindings.id, id)).get();
  }

  findings(limit: number): FindingRow[] {
    return this.db
      .select()
      .from(watchdogFindings)
      .orderBy(desc(watchdogFindings.lastSeenAt))
      .limit(limit)
      .all();
  }

  /** The findings a round gave their verdict to. */
  ofRound(roundId: string): FindingRow[] {
    return this.db
      .select()
      .from(watchdogFindings)
      .where(eq(watchdogFindings.roundId, roundId))
      .all();
  }

  /** Findings with a verdict people were not told of yet, that are worth telling. */
  unannounced(): FindingRow[] {
    return this.db
      .select()
      .from(watchdogFindings)
      .where(
        and(
          isNull(watchdogFindings.announcedAt),
          isNull(watchdogFindings.noiseBy),
          ne(watchdogFindings.disposition, "dismiss"),
        ),
      )
      .all();
  }

  /**
   * These are ready to be told. `announcedAt` only ever grows, also within
   * one millisecond, so "announced later than what a person was told" (told.ts)
   * never misses a finding and never tells one twice.
   */
  announced(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const last = this.db
      .select({ at: max(watchdogFindings.announcedAt) })
      .from(watchdogFindings)
      .get()?.at;
    const at = Math.max(this.now(), (last?.getTime() ?? 0) + 1);
    this.db
      .update(watchdogFindings)
      .set({ announcedAt: new Date(at) })
      .where(inArray(watchdogFindings.id, [...ids]))
      .run();
  }

  /** Findings worth telling that were announced after `since`, oldest first. */
  announcedSince(since: number): FindingRow[] {
    return this.db
      .select()
      .from(watchdogFindings)
      .where(
        and(
          gt(watchdogFindings.announcedAt, new Date(since)),
          isNull(watchdogFindings.noiseBy),
          ne(watchdogFindings.disposition, "dismiss"),
        ),
      )
      .orderBy(watchdogFindings.announcedAt)
      .all();
  }

  withFixState(state: WatchdogFixState): FindingRow[] {
    return this.db
      .select()
      .from(watchdogFindings)
      .where(eq(watchdogFindings.fixState, state))
      .all();
  }

  /** Fixes `auto` started: in one round, and since a moment. */
  autoFixes(roundId: string, since: number): { round: number; recent: number } {
    const rows = this.db
      .select({ roundId: watchdogFindings.roundId, at: watchdogFindings.fixQueuedAt })
      .from(watchdogFindings)
      .where(
        and(eq(watchdogFindings.fixAuto, true), gte(watchdogFindings.fixQueuedAt, new Date(since))),
      )
      .all();
    return { round: rows.filter((r) => r.roundId === roundId).length, recent: rows.length };
  }

  withComment(state: WatchdogCommentState): FindingRow[] {
    return this.db
      .select()
      .from(watchdogFindings)
      .where(eq(watchdogFindings.sentryComment, state))
      .all();
  }

  sources(findingIds: readonly string[]): SourceRow[] {
    if (findingIds.length === 0) return [];
    return this.db
      .select()
      .from(watchdogFindingSources)
      .where(inArray(watchdogFindingSources.findingId, [...findingIds]))
      .all();
  }

  patch(id: string, set: FindingPatch): void {
    this.db.update(watchdogFindings).set(set).where(eq(watchdogFindings.id, id)).run();
  }

  /**
   * Move a finding's fix from one state to another; false when it was not in
   * `from` any more (two people clicked, or the tick got there first).
   */
  moveFix(id: string, from: WatchdogFixState, to: WatchdogFixState, set: FindingPatch = {}) {
    return (
      this.db
        .update(watchdogFindings)
        .set({ ...set, fixState: to })
        .where(and(eq(watchdogFindings.id, id), eq(watchdogFindings.fixState, from)))
        .returning({ id: watchdogFindings.id })
        .all().length > 0
    );
  }

  /** These findings were met again on a check, with nothing new to say about them. */
  seenAgain(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.db
      .update(watchdogFindings)
      .set({ lastSeenAt: new Date(this.now()) })
      .where(inArray(watchdogFindings.id, [...new Set(ids)]))
      .run();
  }

  /** The finding each of these stored keys belongs to. */
  known(keys: readonly string[]): Map<string, FindingRow> {
    const out = new Map<string, FindingRow>();
    if (keys.length === 0) return out;
    const rows = this.db
      .select()
      .from(watchdogFindingSources)
      .where(inArray(watchdogFindingSources.key, [...keys]))
      .all();
    for (const row of rows) {
      const finding = this.finding(row.findingId);
      if (finding) out.set(row.key, finding);
    }
    return out;
  }

  /** Record a fault, or meet it again. One transaction: two records of one key cannot both be new. */
  record(input: NewFinding): Recorded {
    const now = new Date(this.now());
    return this.db.transaction((tx) => {
      const keys = input.sources.map((s) => s.key);
      const known = tx
        .select()
        .from(watchdogFindingSources)
        .where(inArray(watchdogFindingSources.key, keys))
        .all();
      const attach = (findingId: string) => {
        const have = new Set(known.map((k) => k.key));
        for (const source of input.sources) {
          if (have.has(source.key)) continue;
          have.add(source.key);
          tx.insert(watchdogFindingSources)
            .values({
              findingId,
              kind: source.kind,
              key: source.key,
              label: source.label,
              url: source.url ?? null,
              project: source.project ?? null,
              ref: source.ref ?? null,
            })
            .run();
        }
      };
      const read = (id: string) =>
        tx.select().from(watchdogFindings).where(eq(watchdogFindings.id, id)).get() as FindingRow;
      // The finding of the first source that is known, in the order the watchdog gave them.
      const first = input.sources
        .map((s) => known.find((k) => k.key === s.key))
        .find((k) => k !== undefined);
      if (!first) {
        const id = crypto.randomUUID();
        tx.insert(watchdogFindings)
          .values({
            id,
            title: input.title,
            evidence: input.evidence,
            disposition: input.disposition,
            reason: input.reason,
            scope: input.scope,
            operationId: input.operationId,
            roundId: input.roundId,
            judgedAt: now,
            firstSeenAt: now,
            lastSeenAt: now,
            fixState: input.fixState,
            fixSummary: input.fixSummary,
            sentryComment: input.sentryComment,
          })
          .run();
        attach(id);
        return { status: "recorded", finding: read(id) };
      }
      const existing = read(first.findingId);
      // The stored key holds the room, so what is found here is in this finding's room.
      attach(existing.id);
      const back =
        existing.noiseBy === null &&
        input.sources.some(
          (s) => s.regressed && known.some((k) => k.key === s.key && k.findingId === existing.id),
        );
      if (!back) {
        tx.update(watchdogFindings)
          .set({ lastSeenAt: now, seenCount: existing.seenCount + 1 })
          .where(eq(watchdogFindings.id, existing.id))
          .run();
        return { status: "already_recorded", finding: read(existing.id) };
      }
      tx.update(watchdogFindings)
        .set({
          title: input.title,
          evidence: input.evidence,
          disposition: input.disposition,
          reason: input.reason,
          roundId: input.roundId,
          judgedAt: now,
          announcedAt: null,
          lastSeenAt: now,
          regressions: existing.regressions + 1,
          sentryComment: input.sentryComment,
          ...(FIX_KEPT.includes(existing.fixState)
            ? {}
            : {
                fixState: input.fixState,
                fixSummary: input.fixSummary,
                fixTaskId: null,
                fixDecidedBy: null,
                fixAuto: false,
                fixQueuedAt: null,
                fixPrNumber: null,
                fixPrUrl: null,
                fixError: null,
              }),
        })
        .where(eq(watchdogFindings.id, existing.id))
        .run();
      return { status: "regressed", finding: read(existing.id) };
    });
  }
}
