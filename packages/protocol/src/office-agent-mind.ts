/**
 * What an office agent is and what it knows (SPEC §10 M5, D20, D28; #136):
 *
 * - its **soul**: one document per agent ("Who it is and how it works" in the
 *   UI; the agent form's former "Instructions"), loaded into the agent at
 *   every start, with a version history, diff and revert;
 * - its **memories**: short entries the agent saves through the office tools
 *   (`memory_save`, `memory_search`, ...) or its person writes by hand;
 * - its **notes**: longer titled documents (a journal, a brief draft).
 *
 * The office keeps all three and is the source of truth; engines get them
 * from the office (see `apps/server/src/pm/engines/types.ts`, `EngineMind`).
 *
 * Who may read and change them (D20 as changed on 2026-10-07; the server
 * enforces it on every path):
 * - a **personal** agent's soul, memories and notes: only the person it
 *   belongs to. Office owners and admins cannot read them at all;
 * - a **shared** agent's: office owners and admins, and of its memories and
 *   notes only those about rooms they can see themselves (#301): an entry
 *   about a room closed to the reader is not listed, counted or found.
 * The agent itself reaches its own through the office tools with its token.
 *
 * None of them may hold a secret: text that looks like a key is refused.
 */
import { z } from "zod";
import { Id, TimestampMs } from "./common.ts";
import type { UserRole } from "./enums.ts";
import { OFFICE_AGENT_LIMITS, OFFICE_AGENTS_API_PATH } from "./office-agents.ts";

/** Paths under `/api/office-agents/:id`. */
export const officeAgentMindPaths = (agentId: string) => {
  const base = `${OFFICE_AGENTS_API_PATH}/${encodeURIComponent(agentId)}`;
  return {
    soul: `${base}/soul`,
    soulVersions: `${base}/soul/versions`,
    soulVersion: (version: number) => `${base}/soul/versions/${version}`,
    soulRevert: `${base}/soul/revert`,
    entries: `${base}/memories`,
    entry: (entryId: string) => `${base}/memories/${encodeURIComponent(entryId)}`,
  };
};

export const OFFICE_AGENT_MIND_LIMITS = {
  /** Characters in a soul (the same cap the form's instructions had). */
  soulMax: OFFICE_AGENT_LIMITS.instructionsMax,
  /** Versions of a soul the office keeps; older ones are dropped. */
  soulVersionsKept: 50,
  memoryTextMax: 2000,
  /** Memories one agent keeps. When full, saving is refused until some are forgotten. */
  memoriesMax: 500,
  noteTitleMax: 120,
  noteTextMax: 20_000,
  notesMax: 200,
  /** Where a memory came from ("Ante, in chat", "PR 12"). */
  sourceMax: 200,
  queryMax: 200,
  /** Entries one list or search returns at most. */
  pageMax: 100,
} as const;

export const MIND_ENTRY_KINDS = ["memory", "note"] as const;
export type MindEntryKind = (typeof MIND_ENTRY_KINDS)[number];

/** Who wrote an entry or a soul version: the agent itself, or a person in Settings. */
export const MIND_AUTHORS = ["agent", "person"] as const;
export type MindAuthor = (typeof MIND_AUTHORS)[number];

/** How a soul version came to be. */
export const SOUL_VERSION_KINDS = ["created", "edit", "revert", "imported"] as const;
export type SoulVersionKind = (typeof SOUL_VERSION_KINDS)[number];

export const SoulVersionSummary = z.object({
  version: z.number().int().positive(),
  kind: z.enum(SOUL_VERSION_KINDS),
  /** For a revert: the version whose text was brought back. */
  revertOf: z.number().int().positive().optional(),
  /** Display name of the person who saved it; absent when they are gone. */
  by: z.string().optional(),
  ts: TimestampMs,
  chars: z.number().int().nonnegative(),
  /** Lines added and removed against the version before it. */
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});
export type SoulVersionSummary = z.infer<typeof SoulVersionSummary>;

export const SoulVersion = SoulVersionSummary.extend({ content: z.string() });
export type SoulVersion = z.infer<typeof SoulVersion>;

/** The current soul. `version` is 0 while nothing was ever written. */
export const OfficeAgentSoul = z.object({
  agentId: Id,
  version: z.number().int().nonnegative(),
  content: z.string(),
  updatedAt: TimestampMs.optional(),
});
export type OfficeAgentSoul = z.infer<typeof OfficeAgentSoul>;

export const SoulVersionsResponse = z.object({ versions: z.array(SoulVersionSummary) });
export type SoulVersionsResponse = z.infer<typeof SoulVersionsResponse>;

const SoulText = z.string().max(OFFICE_AGENT_MIND_LIMITS.soulMax);

export const SaveOfficeAgentSoul = z.object({
  content: SoulText,
  /** The version the editor started from; a save over a newer one is refused (`soul_changed`). */
  baseVersion: z.number().int().nonnegative().optional(),
});
export const RevertOfficeAgentSoul = z.object({ version: z.number().int().positive() });

export const MindEntry = z.object({
  id: Id,
  kind: z.enum(MIND_ENTRY_KINDS),
  /** Notes have a title; memories do not. */
  title: z.string().optional(),
  text: z.string(),
  source: z.string().optional(),
  by: z.enum(MIND_AUTHORS),
  /**
   * A shared agent's entry (#301): the rooms (operation ids) it may be about.
   * It is shown only to people who can see every one of them, so a reader
   * who gets the entry can also see these rooms. Left out when it has none.
   */
  rooms: z.array(Id).optional(),
  createdAt: TimestampMs,
  updatedAt: TimestampMs,
});
export type MindEntry = z.infer<typeof MindEntry>;

export const MindEntriesResponse = z.object({
  entries: z.array(MindEntry),
  /** How many of that kind the agent has in all, and how many it may have. */
  total: z.number().int().nonnegative(),
  max: z.number().int().positive(),
});
export type MindEntriesResponse = z.infer<typeof MindEntriesResponse>;

export const MemoryText = z.string().trim().min(1).max(OFFICE_AGENT_MIND_LIMITS.memoryTextMax);
export const NoteTitle = z
  .string()
  .trim()
  .min(1)
  .max(OFFICE_AGENT_MIND_LIMITS.noteTitleMax)
  .refine((v) => !/[\r\n]/.test(v), { message: "one line" });
export const NoteText = z.string().max(OFFICE_AGENT_MIND_LIMITS.noteTextMax);
export const MindSource = z.string().trim().max(OFFICE_AGENT_MIND_LIMITS.sourceMax);
export const MindQuery = z.string().trim().max(OFFICE_AGENT_MIND_LIMITS.queryMax);

/**
 * The rooms an entry written by hand is about (#301): shared agents only, and
 * only rooms the writer can see themselves. Left out: about no room.
 */
export const MindRooms = z.array(Id).max(50).optional();

export const CreateMindEntry = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("memory"),
    text: MemoryText,
    source: MindSource.optional(),
    rooms: MindRooms,
  }),
  z.object({ kind: z.literal("note"), title: NoteTitle, text: NoteText, rooms: MindRooms }),
]);
export type CreateMindEntry = z.input<typeof CreateMindEntry>;

/** A memory's text, or a note's title and text. */
export const UpdateMindEntry = z
  .object({ title: NoteTitle, text: z.string().max(OFFICE_AGENT_MIND_LIMITS.noteTextMax) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to change" });
export type UpdateMindEntry = z.input<typeof UpdateMindEntry>;

/**
 * Read and change an agent's soul, memories and notes (D20). Personal: its
 * owner and nobody else, whatever their office role. Shared: office owners
 * and admins.
 */
export function mayReadOfficeAgentMind(
  actor: { id: string; role: UserRole },
  agent: { ownerUserId: string | null },
): boolean {
  return agent.ownerUserId === null
    ? actor.role === "owner" || actor.role === "admin"
    : agent.ownerUserId === actor.id;
}
