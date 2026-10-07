import { describe, expect, test } from "bun:test";
import {
  createToastQueue,
  nextExpiryDelay,
  reduceToasts,
  type ToastQueueState,
  visibleToasts,
} from "./toastQueue.ts";

const push = (s: ToastQueueState, message: string, now: number, extra = {}) =>
  reduceToasts(s, { type: "push", toast: { message, ...extra } }, now);

describe("toast queue reducer", () => {
  test("pushes are shown oldest-first up to maxVisible; the rest wait", () => {
    let s = createToastQueue(2);
    s = push(s, "a", 0);
    s = push(s, "b", 1);
    s = push(s, "c", 2);
    expect(visibleToasts(s).map((t) => t.message)).toEqual(["a", "b"]);
    expect(s.toasts).toHaveLength(3);
    expect(s.toasts[2]?.shownAt).toBeNull();
  });

  test("ids are unique and increasing", () => {
    let s = createToastQueue();
    s = push(s, "a", 0);
    s = push(s, "b", 0);
    expect(s.toasts.map((t) => t.id)).toEqual(["toast-1", "toast-2"]);
  });

  test("a visible toast expires after its duration and the next one takes its place", () => {
    let s = createToastQueue(1);
    s = push(s, "first", 0, { durationMs: 1000 });
    s = push(s, "second", 10, { durationMs: 1000 });
    expect(visibleToasts(s).map((t) => t.message)).toEqual(["first"]);
    s = reduceToasts(s, { type: "tick" }, 999);
    expect(visibleToasts(s).map((t) => t.message)).toEqual(["first"]);
    s = reduceToasts(s, { type: "tick" }, 1000);
    expect(visibleToasts(s).map((t) => t.message)).toEqual(["second"]);
    // Duration counts from when it became visible, not when it was queued.
    expect(s.toasts[0]?.shownAt).toBe(1000);
    expect(nextExpiryDelay(s, 1000)).toBe(1000);
  });

  test("errors are sticky by default and only go on dismiss", () => {
    let s = createToastQueue();
    s = push(s, "boom", 0, { kind: "error" });
    s = reduceToasts(s, { type: "tick" }, 1e9);
    expect(visibleToasts(s)).toHaveLength(1);
    expect(nextExpiryDelay(s, 1e9)).toBeNull();
    s = reduceToasts(s, { type: "dismiss", id: "toast-1" }, 1e9);
    expect(s.toasts).toHaveLength(0);
  });

  test("default durations depend on kind", () => {
    let s = createToastQueue();
    s = push(s, "i", 0);
    s = push(s, "w", 0, { kind: "warning" });
    expect(s.toasts[0]?.durationMs).toBe(5000);
    expect(s.toasts[1]?.durationMs).toBe(7000);
  });

  test("dismissing promotes the next waiting toast; clear empties everything", () => {
    let s = createToastQueue(1);
    s = push(s, "a", 0);
    s = push(s, "b", 0);
    s = reduceToasts(s, { type: "dismiss", id: "toast-1" }, 5);
    expect(visibleToasts(s).map((t) => t.message)).toEqual(["b"]);
    s = reduceToasts(s, { type: "clear" }, 6);
    expect(s.toasts).toEqual([]);
  });

  test("nextExpiryDelay never goes negative", () => {
    let s = createToastQueue();
    s = push(s, "a", 0, { durationMs: 100 });
    expect(nextExpiryDelay(s, 150)).toBe(0);
  });
});

test("a toast keeps the button it was pushed with (#256)", () => {
  let ran = 0;
  const open = { label: "Take me there", run: () => ran++ };
  let state = reduceToasts(createToastQueue(), { type: "push", toast: { message: "a", open } }, 0);
  state = reduceToasts(state, { type: "push", toast: { message: "b" } }, 0);
  const [first, second] = visibleToasts(state);
  expect(first?.open).toBe(open);
  expect(second?.open).toBeUndefined();
  first?.open?.run();
  expect(ran).toBe(1);
});
