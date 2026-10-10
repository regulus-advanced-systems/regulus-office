/**
 * Dictation on the HUD (#260): a small mic button by the focused terminal or
 * text box (hold it, or hold Ctrl+Space), the recording indicator in its place
 * while the microphone is open, and the notices (DictationNotice.tsx).
 *
 * Nothing here takes keyboard focus: the mic button and the notice's buttons
 * keep the focus in the box being dictated into, so the words land there. The
 * same choices are in Settings, Display and sound, for the keyboard.
 */
import { type CSSProperties, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DictationController } from "./controller.ts";
import { DictationNoticeCard, MicIcon } from "./DictationNotice.tsx";
import { type DictationPhase, useDictationStore } from "./dictationStore.ts";
import { DICTATION_HOTKEY } from "./holdKey.ts";
import {
  dictation,
  focusedTarget,
  useDictationKey,
  useFocusedTargetElement,
} from "./useDictation.ts";
import "./dictation.css";

const KEY = DICTATION_HOTKEY.key;

/** A box this tall (a terminal, a big text area) carries the pill inside its corner. */
const INSIDE_FROM_PX = 120;

/** Where the pill stands for a box at `rect`: its top-right corner, inside a tall one. */
export function pillPosition(rect: { top: number; right: number; height: number }): CSSProperties {
  const inside = rect.height >= INSIDE_FROM_PX;
  return {
    left: Math.max(48, rect.right - (inside ? 8 : 0)),
    top: inside ? rect.top + 8 : Math.max(36, rect.top - 6),
    transform: inside ? "translate(-100%, 0)" : "translate(-100%, -100%)",
  };
}

function usePillPosition(element: HTMLElement | null): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!element) {
      setStyle(null);
      return;
    }
    const place = () => setStyle(pillPosition(element.getBoundingClientRect()));
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();
    };
  }, [element]);
  return style;
}

export function phaseLabel(phase: DictationPhase): string {
  if (phase === "starting") return "Starting the microphone…";
  if (phase === "listening") return "Listening. Let go to stop";
  if (phase === "finishing") return "Finishing…";
  return "";
}

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

function Pill({ controller }: { controller: DictationController }) {
  const phase = useDictationStore((s) => s.phase);
  const interim = useDictationStore((s) => s.interim);
  const voicePaused = useDictationStore((s) => s.voicePaused);
  const recordingAt = useDictationStore((s) => s.recordingAt);
  const focused = useFocusedTargetElement();
  const recording = phase !== "idle";
  const style = usePillPosition(recording ? recordingAt : focused);
  if (!style) return null;
  return (
    <div className="rg-dictation" style={style} data-testid="dictation-pill" data-phase={phase}>
      {recording && (
        <span className="rg-dictation__live" role="status" data-testid="dictation-indicator">
          <span
            className="rg-lamp rg-dictation__lamp"
            data-blink={phase === "listening"}
            aria-hidden="true"
          />
          <span className="rg-dictation__label">{phaseLabel(phase)}</span>
          {interim && (
            <span className="rg-dictation__interim" data-testid="dictation-interim">
              {interim}
            </span>
          )}
          {voicePaused && (
            <span className="rg-dictation__note">Voice chat mic muted meanwhile</span>
          )}
        </span>
      )}
      <button
        type="button"
        className="rg-dictation__mic"
        tabIndex={-1}
        aria-label={`Hold to dictate (${KEY})`}
        title={`Hold to dictate (or hold ${KEY})`}
        aria-pressed={recording}
        data-testid="dictation-mic"
        onMouseDown={keepFocus}
        onContextMenu={keepFocus}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          controller.begin(focusedTarget());
        }}
        onPointerUp={() => controller.release()}
        onPointerCancel={() => controller.release()}
        onLostPointerCapture={() => controller.release()}
      >
        <MicIcon />
      </button>
    </div>
  );
}

export function DictationHost({ controller = dictation() }: { controller?: DictationController }) {
  useDictationKey(controller);
  return createPortal(
    <>
      <Pill controller={controller} />
      <DictationNoticeCard controller={controller} />
    </>,
    document.body,
  );
}
