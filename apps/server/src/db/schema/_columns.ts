/**
 * Column helpers shared by every table in the schema (SPEC §5: "every table
 * has `id`, `createdAt`, `updatedAt`").
 *
 * Defaults are computed in JS (`$defaultFn` / `$onUpdateFn`) rather than with
 * SQLite-specific SQL so the same schema can move to Postgres later
 * (research 01 §9).
 */
import { type SQL, sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";

/** Text primary key, UUID v4 generated on insert (same shape Better Auth uses). */
export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** Millisecond-precision timestamp stored as an integer, surfaced as `Date`. */
export const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });

/** `createdAt` / `updatedAt` pair; `updatedAt` is bumped by Drizzle on every update. */
export const timestamps = () => ({
  createdAt: timestampMs("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestampMs("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

/** A JSON document kept as text (portable; parsed at the edges). */
export const jsonText = (name: string) => text(name);

/** Text column restricted to the values of a protocol enum. */
export const enumText = <const T extends readonly [string, ...string[]]>(name: string, values: T) =>
  text(name, { enum: values });

/**
 * SQL for a `CHECK (col IN (...))` constraint built from a protocol enum, so the
 * database enforces the same value set the TypeScript type does. Uses plain
 * ANSI SQL (double-quoted identifier, single-quoted literals).
 */
export const inEnum = (column: string, values: readonly string[]): SQL => {
  const literals = values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ");
  return sql.raw(`"${column}" IN (${literals})`);
};
