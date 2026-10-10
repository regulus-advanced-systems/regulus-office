/**
 * Pure helpers for the bookshelf reader (#264): the shelf by folder, the
 * name filter, and what the reader says when there is nothing to show.
 */
import type { BookshelfDoc, BookshelfState } from "@regulus/protocol";
import type { ShelfFailure } from "./api.ts";

export interface ShelfFolder {
  /** The folder's path in the repo; "" for the top. */
  name: string;
  docs: BookshelfDoc[];
}

/**
 * The shelf's documents by folder, in shelf order (README and the top
 * first), keeping those whose path contains `filter` (any case).
 */
export function groupByFolder(docs: readonly BookshelfDoc[], filter = ""): ShelfFolder[] {
  const needle = filter.trim().toLowerCase();
  const folders = new Map<string, BookshelfDoc[]>();
  for (const doc of docs) {
    if (needle && !doc.path.toLowerCase().includes(needle)) continue;
    const cut = doc.path.lastIndexOf("/");
    const name = cut < 0 ? "" : doc.path.slice(0, cut);
    const list = folders.get(name);
    if (list) list.push(doc);
    else folders.set(name, [doc]);
  }
  return [...folders].map(([name, list]) => ({ name, docs: list }));
}

export const SHELF_MESSAGES: Readonly<
  Record<ShelfFailure | Exclude<BookshelfState, "ready">, string>
> = {
  closed: "This room's bookshelf is not open to you.",
  too_large: "This document is too large to open here.",
  not_text: "This file is not text.",
  unavailable: "The office cannot read this repo right now.",
  failed: "The shelf could not be reached. Try again in a moment.",
  no_repo: "This room has no repo, so its shelf is empty.",
  cloning: "The office is still cloning this repo. The shelf fills when it is done.",
};
