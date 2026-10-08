/**
 * "No entry" (SPEC §14 D26; #269): what a person is told when they try to
 * go into a room they have no access to. One plain sentence, the same for a
 * click on the room, `E` at its door and a jump that names it. Nothing about
 * the room is said: the client knows nothing about it.
 */
import { useLinkStore } from "../ui/access/linkPrompt.ts";
import { useUiStore } from "./ui.ts";

export const NO_ENTRY_MESSAGE =
  "You do not have access to this room. Ask whoever owns its repo on GitHub.";

/** For someone whose GitHub account is not linked (#270): every room is closed until it is. */
export const NO_ENTRY_UNLINKED = "Link your GitHub account (Settings, You) to enter your rooms.";

/** The sentence for this viewer: by their own link state, never by anything about the room. */
export function noEntryMessage(state: string | undefined = useLinkStore.getState().status?.state) {
  return state === undefined || state === "linked" ? NO_ENTRY_MESSAGE : NO_ENTRY_UNLINKED;
}

/** Do not repeat the notice more often than this, ms. */
export const NO_ENTRY_EVERY_MS = 2500;

let lastAt = Number.NEGATIVE_INFINITY;

/** Say it (a toast), unless it was just said. True when shown. */
export function refuseEntry(now: number = performance.now()): boolean {
  if (now - lastAt < NO_ENTRY_EVERY_MS) return false;
  lastAt = now;
  useUiStore.getState().toast({ kind: "error", title: "No entry", message: noEntryMessage() });
  return true;
}

/** Forget the last notice (tests). */
export function resetEntryNotice(): void {
  lastAt = Number.NEGATIVE_INFINITY;
}
