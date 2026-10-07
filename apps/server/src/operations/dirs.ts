/**
 * The directory name of an operation under the projects and worktrees roots
 * (SPEC §8; ../runners/layout.ts): its `slug`, unless the operation was split
 * off a multi-repo operation (#268). Those keep using the original
 * operation's directories, recorded in `dir_slug`, so the mirror, every
 * human's clone and every worktree stay where they were and running henchmen
 * are not disturbed.
 *
 * Several operations may therefore share one directory. It is removed only
 * with the last of them ({@link sharesDir}).
 */
import { and, eq, ne, or, sql } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { operations } from "../db/schema/index.ts";

export function operationDirName(row: { slug: string; dirSlug: string | null }): string {
  return row.dirSlug ?? row.slug;
}

/** Other operations (archived ones too) whose files live in the same directory. */
export function sharesDir(db: DbOrTx, row: { id: string; slug: string; dirSlug: string | null }) {
  const dir = operationDirName(row);
  return db
    .select({ id: operations.id, name: operations.name })
    .from(operations)
    .where(
      and(
        ne(operations.id, row.id),
        or(
          eq(operations.dirSlug, dir),
          and(sql`${operations.dirSlug} IS NULL`, eq(operations.slug, dir)),
        ),
      ),
    )
    .all();
}

/** Slugs a new operation must avoid: every slug and every directory name in use. */
export function takenDirNames(db: DbOrTx): Set<string> {
  const rows = db
    .select({ slug: operations.slug, dirSlug: operations.dirSlug })
    .from(operations)
    .all();
  return new Set(rows.flatMap((r) => (r.dirSlug ? [r.slug, r.dirSlug] : [r.slug])));
}
