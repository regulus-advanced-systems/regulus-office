/**
 * First person and windows (#282, SPEC §9.2). While any window is open
 * (state/windows.ts) the first-person look is paused: the pointer is
 * released so the cursor shows and can use the window, the mouse no longer
 * turns the view and the movement keys no longer walk. When the last window
 * closes the look resumes where it was: the camera is not touched in
 * between, so there is no jump in direction.
 *
 * Pure decisions; `FirstPersonRig.tsx` applies them. The tricky part is the
 * pointer-lock `unlock` event: without a window it means the human pressed
 * Escape and wants third person back; the one that follows our own release
 * must not leave first person, even when it arrives after the window has
 * already closed again (the browser reports the unlock asynchronously).
 */

export interface LookPause {
  /** A window is open: no mouse look, no walking. */
  readonly paused: boolean;
  /** We released the pointer ourselves and its `unlock` event has not arrived yet. */
  readonly expectUnlock: boolean;
}

export const LOOK_ACTIVE: LookPause = { paused: false, expectUnlock: false };

/** What the rig does to the pointer lock after a change. */
export type PointerAction = "release" | "relock" | null;

export interface PauseInput {
  /** A window (modal or HUD overlay) is open. */
  windowOpen: boolean;
  /** First person is the requested view mode. */
  firstPerson: boolean;
  /** The rig holds the pointer lock right now. */
  locked: boolean;
}

/**
 * A window opened or closed, or the view mode changed. Opening one window
 * from another keeps `windowOpen` true throughout, so nothing happens then.
 */
export function onWindowChange(
  state: LookPause,
  input: PauseInput,
): { state: LookPause; pointer: PointerAction } {
  const paused = input.firstPerson && input.windowOpen;
  if (paused === state.paused) return { state, pointer: null };
  if (paused) {
    // Only a pointer we hold is released; its unlock event is ours, not an Escape.
    return {
      state: { paused: true, expectUnlock: input.locked },
      pointer: input.locked ? "release" : null,
    };
  }
  return {
    state: { paused: false, expectUnlock: state.expectUnlock },
    pointer: input.firstPerson && !input.locked ? "relock" : null,
  };
}

/**
 * The pointer lock was lost. `leave` is true when that should end first
 * person (the human's Escape), false for the unlock we caused or one that
 * happens under an open window.
 */
export function onPointerUnlock(state: LookPause): { state: LookPause; leave: boolean } {
  if (state.expectUnlock) return { state: { ...state, expectUnlock: false }, leave: false };
  return { state, leave: !state.paused };
}

/**
 * The pointer was locked. Normally any unlock still owed to us is void. A
 * lock granted under an open window (asked for just before it opened; the
 * browser grants it later) is given straight back to the window.
 */
export function onPointerLock(state: LookPause): { state: LookPause; pointer: PointerAction } {
  if (state.paused) return { state: { paused: true, expectUnlock: true }, pointer: "release" };
  return { state: state.expectUnlock ? LOOK_ACTIVE : state, pointer: null };
}

/**
 * How long after the pointer is locked again the view is still held. Browsers
 * may report one mouse movement for the cursor's trip from the window's close
 * button back to the lock point; without the hold the view would twitch.
 */
export const RELOCK_SETTLE_MS = 200;

/**
 * The view saved when a window opened, held until the pointer has settled.
 * `until` is when the hold ends: never while the window is open or the
 * pointer is still free, `RELOCK_SETTLE_MS` after it is locked again.
 */
export interface ViewHold<Q> {
  readonly view: Q;
  readonly until: number;
}

export function holdView<Q>(view: Q): ViewHold<Q> {
  return { view, until: Number.POSITIVE_INFINITY };
}

/** The pointer is locked again at `now`: the hold ends once it has settled. */
export function holdUntilSettled<Q>(hold: ViewHold<Q> | null, now: number): ViewHold<Q> | null {
  return hold ? { view: hold.view, until: now + RELOCK_SETTLE_MS } : null;
}

/** The view to keep at `now`, or null when the hold is over. */
export function heldView<Q>(hold: ViewHold<Q> | null, now: number): Q | null {
  return hold && now < hold.until ? hold.view : null;
}

/** Escape leaves first person only when no window is there to take it. */
export function escapeLeaves(state: LookPause, windowOpen: boolean): boolean {
  return !state.paused && !windowOpen;
}

/** A click on the scene may re-lock the pointer only while the look is not paused. */
export function mayRelockOnClick(state: LookPause, firstPerson: boolean, locked: boolean): boolean {
  return firstPerson && !locked && !state.paused;
}
