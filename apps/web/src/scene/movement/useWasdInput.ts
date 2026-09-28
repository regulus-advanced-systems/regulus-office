/**
 * Tracks which movement keys are held. Presses in text fields or while a HUD
 * overlay owns the keyboard are ignored (same rules as the hotkey registry);
 * every key is released when the window loses focus so the avatar never
 * keeps walking after an alt-tab.
 */
import { type RefObject, useEffect, useRef } from "react";
import { useUiStore } from "../../state/ui.ts";
import { isEditableTarget } from "../../ui/hotkeys/registry.ts";
import { EMPTY_KEYS, type KeyState, movementKeyFor } from "./wasd.ts";

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
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = movementKeyFor(event.key);
      if (!key) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      keys.current = { ...keys.current, [key]: down };
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
