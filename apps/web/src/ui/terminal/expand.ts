/**
 * The terminal dialogs' expand button (#156): normal size, or about 60 % of
 * the window (at least 900×560 and never smaller than the normal size),
 * capped to the window with room for the dialog around it. The choice is
 * remembered per user in this browser; blocked storage just forgets it.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { useSessionStore } from "../../state/session.ts";

const KEY_PREFIX = "regulus.terminal.expanded.";

/** Share of the window an expanded terminal takes. */
export const EXPAND_FRACTION = 0.6;
export const EXPAND_MIN = { width: 900, height: 560 } as const;
/** Width of the dialog frame around the terminal: padding and border on both sides. */
export const MODAL_CHROME_PX = 2 * 26 + 2 * 4;
/** The backdrop's padding on each side (components.css). */
const BACKDROP_PX = 24;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadExpanded(userId: string | null): boolean {
  try {
    return storage()?.getItem(KEY_PREFIX + (userId ?? "anon")) === "1";
  } catch {
    return false;
  }
}

export function saveExpanded(userId: string | null, expanded: boolean): void {
  try {
    const key = KEY_PREFIX + (userId ?? "anon");
    if (expanded) storage()?.setItem(key, "1");
    else storage()?.removeItem(key);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The terminal box of an expanded dialog in a `viewport`-sized window.
 * `normal` is the box at normal size; `reserveHeight` is the dialog's own
 * height around the box (title, toolbar, help line, footer).
 */
export function expandedTerminalSize(viewport: Size, normal: Size, reserveHeight: number): Size {
  const capW = viewport.width - 2 * BACKDROP_PX - MODAL_CHROME_PX;
  const capH = viewport.height - 2 * BACKDROP_PX - reserveHeight;
  const want = (share: number, min: number, normalPx: number) =>
    Math.max(min, Math.round(share), normalPx);
  return {
    width: Math.max(
      0,
      Math.min(capW, want(viewport.width * EXPAND_FRACTION, EXPAND_MIN.width, normal.width)),
    ),
    height: Math.max(
      0,
      Math.min(capH, want(viewport.height * EXPAND_FRACTION, EXPAND_MIN.height, normal.height)),
    ),
  };
}

interface ExpandStore {
  /** Loaded for this user; null before the first read. */
  userId: string | null | undefined;
  expanded: boolean;
  sync: (userId: string | null) => void;
  set: (userId: string | null, expanded: boolean) => void;
}

export const useExpandStore = create<ExpandStore>()((set, get) => ({
  userId: undefined,
  expanded: false,
  sync: (userId) => {
    if (get().userId !== userId) set({ userId, expanded: loadExpanded(userId) });
  },
  set: (userId, expanded) => {
    saveExpanded(userId, expanded);
    set({ userId, expanded });
  },
}));

/** Whether this user's terminals are expanded, and a toggle that remembers it. */
export function useTerminalExpanded(): [boolean, () => void] {
  const userId = useSessionStore((s) => s.user?.id ?? null);
  const storeUser = useExpandStore((s) => s.userId);
  const stored = useExpandStore((s) => s.expanded);
  const expanded = storeUser === userId ? stored : loadExpanded(userId);
  useEffect(() => useExpandStore.getState().sync(userId), [userId]);
  const toggle = () => useExpandStore.getState().set(userId, !expanded);
  return [expanded, toggle];
}

/** The window's size, updated on resize. */
export function useViewportSize(): Size {
  const read = (): Size => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 800 : window.innerHeight,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}
