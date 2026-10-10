/**
 * The Sentry projects the watchdog watches (#253), in the database: each with
 * the room it belongs to, whether it is watched, and from when its new issues
 * were not all read.
 */
import { asc, eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { watchdogSentryProjects } from "../../db/schema/index.ts";

export type WatchdogSentryProjectRow = typeof watchdogSentryProjects.$inferSelect;

/**
 * Asked when a target leaves the list (a project here, an app in store.ts):
 * true keeps its row as "not watched", with its room (settings-service.ts
 * decides: whoever removes it cannot see that room); false deletes it.
 */
export type Retain = (row: { operationId: string | null }) => boolean;

export interface ProjectInput {
  slug: string;
  /** Undefined: keep the room it has. */
  operationId?: string | null;
}

export function listProjects(db: Db, all: boolean): WatchdogSentryProjectRow[] {
  return db
    .select()
    .from(watchdogSentryProjects)
    .orderBy(asc(watchdogSentryProjects.slug))
    .all()
    .filter((row) => all || row.watched);
}

/**
 * Replace the list. A slug that stays keeps its row (and is watched again if
 * it was not); `operationId` undefined keeps its room.
 */
export function setProjects(db: Db, projects: readonly ProjectInput[], retain: Retain): void {
  db.transaction((tx) => {
    const before = new Map(
      tx
        .select()
        .from(watchdogSentryProjects)
        .all()
        .map((row) => [row.slug, row]),
    );
    const keep = new Set<string>();
    for (const project of projects) {
      if (keep.has(project.slug)) continue;
      keep.add(project.slug);
      const row = before.get(project.slug);
      if (!row) {
        tx.insert(watchdogSentryProjects)
          .values({ slug: project.slug, operationId: project.operationId ?? null })
          .run();
      } else {
        tx.update(watchdogSentryProjects)
          .set({
            watched: true,
            ...(project.operationId !== undefined ? { operationId: project.operationId } : {}),
          })
          .where(eq(watchdogSentryProjects.id, row.id))
          .run();
      }
    }
    for (const row of before.values()) {
      if (keep.has(row.slug)) continue;
      const one = eq(watchdogSentryProjects.id, row.id);
      if (retain(row)) tx.update(watchdogSentryProjects).set({ watched: false }).where(one).run();
      else tx.delete(watchdogSentryProjects).where(one).run();
    }
  });
}

/** Sentry has more new issues of these projects than was read, from `since` on; or (null) no more. */
export function setUnread(db: Db, projectIds: readonly string[], since: number | null): void {
  for (const id of projectIds) {
    const one = eq(watchdogSentryProjects.id, id);
    const row = db.select().from(watchdogSentryProjects).where(one).get();
    // The oldest start stands until everything was read.
    if (!row || (since !== null && row.unreadSince !== null)) continue;
    db.update(watchdogSentryProjects)
      .set({ unreadSince: since === null ? null : new Date(since) })
      .where(one)
      .run();
  }
}
