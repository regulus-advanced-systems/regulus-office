/**
 * Encrypt the souls, memories and notes that are still plain text (#301): the
 * data step of migration 0028, run by the office at every start once
 * `OFFICE_MASTER_KEY` is set (SQL cannot hold the key).
 *
 * Safe to run again: it touches only rows whose `sealed` column is false and
 * whose text is not empty, in one transaction, so a start that is interrupted
 * leaves every row either as it was or sealed, never half. A row sealed here
 * keeps its timestamps.
 *
 * SQLite leaves the old plain text in the file's free pages (and in the WAL)
 * after an update, and a backup copies those pages. So when anything was
 * sealed the file is rebuilt (`VACUUM`) and the WAL emptied. Backup files
 * made before this ran still hold the plain text until they are pruned.
 */
import { and, eq, ne } from "drizzle-orm";
import type { DbOrTx } from "../../auth/audit.ts";
import type { Db } from "../../db/index.ts";
import {
  officeAgentMemories,
  officeAgentSoulVersions,
  officeAgents,
} from "../../db/schema/index.ts";
import { type MindCipher, sealEntry } from "./seal.ts";

export interface SealExistingResult {
  souls: number;
  versions: number;
  entries: number;
  /** False when rows were sealed but the file could not be rebuilt: old pages may still hold plain text. */
  scrubbed?: boolean;
}

/** How many rows still hold plain text (for the log line without a key). */
export function countUnsealed(db: Db): SealExistingResult {
  const n = (rows: unknown[]) => rows.length;
  return {
    souls: n(
      db
        .select({ id: officeAgents.id })
        .from(officeAgents)
        .where(and(eq(officeAgents.instructionsSealed, false), ne(officeAgents.instructions, "")))
        .all(),
    ),
    versions: n(
      db
        .select({ id: officeAgentSoulVersions.id })
        .from(officeAgentSoulVersions)
        .where(
          and(eq(officeAgentSoulVersions.sealed, false), ne(officeAgentSoulVersions.content, "")),
        )
        .all(),
    ),
    entries: n(
      db
        .select({ id: officeAgentMemories.id })
        .from(officeAgentMemories)
        .where(eq(officeAgentMemories.sealed, false))
        .all(),
    ),
  };
}

/** Agents whose document is encrypted and does not open with the key the office has (or with none). */
export function countUnreadable(db: Db, cipher: MindCipher): number {
  let unreadable = 0;
  for (const row of db
    .select({
      id: officeAgents.id,
      text: officeAgents.instructions,
      sealed: officeAgents.instructionsSealed,
    })
    .from(officeAgents)
    .where(eq(officeAgents.instructionsSealed, true))
    .all()) {
    try {
      cipher.open(row.id, row);
    } catch {
      unreadable += 1;
    }
  }
  return unreadable;
}

export function sealExisting(db: Db, cipher: MindCipher): SealExistingResult {
  const done: SealExistingResult = { souls: 0, versions: 0, entries: 0 };
  if (!cipher.on) return done;
  db.transaction((tx: DbOrTx) => {
    for (const row of tx
      .select({ id: officeAgents.id, text: officeAgents.instructions })
      .from(officeAgents)
      .where(and(eq(officeAgents.instructionsSealed, false), ne(officeAgents.instructions, "")))
      .all()) {
      const soul = cipher.seal(row.id, row.text);
      // Raw SQL so `updated_at` is not bumped: nothing about the agent changed.
      db.$client
        .prepare(
          "update office_agents set instructions = ?, instructions_sealed = 1 where id = ? and instructions_sealed = 0",
        )
        .run(soul.text, row.id);
      done.souls += 1;
    }
    for (const row of tx
      .select({
        id: officeAgentSoulVersions.id,
        agentId: officeAgentSoulVersions.agentId,
        text: officeAgentSoulVersions.content,
      })
      .from(officeAgentSoulVersions)
      .where(
        and(eq(officeAgentSoulVersions.sealed, false), ne(officeAgentSoulVersions.content, "")),
      )
      .all()) {
      const version = cipher.seal(row.agentId, row.text);
      db.$client
        .prepare(
          "update office_agent_soul_versions set content = ?, sealed = 1 where id = ? and sealed = 0",
        )
        .run(version.text, row.id);
      done.versions += 1;
    }
    for (const row of tx
      .select()
      .from(officeAgentMemories)
      .where(eq(officeAgentMemories.sealed, false))
      .all()) {
      const sealed = sealEntry(cipher, row.agentId, row, "");
      db.$client
        .prepare(
          "update office_agent_memories set title = '', title_key = '', source = '', text = ?, sealed = 1 where id = ? and sealed = 0",
        )
        .run(sealed.text, row.id);
      done.entries += 1;
    }
  });
  if (done.souls + done.versions + done.entries > 0) done.scrubbed = scrub(db);
  return done;
}

/** Drop the plain text the updates left behind in free pages and in the WAL. */
function scrub(db: Db): boolean {
  try {
    db.$client.run("VACUUM");
    db.$client.run("PRAGMA wal_checkpoint(TRUNCATE)");
    return true;
  } catch {
    // The rows are sealed all the same; the caller says that the file was not rebuilt.
    return false;
  }
}
