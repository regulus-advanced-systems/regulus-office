/**
 * The bookshelf reader's state (#264): which room's shelf is open, the
 * document being read, the heading to show, and the way back.
 */
import { create } from "zustand";

export const BOOKSHELF_OVERLAY = "bookshelf";

export interface ShelfPage {
  path: string;
  /** Heading to scroll to (a slug), or "". */
  anchor: string;
}

export interface BookshelfStore {
  /** The room whose shelf is open, or null. */
  operationId: string | null;
  page: ShelfPage | null;
  /** Pages read before this one, oldest first. */
  history: ShelfPage[];
  openShelf(operationId: string): void;
  close(): void;
  /** Open a document (or move to a heading of the open one). */
  go(path: string, anchor?: string): void;
  back(): void;
}

const HISTORY_MAX = 50;

export const useBookshelfStore = create<BookshelfStore>()((set) => ({
  operationId: null,
  page: null,
  history: [],
  openShelf: (operationId) =>
    set((s) => (s.operationId === operationId ? {} : { operationId, page: null, history: [] })),
  close: () => set({ operationId: null, page: null, history: [] }),
  go: (path, anchor = "") =>
    set((s) => {
      const page = { path, anchor };
      if (!s.page) return { page };
      if (s.page.path === path && s.page.anchor === anchor) return {};
      return { page, history: [...s.history, s.page].slice(-HISTORY_MAX) };
    }),
  back: () =>
    set((s) => {
      const page = s.history[s.history.length - 1];
      return page ? { page, history: s.history.slice(0, -1) } : {};
    }),
}));
