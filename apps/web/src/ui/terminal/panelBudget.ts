/**
 * SPEC §11 / research 01 §7: at most 2 live DOM panels at a time (the
 * terminal modal counts as one, the focused laptop's in-scene xterm as
 * another). Panels ask for a slot; higher priority wins, ties go to the
 * earlier request. Anything not granted renders its texture fallback.
 */
import { create } from "zustand";

export const MAX_LIVE_PANELS = 2;

/** The modal outranks in-scene panels: the user explicitly opened it. */
export const PANEL_PRIORITY = { modal: 10, laptop: 1 } as const;

export interface PanelRequest {
  id: string;
  priority: number;
  /** Monotonic request order. */
  seq: number;
}

/** Which requested panels may be live now. */
export function grantPanels(
  requests: readonly PanelRequest[],
  max: number = MAX_LIVE_PANELS,
): Set<string> {
  const ranked = [...requests].sort((a, b) => b.priority - a.priority || a.seq - b.seq);
  return new Set(ranked.slice(0, Math.max(0, max)).map((r) => r.id));
}

export interface PanelBudgetStore {
  requests: PanelRequest[];
  granted: Set<string>;
  request: (id: string, priority: number) => void;
  release: (id: string) => void;
}

export function createPanelBudget(max: number = MAX_LIVE_PANELS) {
  let seq = 0;
  return create<PanelBudgetStore>()((set, get) => ({
    requests: [],
    granted: new Set(),
    request: (id, priority) => {
      const others = get().requests.filter((r) => r.id !== id);
      const existing = get().requests.find((r) => r.id === id);
      seq += 1;
      const requests = [...others, { id, priority, seq: existing?.seq ?? seq }];
      set({ requests, granted: grantPanels(requests, max) });
    },
    release: (id) => {
      const requests = get().requests.filter((r) => r.id !== id);
      set({ requests, granted: grantPanels(requests, max) });
    },
  }));
}

export const usePanelBudget = createPanelBudget();
