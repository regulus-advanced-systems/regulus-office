/**
 * The dictation key, Ctrl+Space, held (#260).
 *
 * It is taken only when the focused element is a dictation target (a terminal
 * the person controls, a text box) or a watched terminal, and dictation is on;
 * everywhere else the press is left untouched for the page: the whiteboard,
 * other fields, the scene. Taken presses are stopped in the capture phase, so
 * the terminal does not also receive Ctrl+Space (NUL) and a text box gets no
 * space while the key repeats or after Ctrl comes up first.
 *
 * No clash with the hotkey registry (it ignores every Ctrl combination and
 * every press in a text field) or with voice chat's M.
 */
import type { TargetLookup } from "./targets.ts";

export const DICTATION_HOTKEY = {
  id: "dictation",
  key: "Ctrl+Space",
  description:
    "Hold in a terminal you control or a text box to dictate; let go to stop. Nothing is sent until you press Enter",
  group: "Dictation",
} as const;

export interface HoldKeyEvent {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export function isDictationChord(e: HoldKeyEvent): boolean {
  return e.code === "Space" && e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
}

export interface HoldKeyPort {
  /** Returns whether dictation took the press. */
  begin(lookup: TargetLookup): boolean;
  release(): void;
}

export interface HoldKey {
  keydown(e: HoldKeyEvent): void;
  keyup(e: HoldKeyEvent): void;
  /** The window lost focus or the page was hidden: the key-up may never arrive. */
  drop(): void;
}

export function createHoldKey(port: HoldKeyPort, focused: () => TargetLookup): HoldKey {
  /** Space is physically down from a press dictation took. */
  let spaceDown = false;
  const swallow = (e: HoldKeyEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return {
    keydown: (e) => {
      if (spaceDown) {
        // Repeats, with or without Ctrl still down: never typed into the target.
        if (e.code === "Space") swallow(e);
        return;
      }
      if (!isDictationChord(e) || e.repeat) return;
      if (!port.begin(focused())) return;
      spaceDown = true;
      swallow(e);
    },
    keyup: (e) => {
      if (!spaceDown) return;
      if (e.code === "Space") {
        spaceDown = false;
        swallow(e);
        port.release();
      } else if (e.key === "Control") {
        port.release();
      }
    },
    drop: () => {
      spaceDown = false;
      port.release();
    },
  };
}
