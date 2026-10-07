import { describe, expect, test } from "bun:test";
import {
  escapeLeaves,
  heldView,
  holdUntilSettled,
  holdView,
  LOOK_ACTIVE,
  type LookPause,
  mayRelockOnClick,
  onPointerLock,
  onPointerUnlock,
  onWindowChange,
  RELOCK_SETTLE_MS,
} from "./windowPause.ts";

const fp = (windowOpen: boolean, locked: boolean) => ({ windowOpen, firstPerson: true, locked });

/** Open a window while looking around with the pointer locked. */
function opened(): LookPause {
  return onWindowChange(LOOK_ACTIVE, fp(true, true)).state;
}

describe("first-person look pauses while a window is open (#282)", () => {
  test("a window opening releases the pointer and pauses; its unlock does not leave first person", () => {
    const open = onWindowChange(LOOK_ACTIVE, fp(true, true));
    expect(open).toEqual({ state: { paused: true, expectUnlock: true }, pointer: "release" });
    const unlock = onPointerUnlock(open.state);
    expect(unlock).toEqual({ state: { paused: true, expectUnlock: false }, leave: false });
  });

  test("the last window closing takes the pointer back", () => {
    const afterUnlock = onPointerUnlock(opened()).state;
    const closed = onWindowChange(afterUnlock, fp(false, false));
    expect(closed).toEqual({ state: LOOK_ACTIVE, pointer: "relock" });
  });

  test("one window opening another changes nothing: still paused, no second release", () => {
    const state = onPointerUnlock(opened()).state;
    // The first closes and the second opens in the same update: a window is open throughout.
    expect(onWindowChange(state, fp(true, false))).toEqual({ state, pointer: null });
    // Only when the second one closes does the look resume.
    expect(onWindowChange(state, fp(false, false)).pointer).toBe("relock");
  });

  test("a window closed before the browser reported our unlock still keeps first person", () => {
    const closed = onWindowChange(opened(), fp(false, true));
    // Still locked as far as the rig knows: nothing to request yet.
    expect(closed).toEqual({ state: { paused: false, expectUnlock: true }, pointer: null });
    const late = onPointerUnlock(closed.state);
    expect(late).toEqual({ state: LOOK_ACTIVE, leave: false });
    // The next unlock is the human's Escape again.
    expect(onPointerUnlock(late.state).leave).toBe(true);
  });

  test("locking again voids an unlock still owed to us", () => {
    const closed = onWindowChange(opened(), fp(false, true)).state;
    expect(onPointerLock(closed)).toEqual({ state: LOOK_ACTIVE, pointer: null });
    expect(onPointerLock(LOOK_ACTIVE)).toEqual({ state: LOOK_ACTIVE, pointer: null });
  });

  test("a lock the browser grants after a window opened goes straight back to the window", () => {
    // Asked for before the window opened, so the rig did not hold it yet: nothing to release.
    const open = onWindowChange(LOOK_ACTIVE, fp(true, false)).state;
    const granted = onPointerLock(open);
    expect(granted).toEqual({ state: { paused: true, expectUnlock: true }, pointer: "release" });
    // That release's unlock keeps first person too.
    expect(onPointerUnlock(granted.state).leave).toBe(false);
  });

  test("without a window, losing the pointer (Escape) leaves first person as before", () => {
    expect(onPointerUnlock(LOOK_ACTIVE)).toEqual({ state: LOOK_ACTIVE, leave: true });
  });

  test("a window opened while the pointer was not locked pauses without a release", () => {
    const open = onWindowChange(LOOK_ACTIVE, fp(true, false));
    expect(open).toEqual({ state: { paused: true, expectUnlock: false }, pointer: null });
    // A stray unlock under the window never leaves first person.
    expect(onPointerUnlock(open.state).leave).toBe(false);
    expect(onWindowChange(open.state, fp(false, false)).pointer).toBe("relock");
  });

  test("third person is never paused, and leaving first person under a window does not relock", () => {
    const third = { windowOpen: true, firstPerson: false, locked: false };
    expect(onWindowChange(LOOK_ACTIVE, third)).toEqual({ state: LOOK_ACTIVE, pointer: null });
    const left = onWindowChange(onPointerUnlock(opened()).state, third);
    expect(left).toEqual({ state: LOOK_ACTIVE, pointer: null });
  });

  test("Escape belongs to the window while one is open", () => {
    expect(escapeLeaves(LOOK_ACTIVE, false)).toBe(true);
    expect(escapeLeaves(LOOK_ACTIVE, true)).toBe(false);
    expect(escapeLeaves(opened(), false)).toBe(false);
  });

  test("a click on the scene re-locks only when first person is live and not paused", () => {
    expect(mayRelockOnClick(LOOK_ACTIVE, true, false)).toBe(true);
    expect(mayRelockOnClick(LOOK_ACTIVE, true, true)).toBe(false);
    expect(mayRelockOnClick(LOOK_ACTIVE, false, false)).toBe(false);
    expect(mayRelockOnClick(opened(), true, false)).toBe(false);
  });

  test("the view is held from the window opening until the pointer has settled again", () => {
    const view = { yaw: 1.2 };
    const hold = holdView(view);
    // Window open, then closed but the pointer not back yet: held, however long.
    expect(heldView(hold, 0)).toBe(view);
    expect(heldView(hold, 1e9)).toBe(view);
    // Locked again at t = 1000: the cursor's trip back must not turn the view.
    const settling = holdUntilSettled(hold, 1000);
    expect(heldView(settling, 1000 + RELOCK_SETTLE_MS - 1)).toBe(view);
    expect(heldView(settling, 1000 + RELOCK_SETTLE_MS)).toBeNull();
    // Nothing held (no window was open): the mouse looks at once.
    expect(holdUntilSettled(null, 1000)).toBeNull();
    expect(heldView(null, 0)).toBeNull();
  });
});
