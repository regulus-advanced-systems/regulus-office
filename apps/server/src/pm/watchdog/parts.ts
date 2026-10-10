/**
 * The watchdog's rounds and their parts (#253, D30).
 *
 * A round is done one room at a time: it has one *part* for each room that
 * has watched targets, and one for the targets without a room. Each part is
 * one turn of the watchdog, with only that part's data in it, so no turn ever
 * holds two rooms' data, and what the watchdog writes about a part (its
 * summary) belongs to that part's room.
 *
 * A part keeps what the office handed out in it (the signals, with their
 * lines) and what it read (the marks), so a finding can only cite what this
 * part was given, and a part that does not finish leaves nothing as "read".
 */
import type { WatchdogRoundTrigger, WatchdogScope } from "@regulus/protocol";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { watchdogRoundParts, watchdogRounds } from "../../db/schema/index.ts";
import type { AppMarks } from "./pm2.ts";
import type { Signal } from "./signals.ts";

export type RoundRow = typeof watchdogRounds.$inferSelect;
export type PartRow = typeof watchdogRoundParts.$inferSelect;

/** Whose targets a part reads. */
export interface PartGroup {
  scope: WatchdogScope;
  operationId: string | null;
}

const OPEN = ["pending", "running"] as const;

function parse<T>(json: string, fallback: T): T {
  try {
    const value = JSON.parse(json) as unknown;
    return value !== null && typeof value === "object" ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export class RoundStore {
  constructor(
    readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  round(id: string): RoundRow | undefined {
    return this.db.select().from(watchdogRounds).where(eq(watchdogRounds.id, id)).get();
  }

  /** The round that is asked for or under way, if any. There is never more than one. */
  openRound(): RoundRow | undefined {
    return this.db
      .select()
      .from(watchdogRounds)
      .where(inArray(watchdogRounds.state, [...OPEN]))
      .orderBy(desc(watchdogRounds.startedAt))
      .get();
  }

  rounds(limit: number): RoundRow[] {
    return this.db
      .select()
      .from(watchdogRounds)
      .orderBy(desc(watchdogRounds.startedAt), desc(watchdogRounds.createdAt))
      .limit(limit)
      .all();
  }

  /** A round with one pending part for each group, in the order given. */
  create(
    trigger: WatchdogRoundTrigger,
    requestedBy: string | null,
    groups: readonly PartGroup[],
  ): RoundRow {
    const id = crypto.randomUUID();
    this.db.transaction((tx) => {
      tx.insert(watchdogRounds)
        .values({ id, trigger, requestedBy, state: "running", startedAt: new Date(this.now()) })
        .run();
      groups.forEach((group, position) => {
        tx.insert(watchdogRoundParts)
          .values({ roundId: id, position, ...group, state: "pending" })
          .run();
      });
    });
    return this.round(id) as RoundRow;
  }

  part(id: string): PartRow | undefined {
    return this.db.select().from(watchdogRoundParts).where(eq(watchdogRoundParts.id, id)).get();
  }

  parts(roundId: string): PartRow[] {
    return this.db
      .select()
      .from(watchdogRoundParts)
      .where(eq(watchdogRoundParts.roundId, roundId))
      .orderBy(asc(watchdogRoundParts.position))
      .all();
  }

  partsOf(roundIds: readonly string[]): PartRow[] {
    if (roundIds.length === 0) return [];
    return this.db
      .select()
      .from(watchdogRoundParts)
      .where(inArray(watchdogRoundParts.roundId, [...roundIds]))
      .orderBy(asc(watchdogRoundParts.position))
      .all();
  }

  /** The part whose turn is under way, if any. */
  runningPart(): PartRow | undefined {
    return this.db
      .select()
      .from(watchdogRoundParts)
      .where(eq(watchdogRoundParts.state, "running"))
      .get();
  }

  /** A pending part becomes the one under way; false when it was not pending. */
  startPart(id: string): boolean {
    return this.#move(id, ["pending"], { state: "running", startedAt: new Date(this.now()) });
  }

  /**
   * What the office read and handed out in this part, and what it could not
   * read (`error`, one per line, until the part ends; it names this part's
   * targets only).
   */
  noteCheck(
    id: string,
    reading: {
      marks: Readonly<Record<string, AppMarks>>;
      signals: readonly Signal[];
      unreachable: readonly string[];
      /** Ids of the Sentry projects that have more new issues than were read. */
      truncated: readonly string[];
    },
  ): void {
    const { marks, signals, unreachable, truncated } = reading;
    this.db
      .update(watchdogRoundParts)
      .set({
        checkedAt: new Date(this.now()),
        marksJson: JSON.stringify(marks),
        signalsJson: JSON.stringify(Object.fromEntries(signals.map((s) => [s.key, s]))),
        truncatedJson: JSON.stringify(truncated),
        error: unreachable.length > 0 ? unreachable.join("\n").slice(0, 2000) : null,
      })
      .where(eq(watchdogRoundParts.id, id))
      .run();
  }

  marks(part: PartRow): Record<string, AppMarks> {
    return parse<Record<string, AppMarks>>(part.marksJson, {});
  }

  /** The signals this part was given, by key: the only ones a finding of it may cite. */
  signals(part: PartRow): Record<string, Signal> {
    return parse<Record<string, Signal>>(part.signalsJson, {});
  }

  truncated(part: PartRow): string[] {
    return parse<string[]>(part.truncatedJson, []);
  }

  finishPart(id: string, summary: string): boolean {
    return this.#move(id, ["running"], {
      state: "done",
      summary,
      finishedAt: new Date(this.now()),
    });
  }

  failPart(id: string, error: string): boolean {
    return this.#move(id, [...OPEN], {
      state: "failed",
      error: error.slice(0, 300),
      finishedAt: new Date(this.now()),
    });
  }

  #move(
    id: string,
    from: readonly PartRow["state"][],
    set: Partial<typeof watchdogRoundParts.$inferInsert>,
  ): boolean {
    return (
      this.db
        .update(watchdogRoundParts)
        .set(set)
        .where(and(eq(watchdogRoundParts.id, id), inArray(watchdogRoundParts.state, [...from])))
        .returning({ id: watchdogRoundParts.id })
        .all().length > 0
    );
  }

  /** Every part has ended: the round is done, or failed when a part did not finish. */
  closeRound(id: string): RoundRow | undefined {
    const parts = this.parts(id);
    if (parts.some((p) => p.state === "pending" || p.state === "running")) return undefined;
    const failed = parts.filter((p) => p.state === "failed").length;
    const error =
      failed === 0
        ? null
        : parts.length === 1
          ? (parts[0]?.error ?? "it did not finish")
          : `${failed} of its ${parts.length} parts did not finish`;
    this.db
      .update(watchdogRounds)
      .set({ state: failed === 0 ? "done" : "failed", error, finishedAt: new Date(this.now()) })
      .where(and(eq(watchdogRounds.id, id), inArray(watchdogRounds.state, [...OPEN])))
      .run();
    return this.round(id);
  }

  /** Fail the round and every part of it that has not ended. */
  failRound(id: string, error: string): void {
    for (const part of this.parts(id)) this.failPart(part.id, error);
    this.db
      .update(watchdogRounds)
      .set({ state: "failed", error: error.slice(0, 300), finishedAt: new Date(this.now()) })
      .where(and(eq(watchdogRounds.id, id), inArray(watchdogRounds.state, [...OPEN])))
      .run();
  }
}
