/**
 * An office agent's soul, memories and notes (SPEC §10 M5, D20; #136): the
 * office's own copy, which is the source of truth whatever an engine keeps.
 *
 * Everything that is stored passes through here, whoever writes it (a person
 * in Settings, the agent through a tool, an engine through its port), so the
 * rules cannot differ by path:
 * - text that looks like a secret is refused (guard below), never stored;
 * - size caps come from the protocol schemas, count caps are checked here:
 *   a full store refuses new entries instead of silently dropping old ones;
 * - a soul keeps its last `soulVersionsKept` versions.
 *
 * Who may *read* is not decided here: people.ts (people) and tools/memory.ts
 * (the agent itself, only its own) do that. Nothing in this module logs or
 * returns text in an error.
 *
 * Rooms (#301): a memory or note carries the rooms it may be about, and a
 * reader that brings a `Visible` filter (../scope.ts) is given only entries it
 * may see. An entry the reader may not see behaves like one that is not
 * there: not listed, not counted, not found by id or title. So a note's
 * title is unique among the notes its writer can see (a note they cannot see
 * may have the same one), and the caps count what the writer can see. Behind
 * that is a hard cap on rows, which fails like any other storage failure.
 */
import {
  diffStat,
  OFFICE_AGENT_MIND_LIMITS as LIMITS,
  type MindAuthor,
  type MindEntry,
  type MindEntryKind,
  type OfficeAgentSoul,
  type SoulVersion,
  type SoulVersionKind,
  type SoulVersionSummary,
} from "@regulus/protocol";
import { findSecretLike, type SecretLikeKind } from "../../secrets/redact.ts";
import type { Visible } from "../scope.ts";
import { type Digest, digestOf } from "./digest.ts";
import { SealedUnreadable } from "./seal.ts";
import { entryView, type MemoryRow, type MindStore, type SoulVersionRow } from "./store.ts";

export type MindErrorCode =
  | "secret_rejected"
  | "cap_reached"
  | "not_found"
  | "soul_changed"
  | "too_large"
  | "title_taken"
  | "unreadable";

/** A refusal whose message is safe to show to the person or the agent: it never quotes the text. */
export class MindError extends Error {
  override name = "MindError";
  constructor(
    readonly code: MindErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const SECRET_WORDS: Readonly<Record<SecretLikeKind, string>> = {
  provider_key: "a provider key or GitHub token",
  office_token: "an office access code",
  private_key: "a private key",
  env_secret: "a setting that holds a key or password",
  token: "a long key-like string",
};

/** Refuse text that looks like it holds a secret. The message names the line, never the text. */
export function assertNoSecret(what: string, text: string): void {
  const found = findSecretLike(text);
  if (!found) return;
  throw new MindError(
    "secret_rejected",
    `${what} was not saved: line ${found.line} looks like ${SECRET_WORDS[found.kind]}. Secrets are never stored here; take it out and save again.`,
  );
}

const clean = (text: string) => text.replace(/\r\n?/g, "\n");

const summary = (row: SoulVersionRow): SoulVersionSummary => ({
  version: row.version,
  kind: row.kind,
  ...(row.revertOf ? { revertOf: row.revertOf } : {}),
  ...(row.by ? { by: row.by } : {}),
  ts: row.createdAt.getTime(),
  chars: row.content.length,
  added: row.linesAdded,
  removed: row.linesRemoved,
});

export interface SoulSaved {
  soul: OfficeAgentSoul;
  /** False when the text was the same and no version was written. */
  changed: boolean;
  added: number;
  removed: number;
}

const shown = (visible: Visible, row: MemoryRow) => !visible || visible(row.rooms);
/** Rows of one kind an agent may hold at most, whoever can see them, as a multiple of the cap. */
const HARD_CAP_FACTOR = 4;
const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].sort();

/** A row that cannot be decrypted as a refusal with fixed words, instead of a crash. */
function readable<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof SealedUnreadable) throw new MindError("unreadable", err.message);
    throw err;
  }
}

export class AgentMind {
  constructor(private readonly store: MindStore) {}

  // ---- Soul ----------------------------------------------------------------------

  soul(agentId: string): OfficeAgentSoul {
    const content = readable(() => this.store.currentSoul(agentId));
    if (content === undefined) throw new MindError("not_found", "no such agent");
    const latest = readable(() => this.store.latestVersion(agentId));
    return {
      agentId,
      version: latest?.version ?? 0,
      content,
      ...(latest ? { updatedAt: latest.createdAt.getTime() } : {}),
    };
  }

  saveSoul(
    agentId: string,
    content: string,
    by: { userId: string | null; kind: SoulVersionKind; revertOf?: number; baseVersion?: number },
  ): SoulSaved {
    const text = clean(content);
    if (text.length > LIMITS.soulMax) {
      throw new MindError("too_large", `at most ${LIMITS.soulMax} characters`);
    }
    assertNoSecret("This text", text);
    const current = this.soul(agentId);
    if (by.baseVersion !== undefined && by.baseVersion !== current.version) {
      throw new MindError(
        "soul_changed",
        "someone saved a newer version while you were editing; look at it before saving yours",
      );
    }
    if (text === current.content && (current.version > 0 || text === "")) {
      return { soul: current, changed: false, added: 0, removed: 0 };
    }
    const { added, removed } = diffStat(current.version > 0 ? current.content : "", text);
    this.store.writeSoul(
      agentId,
      {
        version: current.version + 1,
        content: text,
        kind: by.kind,
        revertOf: by.revertOf,
        editedBy: by.userId,
        added,
        removed,
      },
      LIMITS.soulVersionsKept,
    );
    return { soul: this.soul(agentId), changed: true, added, removed };
  }

  versions(agentId: string): SoulVersionSummary[] {
    return readable(() => this.store.versions(agentId)).map(summary);
  }

  version(agentId: string, version: number): SoulVersion {
    const row = readable(() => this.store.version(agentId, version));
    if (!row) throw new MindError("not_found", "no such version");
    return { ...summary(row), content: row.content };
  }

  /** Bring an older version's text back as a new version; history is never rewritten. */
  revertSoul(agentId: string, version: number, userId: string): SoulSaved {
    const old = this.version(agentId, version);
    return this.saveSoul(agentId, old.content, { userId, kind: "revert", revertOf: version });
  }

  // ---- Memories and notes ----------------------------------------------------------

  #entries(agentId: string, kind: MindEntryKind | undefined, visible: Visible): MemoryRow[] {
    return readable(() => this.store.entries(agentId, kind)).filter((row) => shown(visible, row));
  }

  list(
    agentId: string,
    kind: MindEntryKind,
    opts: { query?: string; limit?: number; visible?: Visible } = {},
  ) {
    const all = this.#entries(agentId, kind, opts.visible).map(entryView);
    const found = opts.query ? all.filter(matcher(opts.query)) : all;
    return {
      entries: found.slice(0, opts.limit ?? LIMITS.pageMax),
      // Of what the reader may see: an entry closed to them is not counted either.
      total: all.length,
      max: kind === "memory" ? LIMITS.memoriesMax : LIMITS.notesMax,
    };
  }

  /**
   * Memories and notes that hold every word of the query, most recently
   * changed first. The text is encrypted in the database (#301), so the
   * agent's entries are opened here and matched in memory: one agent has at
   * most `memoriesMax` + `notesMax` of them.
   */
  search(agentId: string, query: string, limit = 20, visible?: Visible): MindEntry[] {
    return this.#entries(agentId, undefined, visible)
      .map(entryView)
      .filter(matcher(query))
      .slice(0, limit);
  }

  /** Refuse a new entry when the writer already sees as many as one agent may have. */
  #room(agentId: string, kind: MindEntryKind, visible: Visible): void {
    const max = kind === "memory" ? LIMITS.memoriesMax : LIMITS.notesMax;
    const seen = this.store.scopes(agentId, kind).filter((rooms) => !visible || visible(rooms));
    if (seen.length >= max) {
      throw new MindError(
        "cap_reached",
        kind === "memory"
          ? `there are already ${max} memories; forget some before saving more`
          : `there are already ${max} notes; delete some before writing more`,
      );
    }
    // Entries the writer cannot see do not count above; this keeps the table bounded all the
    // same, and says nothing a failing disk would not say.
    if (this.store.total(agentId, kind) >= max * HARD_CAP_FACTOR) {
      throw new Error("office agent mind store is full");
    }
  }

  /**
   * The note a title means for a reader. Several notes can have one title
   * (each about rooms the others' readers cannot all see), so among those the
   * reader can see: first one that was written for them (in their own
   * conversation with the agent, or by their hand), then the one about the
   * most rooms (the one fewest people share), then the most recently changed.
   * So a note someone else left with the same title, visible to everyone,
   * never stands in for the reader's own.
   */
  #noteByTitle(
    agentId: string,
    title: string,
    visible: Visible,
    forUser?: string,
  ): MemoryRow | undefined {
    const seen = readable(() => this.store.notesByTitle(agentId, title)).filter((row) =>
      shown(visible, row),
    );
    const own = (row: MemoryRow) => Number(forUser !== undefined && row.forUserId === forUser);
    // (A stable sort: notes that tie stay most recently changed first.)
    return seen.sort((a, b) => own(b) - own(a) || b.rooms.length - a.rooms.length)[0];
  }

  #row(agentId: string, entryId: string, visible: Visible): MemoryRow {
    const row = readable(() => this.store.entry(agentId, entryId));
    if (!row || !shown(visible, row)) throw new MindError("not_found", "no such memory or note");
    return row;
  }

  entry(agentId: string, entryId: string, visible?: Visible): MindEntry {
    return entryView(this.#row(agentId, entryId, visible));
  }

  addMemory(
    agentId: string,
    input: { text: string; source?: string },
    by: MindAuthor,
    rooms: readonly string[] = [],
    visible?: Visible,
    forUser?: string,
  ): MindEntry {
    const text = clean(input.text).trim();
    const source = input.source ? clean(input.source).trim() : undefined;
    assertNoSecret("That memory", `${text}\n${source ?? ""}`);
    this.#room(agentId, "memory", visible);
    return entryView(
      this.store.insert(agentId, { kind: "memory", text, source, by, rooms, forUserId: forUser }),
    );
  }

  note(agentId: string, title: string, visible?: Visible, forUser?: string): MindEntry {
    const row = this.#noteByTitle(agentId, title, visible, forUser);
    if (!row) throw new MindError("not_found", "no note with that title");
    return entryView(row);
  }

  /**
   * Create the note with this title, or replace (or add to) the one that has
   * it. A note that is changed keeps the rooms it had and takes the new ones.
   */
  writeNote(
    agentId: string,
    input: { title: string; text: string; append?: boolean },
    by: MindAuthor,
    opts: { rooms?: readonly string[]; visible?: Visible; forUser?: string } = {},
  ): { entry: MindEntry; created: boolean } {
    const title = input.title.trim();
    // Among the notes the writer can see: one they cannot see may have this title as well.
    const existing = this.#noteByTitle(agentId, title, opts.visible, opts.forUser);
    const added = clean(input.text);
    const text = existing && input.append ? `${existing.text.trimEnd()}\n${added}` : added;
    if (text.length > LIMITS.noteTextMax) {
      throw new MindError("too_large", `a note holds at most ${LIMITS.noteTextMax} characters`);
    }
    assertNoSecret("That note", `${title}\n${text}`);
    if (existing) {
      const rooms = union(existing.rooms, opts.rooms ?? []);
      const row = this.store.update(agentId, existing.id, { text, rooms });
      if (!row) throw new MindError("not_found", "no note with that title");
      return { entry: entryView(row), created: false };
    }
    this.#room(agentId, "note", opts.visible);
    const row = this.store.insert(agentId, {
      kind: "note",
      title,
      text,
      by,
      rooms: opts.rooms,
      forUserId: opts.forUser,
    });
    return { entry: entryView(row), created: true };
  }

  /** A person corrects an entry: a memory's text, or a note's title and text. Its rooms stay. */
  update(
    agentId: string,
    entryId: string,
    patch: { title?: string; text?: string },
    visible?: Visible,
  ): MindEntry {
    const row = this.#row(agentId, entryId, visible);
    const text = patch.text === undefined ? undefined : clean(patch.text);
    const max = row.kind === "memory" ? LIMITS.memoryTextMax : LIMITS.noteTextMax;
    if (text !== undefined && (text.length > max || (row.kind === "memory" && !text.trim()))) {
      throw new MindError("too_large", `between 1 and ${max} characters`);
    }
    const title = row.kind === "note" ? patch.title?.trim() : undefined;
    if (title !== undefined) {
      const other = readable(() => this.store.notesByTitle(agentId, title)).find(
        (note) => note.id !== row.id && shown(visible, note),
      );
      if (other) {
        throw new MindError("title_taken", "another note already has that title");
      }
    }
    assertNoSecret(
      row.kind === "memory" ? "That memory" : "That note",
      `${title ?? ""}\n${text ?? ""}`,
    );
    const saved = this.store.update(agentId, entryId, { title, text });
    if (!saved) throw new MindError("not_found", "no such memory or note");
    return entryView(saved);
  }

  /** The removed entry, so the caller can audit its kind and size. */
  remove(agentId: string, entryId: string, visible?: Visible): MindEntry {
    const entry = this.entry(agentId, entryId, visible);
    this.store.delete(agentId, entryId);
    return entry;
  }

  // ---- For engines -----------------------------------------------------------------

  /** What the agent remembers as text, of what the reader may see, and the rooms that text may be about. */
  recall(agentId: string, visible?: Visible): Digest {
    return digestOf(
      this.#entries(agentId, "memory", visible).map(entryView),
      this.#entries(agentId, "note", visible).map(entryView),
    );
  }

  digest(agentId: string, visible?: Visible): string {
    return this.recall(agentId, visible).text;
  }
}

/** Every word of the query appears in the title, text or source (no case). */
function matcher(query: string): (entry: MindEntry) => boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (entry) => {
    const hay = `${entry.title ?? ""}\n${entry.text}\n${entry.source ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
}
