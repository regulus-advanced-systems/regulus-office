/**
 * Search UI state (#41): the query box, its results, a jump to a robot's
 * desk in progress, and the match the terminal modal should reveal.
 */
import type { SearchResponse } from "@regulus/protocol";
import { create } from "zustand";
import type { SearchFailure } from "./api.ts";
import type { JumpTarget } from "./jump.ts";

export const SEARCH_OVERLAY_ID = "search";

export type SearchStatus = "idle" | "loading" | "done" | "error";

/** What the terminal modal of `agentId` shows above its live view. */
export interface SearchReveal {
  agentId: string;
  docId: number;
  query: string;
}

export interface SearchStore {
  query: string;
  status: SearchStatus;
  result: SearchResponse | null;
  error: SearchFailure | null;
  jump: JumpTarget | null;
  reveal: SearchReveal | null;
  setQuery(query: string): void;
  setResult(result: SearchResponse | null, error?: SearchFailure | null): void;
  setLoading(): void;
  startJump(target: JumpTarget): void;
  endJump(): void;
  setReveal(reveal: SearchReveal | null): void;
}

export const useSearchStore = create<SearchStore>()((set) => ({
  query: "",
  status: "idle",
  result: null,
  error: null,
  jump: null,
  reveal: null,
  setQuery: (query) => set({ query }),
  setLoading: () => set({ status: "loading", error: null }),
  setResult: (result, error = null) =>
    set({ result, error, status: error ? "error" : result ? "done" : "idle" }),
  startJump: (jump) => set({ jump, reveal: null }),
  endJump: () => set({ jump: null }),
  setReveal: (reveal) => set({ reveal }),
}));
