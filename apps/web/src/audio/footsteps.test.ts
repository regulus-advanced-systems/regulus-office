import { describe, expect, test } from "bun:test";
import { createPlayerStore } from "../state/player.ts";
import { STRIDE_METRES } from "./footstepCadence.ts";
import { FOOTSTEP_EVENT, watchFootsteps } from "./footsteps.ts";

describe("footstep hook", () => {
  test("dispatches an event and plays a click per stride; reduced motion mutes the click", () => {
    const store = createPlayerStore();
    store.getState().spawnAt({ x: 0, z: 0, heading: 0 });
    const target = new EventTarget();
    let played = 0;
    let events = 0;
    let reduced = false;
    target.addEventListener(FOOTSTEP_EVENT, () => events++);
    const off = watchFootsteps({ store, target, play: () => played++, reduced: () => reduced });

    store.getState().setTarget(10, 0);
    while (store.getState().path) store.getState().advance(1 / 60);
    const expected = Math.floor(10 / STRIDE_METRES);
    expect(events).toBe(expected);
    expect(played).toBe(expected);

    reduced = true;
    store.getState().setTarget(0, 0);
    while (store.getState().path) store.getState().advance(1 / 60);
    const roundTrip = Math.floor(20 / STRIDE_METRES); // stride carry continues across legs
    expect(events).toBe(roundTrip);
    expect(played).toBe(expected);

    off();
    store.getState().setTarget(10, 0);
    while (store.getState().path) store.getState().advance(1 / 60);
    expect(events).toBe(roundTrip);
  });
});
