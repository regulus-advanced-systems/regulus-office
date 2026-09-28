/**
 * Tracks which movement actions (WASD / arrows) are held while `enabled`.
 * Text fields, modifier chords and repeats are ignored; blur and a hidden
 * tab clear the set so no key sticks. The set is a ref: `useFrame` reads it
 * without re-rendering.
 */
import { type RefObject, useEffect, useRef } from "react";
import { isEditableTarget } from "../../ui/hotkeys/registry.ts";
import { actionForCode, type MoveAction } from "./fpvMove.ts";

export function useHeldKeys(enabled: boolean, target: Window = window): RefObject<Set<MoveAction>> {
  const held = useRef(new Set<MoveAction>());
  useEffect(() => {
    const set = held.current;
    set.clear();
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const action = actionForCode(e.code);
      if (!action || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      set.add(action);
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const action = actionForCode(e.code);
      if (action) set.delete(action);
    };
    const clear = () => set.clear();
    const doc = target.document;
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
    target.addEventListener("blur", clear);
    doc.addEventListener("visibilitychange", clear);
    return () => {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", clear);
      doc.removeEventListener("visibilitychange", clear);
      set.clear();
    };
  }, [enabled, target]);
  return held;
}
