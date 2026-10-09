/**
 * The tools an agent keeps its own mind with (#136): read its soul, save,
 * search, list and forget memories, write and read notes.
 *
 * An agent reaches only its own: every call is made with `call.agent.id`,
 * taken from the token, and no input names another agent. The office's copy
 * is what these read and write (mind/mind.ts), with its secret check and caps.
 *
 * The audit row of a call (tools/call.ts) says which tool ran, on which entry
 * and how long the text was; it never holds the text, a title or a query.
 *
 * A shared agent keeps one pool for everyone it talks to, so its entries carry
 * rooms (#301). What it saves takes the rooms its conversation has read
 * (`scopeOf`); what it is given is only what the person it is answering can
 * see (`visibleIn`), and an entry closed to them is not there at all: not
 * listed, not counted, not found. Reading an entry brings its rooms into the
 * conversation (`saw`). Nothing here is declared by the agent itself.
 */
import type { MindEntry, OfficeToolInput } from "@regulus/protocol";
import { MindError } from "../mind/mind.ts";
import { saw, scopeOf, visibleIn } from "./asking.ts";
import { type ToolCall, ToolError } from "./context.ts";

/** A refusal from the mind as a tool error; its message never quotes the text. */
function run<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (!(err instanceof MindError)) throw err;
    const code =
      err.code === "secret_rejected" || err.code === "cap_reached" || err.code === "not_found"
        ? err.code
        : err.code === "unreadable"
          ? "unavailable"
          : "invalid_input";
    throw new ToolError(code, err.message);
  }
}

/** The entries were handed to the agent: their rooms are in its conversation now. */
function read(call: ToolCall, entries: readonly MindEntry[]): void {
  saw(call, ...entries.flatMap((e) => e.rooms ?? []));
}

const memory = (e: MindEntry) => ({
  id: e.id,
  text: e.text,
  ...(e.source ? { source: e.source } : {}),
  savedAt: e.updatedAt,
});
const noteHead = (e: MindEntry) => ({
  title: e.title ?? "",
  chars: e.text.length,
  changedAt: e.updatedAt,
});

export function soulRead(call: ToolCall) {
  const soul = run(() => call.mind.soul(call.agent.id));
  return { version: soul.version, content: soul.content };
}

export function memorySave(call: ToolCall, input: OfficeToolInput<"memory_save">) {
  const entry = run(() => call.mind.addMemory(call.agent.id, input, "agent", scopeOf(call)));
  call.auditMeta = { entryId: entry.id, kind: "memory", chars: entry.text.length };
  return { id: entry.id, saved: true };
}

export function memorySearch(call: ToolCall, input: OfficeToolInput<"memory_search">) {
  const found = run(() =>
    call.mind.search(call.agent.id, input.query, input.limit, visibleIn(call)),
  );
  read(call, found);
  return {
    memories: found.filter((e) => e.kind === "memory").map(memory),
    notes: found
      .filter((e) => e.kind === "note")
      .map((e) => ({ ...noteHead(e), excerpt: e.text.slice(0, 300) })),
  };
}

export function memoryList(call: ToolCall, input: OfficeToolInput<"memory_list">) {
  const page = run(() =>
    call.mind.list(call.agent.id, "memory", { limit: input.limit ?? 20, visible: visibleIn(call) }),
  );
  read(call, page.entries);
  return { memories: page.entries.map(memory), total: page.total, max: page.max };
}

export function memoryForget(call: ToolCall, input: OfficeToolInput<"memory_forget">) {
  const gone = run(() => {
    // A note's id is not a memory: notes are deleted by title.
    const entry = call.mind.entry(call.agent.id, input.id, visibleIn(call));
    if (entry.kind !== "memory") throw new MindError("not_found", "no such memory");
    return call.mind.remove(call.agent.id, input.id, visibleIn(call));
  });
  call.auditMeta = { entryId: gone.id, kind: "memory", removed: true };
  return { forgotten: true };
}

export function noteWrite(call: ToolCall, input: OfficeToolInput<"note_write">) {
  const { entry, created } = run(() =>
    call.mind.writeNote(call.agent.id, input, "agent", {
      rooms: scopeOf(call),
      visible: visibleIn(call),
    }),
  );
  call.auditMeta = { entryId: entry.id, kind: "note", chars: entry.text.length, created };
  return { ...noteHead(entry), created };
}

export function noteRead(call: ToolCall, input: OfficeToolInput<"note_read">) {
  const entry = run(() => call.mind.note(call.agent.id, input.title, visibleIn(call)));
  read(call, [entry]);
  return { ...noteHead(entry), text: entry.text };
}

export function noteList(call: ToolCall) {
  const page = run(() => call.mind.list(call.agent.id, "note", { visible: visibleIn(call) }));
  read(call, page.entries);
  return { notes: page.entries.map(noteHead), total: page.total, max: page.max };
}

export function noteDelete(call: ToolCall, input: OfficeToolInput<"note_delete">) {
  const gone = run(() => {
    const entry = call.mind.note(call.agent.id, input.title, visibleIn(call));
    return call.mind.remove(call.agent.id, entry.id, visibleIn(call));
  });
  call.auditMeta = { entryId: gone.id, kind: "note", removed: true };
  return { deleted: true };
}
