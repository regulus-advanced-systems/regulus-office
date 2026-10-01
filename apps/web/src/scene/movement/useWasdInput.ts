/**
 * Tracks which movement keys (and Shift, to run: #223) are held. Presses in text fields or while a HUD
 * overlay owns the keyboard are ignored (same rules as the hotkey registry);
 * every key is released when the window loses focus so the avatar never
 * keeps walking after an alt-tab.
 */
import { type RefObject, useEffect, useRef } from "react";
import { useUiStore } from "../../state/ui.ts";
import { isEditableTarget } from "../../ui/hotkeys/registry.ts";
import { EMPTY_KEYS, type KeyState, movementKeyFor, nextKeyState } from "./wasd.ts";

const modifiers = (e: KeyboardEvent) => ({
  key: e.key,
  shiftKey: e.shiftKey,
  ctrlKey: e.ctrlKey,
  metaKey: e.metaKey,
  altKey: e.altKey,
});

export function useWasdInput(target: Window = window): RefObject<KeyState> {
  const keys = useRef<KeyState>({ ...EMPTY_KEYS });
  const overlay = useUiStore((s) => s.overlay);

  useEffect(() => {
    const release = () => {
      keys.current = { ...EMPTY_KEYS };
    };
    if (overlay !== null) {
      release();
      return;
    }
    const onKey = (down: boolean) => (event: KeyboardEvent) => {
      const editable = isEditableTarget(event.target);
      keys.current = nextKeyState(keys.current, { ...modifiers(event), editable }, down);
      // Movement keys are ours (repeats too); Shift keeps its default (it is a modifier).
      const chord = event.ctrlKey || event.metaKey || event.altKey;
      if (!editable && !chord && movementKeyFor(event.key)) event.preventDefault();
    };
    const onDown = onKey(true);
    const onUp = onKey(false);
    target.addEventListener("keydown", onDown);
    target.addEventListener("keyup", onUp);
    target.addEventListener("blur", release);
    return () => {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", release);
      release();
    };
  }, [overlay, target]);

  return keys;
}
