/**
 * The emote wheel's logic (#49), pure: hold G to open it, point (mouse) or
 * step (arrow keys) to a slice, let go of G to play it; a digit plays that
 * slice at once; Escape closes without playing. A quick tap of G leaves the
 * wheel open (sticky) so it can be used without holding a key: then Enter,
 * a click or a digit plays, and G or Escape closes.
 */
import { EMOTES, type Emote } from "@regulus/protocol";

/** Slices clockwise from the top. */
export const WHEEL_EMOTES: readonly Emote[] = EMOTES;

/** A G press shorter than this, with nothing picked, leaves the wheel open. */
export const TAP_MS = 250;
/** Pointer this close to the wheel's centre (px) picks nothing. */
export const DEAD_ZONE_PX = 36;

export interface WheelState {
  open: boolean;
  /** Index into WHEEL_EMOTES, or null. */
  selected: number | null;
  /** Opened by a tap: stays open after G is released. */
  sticky: boolean;
  /** When G went down (ms). */
  openedAt: number;
}

export const CLOSED: WheelState = { open: false, selected: null, sticky: false, openedAt: 0 };

export type WheelEvent =
  | { type: "open"; at: number }
  | { type: "key"; key: string }
  | { type: "release"; at: number }
  | { type: "point"; index: number | null }
  | { type: "pick"; index: number }
  | { type: "close" };

export interface WheelStep {
  state: WheelState;
  /** The emote to play now, if any. */
  play: Emote | null;
}

const wrap = (i: number) => (i + WHEEL_EMOTES.length) % WHEEL_EMOTES.length;

/** The slice under a pointer at `(dx, dy)` px from the centre (y down), or null in the dead zone. */
export function sliceAt(dx: number, dy: number, deadZone = DEAD_ZONE_PX): number | null {
  if (Math.hypot(dx, dy) < deadZone) return null;
  const n = WHEEL_EMOTES.length;
  // 0 at the top, growing clockwise; each slice is centred on its angle.
  const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(angle / ((Math.PI * 2) / n)) % n;
}

/** Centre of slice `i` as a unit vector (x right, y down), for layout. */
export function sliceDirection(i: number): { x: number; y: number } {
  const angle = (i / WHEEL_EMOTES.length) * Math.PI * 2;
  return { x: Math.sin(angle), y: -Math.cos(angle) };
}

const done = (play: Emote | null = null): WheelStep => ({ state: CLOSED, play });

export function wheelStep(state: WheelState, event: WheelEvent): WheelStep {
  const stay = (next: Partial<WheelState>): WheelStep => ({
    state: { ...state, ...next },
    play: null,
  });
  switch (event.type) {
    case "open":
      // G again while a sticky wheel is open closes it.
      if (state.open) return state.sticky ? done() : stay({});
      return {
        state: { open: true, selected: null, sticky: false, openedAt: event.at },
        play: null,
      };
    case "close":
      return done();
    case "point":
      return state.open ? stay({ selected: event.index }) : stay({});
    case "pick":
      return state.open ? done(WHEEL_EMOTES[event.index] ?? null) : stay({});
    case "release": {
      if (!state.open || state.sticky) return stay({});
      if (state.selected !== null) return done(WHEEL_EMOTES[state.selected] ?? null);
      // A tap: keep the wheel open for the keyboard or a click; a long hold over nothing closes.
      return event.at - state.openedAt < TAP_MS ? stay({ sticky: true }) : done();
    }
    case "key": {
      if (!state.open) return stay({});
      const { key } = event;
      if (key === "Escape") return done();
      const digit = Number.parseInt(key, 10);
      if (key.length === 1 && digit >= 1 && digit <= WHEEL_EMOTES.length)
        return done(WHEEL_EMOTES[digit - 1] ?? null);
      if (key === "Enter" || key === " ")
        return state.selected === null ? stay({}) : done(WHEEL_EMOTES[state.selected] ?? null);
      const forward = key === "ArrowRight" || key === "ArrowDown" || key === "Tab";
      const back = key === "ArrowLeft" || key === "ArrowUp";
      if (!forward && !back) return stay({});
      const from = state.selected ?? (forward ? -1 : 0);
      return stay({ selected: wrap(from + (forward ? 1 : -1)) });
    }
  }
}
