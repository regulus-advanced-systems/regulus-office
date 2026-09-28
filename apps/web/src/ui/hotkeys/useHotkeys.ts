/**
 * Bind the shared hotkey registry to window keydown. Presses resolve through
 * the registry (which ignores modifiers, text fields and open overlays) and
 * are published as `regulus:hotkey` events; `?` is handled here and opens the
 * help overlay.
 */
import { useEffect } from "react";
import { useUiStore } from "../../state/ui.ts";
import {
  dispatchHotkey,
  HOTKEY_EVENT,
  type HotkeyEventDetail,
  hotkeys,
  isEditableTarget,
  isFocusedControl,
} from "./registry.ts";

export function useGlobalHotkeys(target: Window = window): void {
  const overlay = useUiStore((s) => s.overlay);
  const toggleOverlay = useUiStore((s) => s.toggleOverlay);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const binding = hotkeys.resolve({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        editable: isEditableTarget(event.target),
        focused: isFocusedControl(event.target),
        overlayOpen: overlay !== null,
      });
      if (!binding) return;
      event.preventDefault();
      if (binding.id === "help") toggleOverlay("help");
      dispatchHotkey(binding, target);
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [overlay, toggleOverlay, target]);
}

/** Subscribe to hotkey events (for #15 / #17 and the ui-kit demo). */
export function useHotkeyEvents(
  handler: (detail: HotkeyEventDetail) => void,
  target: Window = window,
): void {
  useEffect(() => {
    const on = (event: Event) => handler((event as CustomEvent<HotkeyEventDetail>).detail);
    target.addEventListener(HOTKEY_EVENT, on);
    return () => target.removeEventListener(HOTKEY_EVENT, on);
  }, [handler, target]);
}
