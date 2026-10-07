/**
 * "No entry" (SPEC §14 D26; #269): what a person is told when they try to
 * go into a room they have no access to. One plain sentence, the same for a
 * click on the room, `E` at its door and a jump that names it. Nothing about
 * the room is said: the client knows nothing about it.
 */
import { useUiStore } from "./ui.ts";

export const NO_ENTRY_MESSAGE =
  "No entry. You do not have access to this room; ask whoever owns its repo on GitHub.";

/** Do not repeat the notice more often than this, ms. */
export const NO_ENTRY_EVERY_MS = 2500;

let lastAt = Number.NEGATIVE_INFINITY;

/** Say it (a toast), unless it was just said. True when shown. */
export function refuseEntry(now: number = performance.now()): boolean {
  if (now - lastAt < NO_ENTRY_EVERY_MS) return false;
  lastAt = now;
  useUiStore.getState().toast({ kind: "error", title: "No entry", message: NO_ENTRY_MESSAGE });
  return true;
}

/** Forget the last notice (tests). */
export function resetEntryNotice(): void {
  lastAt = Number.NEGATIVE_INFINITY;
}
