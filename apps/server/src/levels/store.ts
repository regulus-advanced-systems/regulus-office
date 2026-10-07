/**
 * Level rows (SPEC §14 D26; #268): the lobby and holding levels the migration
 * seeds, and one level per GitHub organisation or account that owns an
 * operation repo, created the first time an operation on it is added.
 */
import {
  HOLDING_LEVEL_ID,
  type LevelInfo,
  LOBBY_LEVEL_ID,
  levelLoginOf,
  sortLevels,
} from "@regulus/protocol";
import { eq, inArray, isNull, max, not } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { levels, operations } from "../db/schema/index.ts";

export type LevelRow = typeof levels.$inferSelect;

const FIXED = [LOBBY_LEVEL_ID, HOLDING_LEVEL_ID];

export function levelInfo(row: LevelRow): LevelInfo {
  return {
    levelId: row.id,
    kind: row.kind,
    login: row.login ?? "",
    name: row.name,
    order: row.position,
  };
}

/** The level of a repo owner, if it exists. */
export function levelOfOwner(db: DbOrTx, owner: string): LevelRow | undefined {
  return db
    .select()
    .from(levels)
    .where(eq(levels.login, levelLoginOf(owner)))
    .get();
}

/**
 * The level of a repo owner, created when this is its first operation. A new
 * level is an `account` without a GitHub id until the owner lookup confirms
 * what it is (owner-lookup.ts). Call inside the transaction that adds the operation.
 */
export function ensureLevelFor(tx: DbOrTx, owner: string): { levelId: string; created: boolean } {
  const found = levelOfOwner(tx, owner);
  if (found) return { levelId: found.id, created: false };
  const [top] = tx
    .select({ n: max(levels.position) })
    .from(levels)
    .where(not(inArray(levels.id, FIXED)))
    .all();
  const levelId = crypto.randomUUID();
  tx.insert(levels)
    .values({
      id: levelId,
      kind: "account",
      login: levelLoginOf(owner),
      name: owner,
      position: (top?.n ?? 0) + 1,
    })
    .run();
  return { levelId, created: true };
}

/**
 * Levels to show, lobby first: the lobby always, every other level while it
 * has at least one live (not archived) operation.
 */
export function shownLevels(db: DbOrTx): LevelRow[] {
  const used = new Set(
    db
      .selectDistinct({ levelId: operations.levelId })
      .from(operations)
      .where(isNull(operations.archivedAt))
      .all()
      .map((r) => r.levelId),
  );
  const rows = db
    .select()
    .from(levels)
    .all()
    .filter((l) => l.id === LOBBY_LEVEL_ID || used.has(l.id));
  const order = sortLevels(rows.map(levelInfo)).map((l) => l.levelId);
  return rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** Owner levels GitHub has not confirmed yet (no GitHub id). */
export function unconfirmedLevels(db: DbOrTx): LevelRow[] {
  return db
    .select()
    .from(levels)
    .where(isNull(levels.githubId))
    .all()
    .filter((l) => !FIXED.includes(l.id) && l.login !== null);
}
