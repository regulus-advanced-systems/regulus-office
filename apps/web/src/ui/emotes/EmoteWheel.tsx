/**
 * The emote wheel (#49): hold G, point at or arrow to an emote, let go to
 * play it (wave, thumbs up, clap, dance, point, facepalm); digits 1-6 play
 * one at once, Escape cancels, a quick tap of G keeps the wheel open for
 * the keyboard or a click (emoteWheel.ts has the rules). While it is open
 * it owns the keyboard, so arrows never walk the avatar. The emote goes to
 * the BuildingRoom (`emote`), which shows it to everyone.
 */
import { EMOTE_LABELS, type Emote } from "@regulus/protocol";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { getOfficeClient } from "../../net/index.ts";
import type { HotkeyEventDetail } from "../hotkeys/registry.ts";
import { useHotkeyEvents } from "../hotkeys/useHotkeys.ts";
import {
  CLOSED,
  sliceAt,
  sliceDirection,
  WHEEL_EMOTES,
  type WheelEvent,
  type WheelState,
  wheelStep,
} from "./emoteWheel.ts";
import "./emotes.css";

export interface EmoteClient {
  send(type: "emote", payload: { emote: Emote }): void;
}

/** Wheel radius to the slice centres, px. */
const RADIUS = 104;

export function EmoteWheel({ client }: { client?: EmoteClient }) {
  const [state, setState] = useState<WheelState>(CLOSED);
  const stateRef = useRef(state);
  const centre = useRef<HTMLDivElement>(null);
  const hintId = useId();

  const dispatch = useCallback(
    (event: WheelEvent) => {
      const step = wheelStep(stateRef.current, event);
      stateRef.current = step.state;
      setState(step.state);
      if (!step.play) return;
      try {
        (client ?? getOfficeClient()).send("emote", { emote: step.play });
      } catch {
        // Not connected: nothing to show anyway.
      }
    },
    [client],
  );

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id === "emoteWheel") dispatch({ type: "open", at: performance.now() });
      },
      [dispatch],
    ),
  );

  // Always listening, gated on the ref (set synchronously by `dispatch`), so keys pressed
  // right after G count even before React has drawn the wheel (a busy main thread).
  useEffect(() => {
    const open = () => stateRef.current.open;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!open() || e.key === "g" || e.key === "G") return; // G is the hotkey registry's
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) dispatch({ type: "key", key: e.key });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (open() && (e.key === "g" || e.key === "G"))
        dispatch({ type: "release", at: performance.now() });
    };
    const onPointer = (e: PointerEvent) => {
      if (!open()) return;
      const box = centre.current?.getBoundingClientRect();
      if (!box) return;
      const index = sliceAt(
        e.clientX - (box.left + box.width / 2),
        e.clientY - (box.top + box.height / 2),
      );
      if (index !== stateRef.current.selected) dispatch({ type: "point", index });
    };
    const onBlur = () => {
      if (open()) dispatch({ type: "close" });
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("blur", onBlur);
    };
  }, [dispatch]);

  if (!state.open) return null;
  const chosen = state.selected === null ? null : WHEEL_EMOTES[state.selected];
  return (
    <div className="rg-emotes" data-testid="emote-wheel">
      <div
        ref={centre}
        className="rg-emotes__wheel"
        role="menu"
        aria-label="Emotes"
        aria-describedby={hintId}
      >
        {WHEEL_EMOTES.map((emote, i) => {
          const d = sliceDirection(i);
          const { icon, label } = EMOTE_LABELS[emote];
          return (
            <button
              key={emote}
              type="button"
              role="menuitemradio"
              aria-checked={state.selected === i}
              tabIndex={-1}
              className="rg-emotes__slice"
              data-emote={emote}
              style={{ transform: `translate(${d.x * RADIUS}px, ${d.y * RADIUS}px)` }}
              onClick={() => dispatch({ type: "pick", index: i })}
              onPointerEnter={() => dispatch({ type: "point", index: i })}
            >
              <span className="rg-emotes__icon" aria-hidden="true">
                {icon}
              </span>
              <span className="rg-emotes__label">
                <span className="rg-emotes__key" aria-hidden="true">
                  {i + 1}
                </span>
                {label}
              </span>
            </button>
          );
        })}
        <div className="rg-emotes__hub" id={hintId} aria-live="polite">
          {chosen ? (
            <strong>{EMOTE_LABELS[chosen].label}</strong>
          ) : (
            <span>{state.sticky ? "Pick an emote" : "Release G to emote"}</span>
          )}
          <small>{state.sticky ? "Arrows + Enter, 1-6, Esc" : "Point or use arrows, 1-6"}</small>
        </div>
      </div>
    </div>
  );
}
