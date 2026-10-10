/**
 * What an agent remembers as one block of text (#136), for engines that have
 * no memory of their own (the CLI session engine puts it in the system
 * prompt): the newest memories up to a budget, and the titles of its notes.
 * Empty when there is nothing.
 *
 * `rooms` are the rooms the entries in the text may be about (#301): reading
 * the text puts them into the conversation it is read in.
 */
import type { MindEntry } from "@regulus/protocol";

const DIGEST_MEMORY_CHARS = 4000;
const DIGEST_NOTES = 30;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface Digest {
  text: string;
  rooms: string[];
}

export function digestOf(memories: readonly MindEntry[], notes: readonly MindEntry[]): Digest {
  const parts: string[] = [];
  const rooms = new Set<string>();
  if (memories.length > 0) {
    const lines: string[] = [];
    let used = 0;
    for (const m of memories) {
      const line = `- [${day(m.updatedAt)}] ${m.text.replace(/\s+/g, " ")}${m.source ? ` (from: ${m.source})` : ""}`;
      if (used + line.length > DIGEST_MEMORY_CHARS && lines.length > 0) break;
      lines.push(line);
      used += line.length;
      for (const room of m.rooms ?? []) rooms.add(room);
    }
    const rest = memories.length - lines.length;
    parts.push(
      `What you remember (saved with memory_save, newest first${rest > 0 ? `; ${rest} older ones are not shown, find them with memory_search` : ""}):\n${lines.join("\n")}`,
    );
  }
  if (notes.length > 0) {
    const shown = notes.slice(0, DIGEST_NOTES);
    for (const n of shown) for (const room of n.rooms ?? []) rooms.add(room);
    const titles = shown.map((n) => `- ${n.title} (changed ${day(n.updatedAt)})`);
    parts.push(
      `Your notes (read one with note_read${notes.length > titles.length ? `; ${notes.length - titles.length} more with note_list` : ""}):\n${titles.join("\n")}`,
    );
  }
  return { text: parts.join("\n\n"), rooms: [...rooms].sort() };
}
