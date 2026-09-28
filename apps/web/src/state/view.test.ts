import { describe, expect, test } from "bun:test";
import { createViewStore, oppositeView } from "./view.ts";

/** Store on a manual clock with a switchable reduced-motion flag. */
function harness(opts: { reducedMotion?: boolean } = {}) {
  let clock = 1000;
  let reduced = opts.reducedMotion ?? false;
  const store = createViewStore({ now: () => clock, reducedMotion: () => reduced });
  return {
    store,
    get: () => store.getState(),
    advance: (ms: number) => {
      clock += ms;
      store.getState().tick(clock);
    },
    setReduced: (v: boolean) => {
      reduced = v;
    },
  };
}

describe("view store", () => {
  test("starts in third person with no fade", () => {
    const { get } = harness();
    expect(get().mode).toBe("third_person");
    expect(get().cameraMode).toBe("third_person");
    expect(get().fade).toBeNull();
    expect(get().pointerLocked).toBe(false);
    expect(oppositeView("third_person")).toBe("first_person");
    expect(oppositeView("first_person")).toBe("third_person");
  });

  test("toggle requests first person immediately but swaps the camera at 150 ms", () => {
    const h = harness();
    h.get().toggle();
    expect(h.get().mode).toBe("first_person");
    expect(h.get().cameraMode).toBe("third_person");
    expect(h.get().fade).toEqual({
      from: "third_person",
      to: "first_person",
      startedAt: 1000,
      durationMs: 300,
    });
    h.advance(149);
    expect(h.get().cameraMode).toBe("third_person");
    h.advance(1);
    expect(h.get().cameraMode).toBe("first_person");
    expect(h.get().fade).not.toBeNull();
    h.advance(149);
    expect(h.get().fade).not.toBeNull();
    h.advance(1);
    expect(h.get().fade).toBeNull();
    expect(h.get().mode).toBe("first_person");
  });

  test("toggle back returns to third person through another fade", () => {
    const h = harness();
    h.get().toggle();
    h.advance(300);
    h.get().toggle();
    expect(h.get().mode).toBe("third_person");
    expect(h.get().cameraMode).toBe("first_person");
    expect(h.get().fade?.from).toBe("first_person");
    expect(h.get().fade?.to).toBe("third_person");
    h.advance(150);
    expect(h.get().cameraMode).toBe("third_person");
    h.advance(150);
    expect(h.get().fade).toBeNull();
  });

  test("setMode to the current mode is a no-op", () => {
    const h = harness();
    const before = h.get();
    h.get().setMode("third_person");
    expect(h.get()).toBe(before);
  });

  test("toggling back before the midpoint cancels the fade without a swap", () => {
    const h = harness();
    h.get().toggle();
    h.advance(100);
    h.get().toggle();
    expect(h.get().mode).toBe("third_person");
    expect(h.get().cameraMode).toBe("third_person");
    expect(h.get().fade).toBeNull();
  });

  test("toggling again after the midpoint starts a fresh fade from the rendered mode", () => {
    const h = harness();
    h.get().toggle();
    h.advance(200);
    expect(h.get().cameraMode).toBe("first_person");
    h.get().toggle();
    expect(h.get().fade).toEqual({
      from: "first_person",
      to: "third_person",
      startedAt: 1200,
      durationMs: 300,
    });
    h.advance(150);
    expect(h.get().cameraMode).toBe("third_person");
  });

  test("reduced motion makes the switch an instant cut", () => {
    const h = harness({ reducedMotion: true });
    h.get().toggle();
    expect(h.get().mode).toBe("first_person");
    expect(h.get().cameraMode).toBe("first_person");
    expect(h.get().fade).toBeNull();
    h.setReduced(false);
    h.get().toggle();
    expect(h.get().fade).not.toBeNull();
  });

  test("tick without a fade and a late tick after a hidden tab both settle cleanly", () => {
    const h = harness();
    h.advance(50);
    expect(h.get().fade).toBeNull();
    h.get().toggle();
    h.advance(5000);
    expect(h.get().cameraMode).toBe("first_person");
    expect(h.get().fade).toBeNull();
  });

  test("pointer lock flag only changes on a real change", () => {
    const h = harness();
    const before = h.get();
    h.get().setPointerLocked(false);
    expect(h.get()).toBe(before);
    h.get().setPointerLocked(true);
    expect(h.get().pointerLocked).toBe(true);
  });

  test("custom duration is honoured", () => {
    let clock = 0;
    const store = createViewStore({
      now: () => clock,
      reducedMotion: () => false,
      durationMs: 100,
    });
    store.getState().toggle();
    clock = 50;
    store.getState().tick(clock);
    expect(store.getState().cameraMode).toBe("first_person");
    clock = 100;
    store.getState().tick(clock);
    expect(store.getState().fade).toBeNull();
  });
});
