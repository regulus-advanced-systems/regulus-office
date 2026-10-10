/**
 * Rows behind an office agent's soul, memories and notes (#136). No
 * authorisation and no checks here: mind.ts validates, people.ts decides who
 * may read, tools/memory.ts is the agent's own way in.
 *
 * The text is encrypted on its way into a row and opened on its way out
 * (#301, seal.ts), so nothing above this module sees an envelope. A sealed
 * note has no readable title in its row: it is found by opening the agent's
 * notes (at most `notesMax` of them) and comparing titles here.
 *
 * An entry whose room scope is not known (`parseRooms` gives null: a shared
 * agent's entries from before scopes existed, or a value that does not parse)
 * never leaves this module: it is kept in the database and is not listed,
 * found or counted for anyone.
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
import { type MindCipher, openEntry, PLAIN, type Place, sealEntry, soulPlace } from "./seal.ts";

type VersionRow = typeof officeAgentSoulVersions.$inferSelect;
/** A soul version with its text opened. */
export type SoulVersionRow = Omit<VersionRow, "sealed"> & { by: string | null };
type StoredMemory = typeof officeAgentMemories.$inferSelect;
/** A memory or note with its text opened and its rooms read. */
export type MemoryRow = Omit<StoredMemory, "sealed" | "roomScope" | "titleKey"> & {
  /** The rooms it may be about (#301): operation ids. */
  rooms: string[];
};

/** Titles are compared without case or repeated spaces. */
export const titleKeyOf = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

/** The scope migration 0028 gives a shared agent's earlier entries: rooms unknown, shown to nobody. */
export const UNKNOWN_SCOPE = "unknown";
/** Stands in for a scope that cannot be read where a list of rooms is needed: a room nobody can see. */
export const UNKNOWN_ROOM = "\u0000unknown";

/**
 * A stored room scope as ids, or null when it is not a list of ids: then the
 * rooms are unknown and whatever carries it is closed to everyone.
 */
export function parseRooms(json: string): string[] | null {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  } catch {
    return null;
  }
}

/** As `parseRooms`, for callers that need rooms: an unknown scope is a room nobody can see. */
export const roomsOf = (json: string): string[] => parseRooms(json) ?? [UNKNOWN_ROOM];

const versionPlace = (agentId: string, rowId: string): Place => ({
  agentId,
  kind: "version",
  rowId,
});
const entryPlace = (agentId: string, rowId: string): Place => ({ agentId, kind: "entry", rowId });

export const roomsJson = (rooms: readonly string[]) => JSON.stringify([...new Set(rooms)].sort());

export const entryView = (row: MemoryRow): MindEntry => ({
  id: row.id,
  kind: row.kind,
  ...(row.kind === "note" ? { title: row.title } : {}),
  text: row.text,
  ...(row.source ? { source: row.source } : {}),
  by: row.writtenBy,
  ...(row.rooms.length > 0 ? { rooms: row.rooms } : {}),
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
});

export class MindStore {
  constructor(
    readonly db: Db,
    private readonly now: () => number = Date.now,
    private readonly cipher: MindCipher = PLAIN,
  ) {}

  // ---- Soul ----------------------------------------------------------------------

  /** The soul as engines are started with it; undefined when the agent is gone. */
  currentSoul(agentId: string): string | undefined {
    const row = this.db
      .select({ text: officeAgents.instructions, sealed: officeAgents.instructionsSealed })
      .from(officeAgents)
      .where(eq(officeAgents.id, agentId))
      .get();
    return row ? this.cipher.open(soulPlace(agentId), row) : undefined;
  }

  #version = ({ row, by }: { row: VersionRow; by: string | null }): SoulVersionRow => {
    const { sealed, ...rest } = row;
    const place = versionPlace(row.agentId, row.id);
    return { ...rest, content: this.cipher.open(place, { text: row.content, sealed }), by };
  };

  /** Newest first. */
  versions(agentId: string): SoulVersionRow[] {
    return this.db
      .select({ row: officeAgentSoulVersions, by: userProfiles.displayName })
      .from(officeAgentSoulVersions)
      .leftJoin(userProfiles, eq(userProfiles.userId, officeAgentSoulVersions.editedBy))
      .where(eq(officeAgentSoulVersions.agentId, agentId))
      .orderBy(desc(officeAgentSoulVersions.version))
      .all()
      .map(this.#version);
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
    return found ? this.#version(found) : undefined;
  }

  latestVersion(agentId: string): SoulVersionRow | undefined {
    const found = this.db
      .select({ row: officeAgentSoulVersions, by: userProfiles.displayName })
      .from(officeAgentSoulVersions)
      .leftJoin(userProfiles, eq(userProfiles.userId, officeAgentSoulVersions.editedBy))
      .where(eq(officeAgentSoulVersions.agentId, agentId))
      .orderBy(desc(officeAgentSoulVersions.version))
      .limit(1)
      .get();
    return found ? this.#version(found) : undefined;
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
    // Two envelopes, each bound to its own row.
    const id = crypto.randomUUID();
    const version = this.cipher.seal(versionPlace(agentId, id), v.content);
    const current = this.cipher.seal(soulPlace(agentId), v.content);
    this.db.transaction((tx: DbOrTx) => {
      tx.insert(officeAgentSoulVersions)
        .values({
          id,
          agentId,
          version: v.version,
          content: version.text,
          sealed: version.sealed,
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
        .set({ instructions: current.text, instructionsSealed: current.sealed })
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

  /** The row opened, or nothing when its rooms are unknown. */
  #entry = (row: StoredMemory): MemoryRow[] => {
    const { sealed: _sealed, roomScope, titleKey: _titleKey, ...rest } = row;
    const rooms = parseRooms(roomScope);
    if (rooms === null) return [];
    return [{ ...rest, ...openEntry(this.cipher, entryPlace(row.agentId, row.id), row), rooms }];
  };

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
      .all()
      .flatMap(this.#entry);
  }

  /** The rooms of each entry of that kind whose rooms are known, without opening any text: for the caps. */
  scopes(agentId: string, kind: MindEntryKind): string[][] {
    return this.db
      .select({ scope: officeAgentMemories.roomScope })
      .from(officeAgentMemories)
      .where(and(eq(officeAgentMemories.agentId, agentId), eq(officeAgentMemories.kind, kind)))
      .all()
      .flatMap((row) => {
        const rooms = parseRooms(row.scope);
        return rooms ? [rooms] : [];
      });
  }

  /** Every row of that kind, those nobody is shown included: for the hard cap only. */
  total(agentId: string, kind: MindEntryKind): number {
    const row = this.db
      .select({ n: count() })
      .from(officeAgentMemories)
      .where(and(eq(officeAgentMemories.agentId, agentId), eq(officeAgentMemories.kind, kind)))
      .get();
    return row?.n ?? 0;
  }

  /** Only an entry of this agent; another agent's id finds nothing. */
  entry(agentId: string, entryId: string): MemoryRow | undefined {
    const row = this.db
      .select()
      .from(officeAgentMemories)
      .where(and(eq(officeAgentMemories.agentId, agentId), eq(officeAgentMemories.id, entryId)))
      .get();
    return row ? this.#entry(row)[0] : undefined;
  }

  /** Every note with this title: there can be several, each about rooms the others' readers cannot see. */
  notesByTitle(agentId: string, title: string): MemoryRow[] {
    const key = titleKeyOf(title);
    return this.entries(agentId, "note").filter((note) => titleKeyOf(note.title) === key);
  }

  insert(
    agentId: string,
    entry: {
      kind: MindEntryKind;
      title?: string;
      text: string;
      source?: string;
      by: MindAuthor;
      rooms?: readonly string[];
    },
  ): MemoryRow {
    const at = new Date(this.now());
    const title = entry.title ?? "";
    const id = crypto.randomUUID();
    const row = this.db
      .insert(officeAgentMemories)
      .values({
        id,
        agentId,
        kind: entry.kind,
        ...sealEntry(
          this.cipher,
          entryPlace(agentId, id),
          { title, text: entry.text, source: entry.source ?? "" },
          title ? titleKeyOf(title) : "",
        ),
        writtenBy: entry.by,
        roomScope: roomsJson(entry.rooms ?? []),
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get();
    return this.#entry(row)[0] as MemoryRow;
  }

  update(
    agentId: string,
    entryId: string,
    patch: { title?: string; text?: string; rooms?: readonly string[] },
  ): MemoryRow | undefined {
    const before = this.entry(agentId, entryId);
    if (!before) return undefined;
    const title = patch.title ?? before.title;
    const row = this.db
      .update(officeAgentMemories)
      .set({
        ...sealEntry(
          this.cipher,
          entryPlace(agentId, entryId),
          { title, text: patch.text ?? before.text, source: before.source },
          title ? titleKeyOf(title) : "",
        ),
        ...(patch.rooms ? { roomScope: roomsJson(patch.rooms) } : {}),
        updatedAt: new Date(this.now()),
      })
      .where(and(eq(officeAgentMemories.agentId, agentId), eq(officeAgentMemories.id, entryId)))
      .returning()
      .get();
    return row ? this.#entry(row)[0] : undefined;
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
