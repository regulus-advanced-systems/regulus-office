import { describe, expect, test } from "bun:test";
import { createUiStore, selectReducedMotion } from "./ui.ts";

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
};

/** Manual clock + timer so the store's auto-dismiss can be driven deterministically. */
const fakeTimers = () => {
  let clock = 0;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => clock,
    setTimer: (fn: () => void, ms: number) => {
      const t = { at: clock + ms, fn };
      timers.push(t);
      return t;
    },
    clearTimer: (h: unknown) => {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
    advance: (ms: number) => {
      clock += ms;
      const due = timers.filter((t) => t.at <= clock);
      for (const t of due) timers.splice(timers.indexOf(t), 1);
      for (const t of due) t.fn();
    },
    pending: () => timers.length,
  };
};

describe("ui store", () => {
  test("overlays: open, toggle, close by id only closes that id", () => {
    const store = createUiStore({ storage: null });
    store.getState().openOverlay("settings");
    expect(store.getState().overlay).toBe("settings");
    store.getState().closeOverlay("help");
    expect(store.getState().overlay).toBe("settings");
    store.getState().closeOverlay("settings");
    expect(store.getState().overlay).toBeNull();
    store.getState().toggleOverlay("help");
    store.getState().toggleOverlay("help");
    expect(store.getState().overlay).toBeNull();
  });

  test("settings load from storage and persist on update", () => {
    const storage = memoryStorage();
    storage.setItem("regulus.ui.settings.v1", '{"reducedMotion":true,"volume":0.5}');
    const store = createUiStore({ storage });
    expect(store.getState().settings).toEqual({
      reducedMotion: true,
      volume: 0.5,
      hour12: false,
      fpvFov: 60,
      mouseSensitivity: 1,
      graphics: "auto",
    });
    store.getState().updateSettings({ volume: 0.1 });
    expect(createUiStore({ storage }).getState().settings.volume).toBe(0.1);
  });

  test("reduced motion follows the OS unless the user chose", () => {
    const store = createUiStore({ storage: null });
    expect(selectReducedMotion(store.getState())).toBe(false);
    store.getState().setOsReducedMotion(true);
    expect(selectReducedMotion(store.getState())).toBe(true);
    store.getState().updateSettings({ reducedMotion: false });
    expect(selectReducedMotion(store.getState())).toBe(false);
  });

  test("toasts auto-dismiss on the store's own timer", () => {
    const t = fakeTimers();
    const store = createUiStore({ storage: null, ...t });
    const id = store.getState().toast({ message: "hi", durationMs: 1000 });
    expect(id).toBe("toast-1");
    expect(store.getState().toastQueue.toasts).toHaveLength(1);
    expect(t.pending()).toBe(1);
    t.advance(999);
    expect(store.getState().toastQueue.toasts).toHaveLength(1);
    t.advance(1);
    expect(store.getState().toastQueue.toasts).toHaveLength(0);
    expect(t.pending()).toBe(0);
  });

  test("sticky errors schedule no timer; dismiss and clear work", () => {
    const t = fakeTimers();
    const store = createUiStore({ storage: null, ...t });
    store.getState().toast({ message: "boom", kind: "error" });
    expect(t.pending()).toBe(0);
    store.getState().toast({ message: "later", durationMs: 500 });
    expect(t.pending()).toBe(1);
    store.getState().dismissToast("toast-1");
    expect(store.getState().toastQueue.toasts.map((x) => x.id)).toEqual(["toast-2"]);
    store.getState().clearToasts();
    expect(store.getState().toastQueue.toasts).toEqual([]);
    expect(t.pending()).toBe(0);
  });
});
