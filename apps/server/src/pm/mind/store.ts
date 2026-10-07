/**
 * Rows behind an office agent's soul, memories and notes (#136). No
 * authorisation and no checks here: mind.ts validates, people.ts decides who
 * may read, tools/memory.ts is the agent's own way in.
 */
import type { MindAuthor, MindEntry, MindEntryKind, SoulVersionKind } from "@regulus/protocol";
import { and, count, desc, eq, lte } from "drizzle-orm";
import type { DbOrTx } from "../../auth/audit.ts";
import type { Db } from "../../db/index.ts";
import {
  officeAgentMemories,
  officeAgentSoulVersions,
  officeAgents,
  userProfiles,
} from "../../db/schema/index.ts";

export type SoulVersionRow = typeof officeAgentSoulVersions.$inferSelect & { by: string | null };
export type MemoryRow = typeof officeAgentMemories.$inferSelect;

/** Titles are compared without case or repeated spaces. */
export const titleKeyOf = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

export const entryView = (row: MemoryRow): MindEntry => ({
  id: row.id,
  kind: row.kind,
  ...(row.kind === "note" ? { title: row.title } : {}),
  text: row.text,
  ...(row.source ? { source: row.source } : {}),
  by: row.writtenBy,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
});

export class MindStore {
  constructor(
    readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  // ---- Soul ----------------------------------------------------------------------

  /** The soul as engines are started with it; undefined when the agent is gone. */
  currentSoul(agentId: string): string | undefined {
    return this.db
      .select({ instructions: officeAgents.instructions })
      .from(officeAgents)
      .where(eq(officeAgents.id, agentId))
      .get()?.instructions;
  }

  /** Newest first. */
  versions(agentId: string): SoulVersionRow[] {
    return this.db
      .select({ row: officeAgentSoulVersions, by: userProfiles.displayName })
      .from(officeAgentSoulVersions)
      .leftJoin(userProfiles, eq(userProfiles.userId, officeAgentSoulVersions.editedBy))
      .where(eq(officeAgentSoulVersions.agentId, agentId))
      .orderBy(desc(officeAgentSoulVersions.version))
      .all()
      .map(({ row, by }) => ({ ...row, by }));
  }

  version(agentId: string, version: number): SoulVersionRow | undefined {
    const found = this.db
      .select({ row: officeAgentSoulVersions, by: userProfiles.displayName })
      .from(officeAgentSoulVersions)
      .leftJoin(userProfiles, eq(userProfiles.userId, officeAgentSoulVersions.editedBy))
      .where(
        and(
          eq(officeAgentSoulVersions.agentId, agentId),
          eq(officeAgentSoulVersions.version, version),
        ),
      )
      .get();
    return found ? { ...found.row, by: found.by } : undefined;
  }

  latestVersion(agentId: string): SoulVersionRow | undefined {
    return this.versions(agentId)[0];
  }

  /** The new version and the agent's current soul, together; versions past `keep` are dropped. */
  writeSoul(
    agentId: string,
    v: {
      version: number;
      content: string;
      kind: SoulVersionKind;
      revertOf?: number;
      editedBy: string | null;
      added: number;
      removed: number;
    },
    keep: number,
  ): void {
    const at = new Date(this.now());
    this.db.transaction((tx: DbOrTx) => {
      tx.insert(officeAgentSoulVersions)
        .values({
          agentId,
          version: v.version,
          content: v.content,
          kind: v.kind,
          revertOf: v.revertOf ?? null,
          editedBy: v.editedBy,
          linesAdded: v.added,
          linesRemoved: v.removed,
          createdAt: at,
          updatedAt: at,
        })
        .run();
      tx.update(officeAgents)
        .set({ instructions: v.content })
        .where(eq(officeAgents.id, agentId))
        .run();
      tx.delete(officeAgentSoulVersions)
        .where(
          and(
            eq(officeAgentSoulVersions.agentId, agentId),
            lte(officeAgentSoulVersions.version, v.version - keep),
          ),
        )
        .run();
    });
  }

  // ---- Memories and notes ----------------------------------------------------------

  /** Most recently changed first. */
  entries(agentId: string, kind?: MindEntryKind): MemoryRow[] {
    return this.db
      .select()
      .from(officeAgentMemories)
      .where(
        kind
          ? and(eq(officeAgentMemories.agentId, agentId), eq(officeAgentMemories.kind, kind))
          : eq(officeAgentMemories.agentId, agentId),
      )
      .orderBy(desc(officeAgentMemories.updatedAt), desc(officeAgentMemories.createdAt))
      .all();
  }

  count(agentId: string, kind: MindEntryKind): number {
    const row = this.db
      .select({ n: count() })
      .from(officeAgentMemories)
      .where(and(eq(officeAgentMemories.agentId, agentId), eq(officeAgentMemories.kind, kind)))
      .get();
    return row?.n ?? 0;
  }

  /** Only an entry of this agent; another agent's id finds nothing. */
  entry(agentId: string, entryId: string): MemoryRow | undefined {
    return this.db
      .select()
      .from(officeAgentMemories)
      .where(and(eq(officeAgentMemories.agentId, agentId), eq(officeAgentMemories.id, entryId)))
      .get();
  }

  noteByTitle(agentId: string, title: string): MemoryRow | undefined {
    return this.db
      .select()
      .from(officeAgentMemories)
      .where(
        and(
          eq(officeAgentMemories.agentId, agentId),
          eq(officeAgentMemories.kind, "note"),
          eq(officeAgentMemories.titleKey, titleKeyOf(title)),
        ),
      )
      .get();
  }

  insert(
    agentId: string,
    entry: { kind: MindEntryKind; title?: string; text: string; source?: string; by: MindAuthor },
  ): MemoryRow {
    const at = new Date(this.now());
    return this.db
      .insert(officeAgentMemories)
      .values({
        agentId,
        kind: entry.kind,
        title: entry.title ?? "",
        titleKey: entry.title ? titleKeyOf(entry.title) : "",
        text: entry.text,
        source: entry.source ?? "",
        writtenBy: entry.by,
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get();
  }

  update(
    agentId: string,
    entryId: string,
    patch: { title?: string; text?: string },
  ): MemoryRow | undefined {
    return this.db
      .update(officeAgentMemories)
      .set({
        ...(patch.title !== undefined
          ? { title: patch.title, titleKey: titleKeyOf(patch.title) }
          : {}),
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        updatedAt: new Date(this.now()),
      })
      .where(and(eq(officeAgentMemories.agentId, agentId), eq(officeAgentMemories.id, entryId)))
      .returning()
      .get();
  }

  delete(agentId: string, entryId: string): boolean {
    return (
      this.db
        .delete(officeAgentMemories)
        .where(and(eq(officeAgentMemories.agentId, agentId), eq(officeAgentMemories.id, entryId)))
        .returning({ id: officeAgentMemories.id })
        .all().length > 0
    );
  }
}
