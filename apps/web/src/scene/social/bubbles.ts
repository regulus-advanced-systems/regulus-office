/**
 * Chat bubbles over the speakers' heads (#49): which line each human last
 * said, since when, and how opaque its bubble is now. A line becomes a
 * bubble when it arrives live; the history replayed on join never does.
 * Time is the client's own clock at arrival, so server clock skew never
 * shortens or hides a bubble. Pure apart from the small zustand store.
 */
import { CHAT_BUBBLE_FADE_MS, CHAT_BUBBLE_MS, type ChatMessage } from "@regulus/protocol";
import { create } from "zustand";

export interface Bubble {
  /** Chat message id. */
  id: string;
  text: string;
  /** Client ms when the line arrived. */
  shownAt: number;
}

/** Longest text a bubble shows; the chat panel has the rest. */
export const BUBBLE_MAX_CHARS = 140;

export function bubbleText(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > BUBBLE_MAX_CHARS ? `${t.slice(0, BUBBLE_MAX_CHARS - 1)}…` : t;
}

/**
 * Opacity of a bubble `ageMs` old: full, then a linear fade over the last
 * CHAT_BUBBLE_FADE_MS; with reduced motion it stays full and then goes at once.
 */
export function bubbleOpacity(ageMs: number, reducedMotion = false): number {
  if (ageMs < 0) return 1;
  if (ageMs >= CHAT_BUBBLE_MS) return 0;
  if (reducedMotion) return 1;
  const fadeFrom = CHAT_BUBBLE_MS - CHAT_BUBBLE_FADE_MS;
  return ageMs <= fadeFrom ? 1 : 1 - (ageMs - fadeFrom) / CHAT_BUBBLE_FADE_MS;
}

export interface BubbleTracker {
  /**
   * Feed the current chat window; returns the bubbles started by lines that
   * arrived since the last call, newest per user. The first call only learns
   * what is already there.
   */
  observe(chat: readonly ChatMessage[], now: number): Map<string, Bubble>;
}

export function createBubbleTracker(): BubbleTracker {
  let seen: Set<string> | null = null;
  return {
    observe(chat, now) {
      const fresh = new Map<string, Bubble>();
      if (seen === null) {
        seen = new Set(chat.map((m) => m.id));
        return fresh;
      }
      const next = new Set<string>();
      for (const m of chat) {
        next.add(m.id);
        if (!seen.has(m.id))
          fresh.set(m.userId, { id: m.id, text: bubbleText(m.text), shownAt: now });
      }
      seen = next;
      return fresh;
    },
  };
}

export interface BubbleStore {
  /** By user id: the line each human said last, while its bubble shows. */
  byUser: Record<string, Bubble>;
  add: (fresh: ReadonlyMap<string, Bubble>) => void;
  /** Drop bubbles that have faded out. */
  prune: (now: number) => void;
  clear: () => void;
}

export const useBubbleStore = create<BubbleStore>()((set, get) => ({
  byUser: {},
  add: (fresh) => {
    if (fresh.size === 0) return;
    set({ byUser: { ...get().byUser, ...Object.fromEntries(fresh) } });
  },
  prune: (now) => {
    const byUser = get().byUser;
    const keep = Object.entries(byUser).filter(([, b]) => now - b.shownAt < CHAT_BUBBLE_MS);
    if (keep.length !== Object.keys(byUser).length) set({ byUser: Object.fromEntries(keep) });
  },
  clear: () => set({ byUser: {} }),
}));
