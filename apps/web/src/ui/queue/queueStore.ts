/**
 * Which queue UI is open (#37): the panel (the clipboard, `E` near it) and
 * the "Queue a task" dialog, optionally prefilled from a carried card.
 */
import type { TaskKind } from "@regulus/protocol";
import { create } from "zustand";

/** The keyboard overlay id while the queue panel or dialog is up. */
export const QUEUE_OVERLAY = "queue";

export interface QueuePrefill {
  kind: TaskKind;
  refNumber?: number;
  repoId?: string;
  taskTitle?: string;
  prompt?: string;
}

export interface QueueStore {
  panelOpen: boolean;
  /** The add dialog, with what it was opened for; null when closed. */
  add: { prefill?: QueuePrefill } | null;
  openPanel: () => void;
  closePanel: () => void;
  openAdd: (prefill?: QueuePrefill) => void;
  closeAdd: () => void;
}

export const useQueueStore = create<QueueStore>()((set) => ({
  panelOpen: false,
  add: null,
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  openAdd: (prefill) => set({ add: prefill ? { prefill } : {} }),
  closeAdd: () => set({ add: null }),
}));
