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
 * after an update, and a backup copies those pages. So the file must be
 * rebuilt (`VACUUM`) and the WAL emptied afterwards. That this is still owed
 * is written down in the same transaction that seals the rows
 * (`office_agent_settings.mind_scrub_pending`) and cleared only once it was
 * done, so a start that is killed in between is finished by the next one.
 * Backup files made before this ran still hold the plain text until they are
 * pruned.
 */
import { DEFAULT_OFFICE_AGENT_SETTINGS } from "@regulus/protocol";
import { and, eq, ne } from "drizzle-orm";
import type { DbOrTx } from "../../auth/audit.ts";
import type { Db } from "../../db/index.ts";
import {
  officeAgentMemories,
  officeAgentSettings,
  officeAgentSoulVersions,
  officeAgents,
} from "../../db/schema/index.ts";
import type { Logger } from "../../logging.ts";
import { type MindCipher, sealEntry, soulPlace } from "./seal.ts";

export interface SealExistingResult {
  souls: number;
  versions: number;
  entries: number;
  /**
   * Present when a rebuild of the file was owed (rows were sealed now, or by a
   * start that did not get to finish): true only when the file was rebuilt and
   * the WAL emptied; false when old pages may still hold plain text.
   */
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
      cipher.open(soulPlace(row.id), row);
    } catch {
      unreadable += 1;
    }
  }
  return unreadable;
}

const SETTINGS_ID = "office";

/** The file still holds pages from before the rows were sealed. */
export function scrubPending(db: Db): boolean {
  return (
    db
      .select({ pending: officeAgentSettings.mindScrubPending })
      .from(officeAgentSettings)
      .where(eq(officeAgentSettings.id, SETTINGS_ID))
      .get()?.pending ?? false
  );
}

function setScrubPending(db: DbOrTx, pending: boolean): void {
  db.insert(officeAgentSettings)
    .values({ id: SETTINGS_ID, ...DEFAULT_OFFICE_AGENT_SETTINGS, mindScrubPending: pending })
    .onConflictDoUpdate({ target: officeAgentSettings.id, set: { mindScrubPending: pending } })
    .run();
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
      const soul = cipher.seal(soulPlace(row.id), row.text);
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
      const place = { agentId: row.agentId, kind: "version", rowId: row.id } as const;
      const version = cipher.seal(place, row.text);
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
      const place = { agentId: row.agentId, kind: "entry", rowId: row.id } as const;
      const sealed = sealEntry(cipher, place, row, "");
      db.$client
        .prepare(
          "update office_agent_memories set title = '', title_key = '', source = '', text = ?, sealed = 1 where id = ? and sealed = 0",
        )
        .run(sealed.text, row.id);
      done.entries += 1;
    }
    // With the rows, so it cannot be lost: the file is to be rebuilt.
    if (done.souls + done.versions + done.entries > 0) setScrubPending(tx, true);
  });
  if (scrubPending(db)) {
    done.scrubbed = scrub(db);
    if (done.scrubbed) setScrubPending(db, false);
  }
  return done;
}

/**
 * Drop the plain text the updates left behind in free pages and in the WAL.
 * True only when the file was rebuilt and the whole WAL was written back and
 * emptied (another connection reading at that moment keeps it from being).
 */
function scrub(db: Db): boolean {
  try {
    db.$client.run("VACUUM");
    const result = db.$client.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as {
      busy?: number;
    } | null;
    return (result?.busy ?? 0) === 0;
  } catch {
    // The rows are sealed all the same; the marker stays and the next start tries again.
    return false;
  }
}

/** The data step of migration 0028: encrypt what is still plain text, or say that it cannot be. */
export function sealAtStart(db: Db, cipher: MindCipher, logger: Logger): void {
  const unreadable = countUnreadable(db, cipher);
  if (unreadable > 0) {
    logger.error(
      { agents: unreadable },
      "office agents' documents are encrypted under a key this office does not have: check OFFICE_MASTER_KEY (and OFFICE_MASTER_KEY_PREVIOUS after a rotation); those agents cannot be started or read until it is right",
    );
  }
  if (!cipher.on) {
    const plain = countUnsealed(db);
    if (plain.souls + plain.versions + plain.entries > 0) {
      logger.warn(
        plain,
        "OFFICE_MASTER_KEY is not set: office agents' documents, memories and notes are stored as plain text and show in backups",
      );
    }
    return;
  }
  const sealed = sealExisting(db, cipher);
  if (sealed.souls + sealed.versions + sealed.entries > 0) {
    logger.info(sealed, "encrypted office agents' documents, memories and notes at rest");
  }
  if (sealed.scrubbed === true) {
    logger.info("rebuilt the database file: no plain text of agents' documents is left in it");
  } else if (sealed.scrubbed === false) {
    logger.warn(
      "the database file could not be rebuilt after encrypting (it was busy): old pages and backups made now may still hold plain text; the next start tries again",
    );
  }
}
