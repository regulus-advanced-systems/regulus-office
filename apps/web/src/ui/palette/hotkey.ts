/**
 * Ctrl+K / Cmd+K for the command palette (#261), and when it is the
 * palette's to take. The same chord means something to what may have the
 * keyboard: a shell kills to the end of the line, the whiteboard inserts a
 * link, a text field may have its own. So the press is the palette's only
 * when nothing else is using the keyboard:
 *
 *   - no window is open (state/windows.ts: any overlay, any modal; that
 *     covers the terminal modal, the whiteboard, Settings, build mode...),
 *   - and the key did not come from a text field, an editable element, a
 *     terminal (xterm types into a hidden textarea inside `.xterm`) or the
 *     whiteboard (`.excalidraw`), wherever they are mounted.
 *
 * Otherwise the event is left exactly as it was: no preventDefault, no
 * stopPropagation, so it reaches whoever it was meant for. With the palette
 * open the chord closes it again.
 */
import { useEffect } from "react";
import { useUiStore } from "../../state/ui.ts";
import { useWindowStore } from "../../state/windows.ts";
import { isEditableTarget } from "../hotkeys/registry.ts";

export const PALETTE_OVERLAY = "command-palette";

/** Elements that keep every key for themselves, whatever inside them has focus. */
export const KEEPS_KEYS_SELECTOR = ".xterm, .excalidraw, [data-keeps-keys]";

export interface PaletteKeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  /** Already handled by something else. */
  defaultPrevented?: boolean;
  /** The target is a text field, an editable element, a terminal or the whiteboard. */
  typing?: boolean;
  overlay: string | null;
  /** Modals open (state/windows.ts). */
  modals: number;
}

export function paletteKeyAction(input: PaletteKeyInput): "open" | "close" | null {
  if (input.key.toLowerCase() !== "k") return null;
  if (!(input.ctrlKey || input.metaKey) || input.altKey || input.shiftKey) return null;
  if (input.repeat || input.defaultPrevented) return null;
  if (input.overlay === PALETTE_OVERLAY) return "close";
  if (input.overlay !== null || input.modals > 0 || input.typing) return null;
  return "open";
}

/** Whether keys pressed on `target` are being typed into something. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (isEditableTarget(target)) return true;
  return target instanceof Element && target.closest(KEEPS_KEYS_SELECTOR) !== null;
}

/** Bind Ctrl/Cmd+K; call once per page (CommandPaletteHost does). */
export function useCommandPaletteHotkey(target: Window = window): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ui = useUiStore.getState();
      const action = paletteKeyAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
        defaultPrevented: event.defaultPrevented,
        typing: isTypingTarget(event.target),
        overlay: ui.overlay,
        modals: useWindowStore.getState().modals,
      });
      if (!action) return;
      event.preventDefault();
      if (action === "open") ui.openOverlay(PALETTE_OVERLAY);
      else ui.closeOverlay(PALETTE_OVERLAY);
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [target]);
}
