/**
 * Which board panel is open (#36) and which card in it. The 3D boards
 * (scene/boards) open it on click or `E`; the panel (ui/boards) reads it.
 */
import type { CardKind } from "@regulus/protocol";
import { create } from "zustand";

/** The keyboard overlay id while a board panel is open (mutes scene hotkeys). */
export const BOARD_OVERLAY = "board";

export interface BoardStore {
  open: CardKind | null;
  /** `boardCardKey(repoId, number)` of the card shown in detail, or null for the columns. */
  selected: string | null;
  openBoard: (kind: CardKind, selected?: string | null) => void;
  selectCard: (key: string | null) => void;
  closeBoard: () => void;
}

export const useBoardStore = create<BoardStore>()((set) => ({
  open: null,
  selected: null,
  openBoard: (kind, selected = null) => set({ open: kind, selected }),
  selectCard: (selected) => set({ selected }),
  closeBoard: () => set({ open: null, selected: null }),
}));
