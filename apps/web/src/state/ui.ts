/**
 * HUD state: which overlay owns the keyboard, the toast queue and persisted
 * client settings (SPEC §11 reduced motion). Pure logic lives in
 * ui/toast/toastQueue.ts and ui/settings/settingsStorage.ts; this store only
 * glues it to timers, localStorage and the <html data-reduced-motion> hook
 * that CSS and the scene (#16 bubbles/confetti) read.
 */
import { create } from "zustand";
import {
  browserLocalStorage,
  effectiveReducedMotion,
  loadSettings,
  type StorageLike,
  saveSettings,
  type UiSettings,
} from "../ui/settings/settingsStorage.ts";
import {
  createToastQueue,
  nextExpiryDelay,
  reduceToasts,
  type ToastInput,
  type ToastQueueState,
} from "../ui/toast/toastQueue.ts";

/** Overlays that take the keyboard; hotkeys are muted while one is open. */
export type OverlayId = "settings" | "help" | (string & {});

export interface UiStore {
  overlay: OverlayId | null;
  openOverlay: (id: OverlayId) => void;
  closeOverlay: (id?: OverlayId) => void;
  toggleOverlay: (id: OverlayId) => void;

  settings: UiSettings;
  /** OS `prefers-reduced-motion`, refreshed by `watchReducedMotion`. */
  osReducedMotion: boolean;
  setOsReducedMotion: (value: boolean) => void;
  updateSettings: (patch: Partial<UiSettings>) => void;

  toastQueue: ToastQueueState;
  toast: (input: ToastInput) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
  /** Advance the queue; the store schedules this itself after each change. */
  tickToasts: () => void;
}

export interface UiStoreDeps {
  storage?: StorageLike | null;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createUiStore(deps: UiStoreDeps = {}) {
  const storage = deps.storage === undefined ? browserLocalStorage() : deps.storage;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;

  return create<UiStore>()((set, get) => {
    const schedule = () => {
      if (timer !== null) clearTimer(timer);
      timer = null;
      const delay = nextExpiryDelay(get().toastQueue, now());
      if (delay !== null) {
        timer = setTimer(() => {
          timer = null;
          get().tickToasts();
        }, delay);
      }
    };
    const apply = (action: Parameters<typeof reduceToasts>[1]) => {
      set({ toastQueue: reduceToasts(get().toastQueue, action, now()) });
      schedule();
    };

    return {
      overlay: null,
      openOverlay: (id) => set({ overlay: id }),
      closeOverlay: (id) =>
        set((s) => (id === undefined || s.overlay === id ? { overlay: null } : {})),
      toggleOverlay: (id) => set((s) => ({ overlay: s.overlay === id ? null : id })),

      settings: loadSettings(storage),
      osReducedMotion: false,
      setOsReducedMotion: (value) => set({ osReducedMotion: value }),
      updateSettings: (patch) => {
        const settings = { ...get().settings, ...patch };
        saveSettings(storage, settings);
        set({ settings });
      },

      toastQueue: createToastQueue(),
      toast: (input) => {
        apply({ type: "push", toast: input });
        return `toast-${get().toastQueue.nextId - 1}`;
      },
      dismissToast: (id) => apply({ type: "dismiss", id }),
      clearToasts: () => apply({ type: "clear" }),
      tickToasts: () => apply({ type: "tick" }),
    };
  });
}

export const useUiStore = createUiStore();

export function selectReducedMotion(s: Pick<UiStore, "settings" | "osReducedMotion">): boolean {
  return effectiveReducedMotion(s.settings, s.osReducedMotion);
}

/**
 * Mirror the effective reduced-motion flag to `<html data-reduced-motion>`
 * and follow the OS media query. Returns an unsubscribe function.
 */
export function watchReducedMotion(store = useUiStore, doc = document, win = window): () => void {
  const mql = win.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  const applyOs = () => store.getState().setOsReducedMotion(mql?.matches ?? false);
  const mirror = () => {
    doc.documentElement.dataset.reducedMotion = String(selectReducedMotion(store.getState()));
  };
  applyOs();
  mirror();
  mql?.addEventListener?.("change", applyOs);
  const unsub = store.subscribe(mirror);
  return () => {
    mql?.removeEventListener?.("change", applyOs);
    unsub();
  };
}
