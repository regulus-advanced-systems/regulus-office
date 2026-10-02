/**
 * Which whiteboard is open full screen (#45). The 3D boards (scene/whiteboard)
 * open one on click or `E`; the HUD host (WhiteboardHost) loads the editor
 * lazily and shows it. Kept free of Excalidraw and Yjs so the main bundle
 * stays small.
 */
import { create } from "zustand";

/** The keyboard overlay id while a whiteboard is open (mutes scene hotkeys and WASD). */
export const WHITEBOARD_OVERLAY = "whiteboard";

export interface OpenWhiteboard {
  /** Operation id, or `LOBBY_WHITEBOARD_ID`. */
  boardId: string;
  /** Shown in the title bar: the room's name. */
  title: string;
}

export interface WhiteboardStore {
  open: OpenWhiteboard | null;
  openBoard: (boardId: string, title: string) => void;
  close: () => void;
}

export const useWhiteboardStore = create<WhiteboardStore>()((set) => ({
  open: null,
  openBoard: (boardId, title) => set({ open: { boardId, title } }),
  close: () => set({ open: null }),
}));
