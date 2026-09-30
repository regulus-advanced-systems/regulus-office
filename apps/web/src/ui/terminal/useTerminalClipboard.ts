/**
 * Wires {@link clipboardKeyAction}, copy-on-select and the right-click menu
 * to a terminal element (#156). The keydown listener runs in the capture
 * phase, before xterm's own: a copy is handled here and never reaches the
 * terminal (Ctrl+Shift+C would otherwise open the browser's inspector); a
 * paste shortcut is kept from xterm but not from the browser, whose native
 * paste then reaches xterm's paste handler (bracketed paste, typed input).
 *
 * #164: the drag may end outside the terminal, so the mouseup is caught on the
 * document; "Copy selection" / "Copy screen" copy from a click; a copy the
 * browser refuses every way shows the text selected, to copy by hand.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ClipboardApi,
  clipboardKeyAction,
  copyText,
  isMacPlatform,
  readText,
} from "./clipboard.ts";
import type { TerminalHost } from "./host.ts";

/** Room the right-click menu needs inside the terminal box. */
const MENU_PX = { width: 120, height: 76 };

/** How long "Copied" stays up. */
export const FLASH_MS = 1400;

export interface TerminalMenuState {
  x: number;
  y: number;
  selection: string;
}

export interface TerminalClipboard {
  /** Short status over the terminal ("Copied"), or null. */
  flash: string | null;
  /** Text the browser would not let us copy: shown selected, to copy by hand. */
  failed: string | null;
  dismissFailed: () => void;
  menu: TerminalMenuState | null;
  closeMenu: () => void;
  copy: (text: string) => Promise<void>;
  copySelection: () => Promise<void>;
  copyScreen: () => Promise<void>;
  /** The terminal has a selection ("Copy selection" is enabled). */
  hasSelection: boolean;
  pasteFromClipboard: () => Promise<void>;
  mac: boolean;
}

export interface ClipboardDeps {
  clipboard?: ClipboardApi;
  mac?: boolean;
}

export function useTerminalClipboard(
  element: HTMLElement | null,
  host: TerminalHost | null,
  readOnly: boolean,
  deps: ClipboardDeps = {},
): TerminalClipboard {
  const [flash, setFlash] = useState<string | null>(null);
  const [menu, setMenu] = useState<TerminalMenuState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mac = deps.mac ?? isMacPlatform();
  const clipboard = deps.clipboard;

  const show = useCallback((message: string) => {
    setFlash(message);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      if (!text) return;
      // The hidden textarea of the fallback goes into the terminal's box, inside the dialog.
      const ok = await copyText(text, clipboard, { container: element?.parentElement });
      if (ok) {
        setFailed(null);
        show("Copied");
      } else {
        setFailed(text);
      }
    },
    [clipboard, show, element],
  );
  const copySelection = useCallback(async () => {
    if (host) await copy(host.getSelection());
  }, [host, copy]);
  const copyScreen = useCallback(async () => {
    if (host) await copy(host.getScreenText());
  }, [host, copy]);

  useEffect(() => {
    if (!host) {
      setHasSelection(false);
      return;
    }
    const update = () => setHasSelection(host.getSelection() !== "");
    update();
    return host.onSelectionChange(update);
  }, [host]);

  const pasteShortcut = mac ? "Cmd+V" : "Ctrl+Shift+V";
  const pasteFromClipboard = useCallback(async () => {
    if (!host || readOnly) return;
    const text = await readText(clipboard);
    if (text === null) {
      show(`Paste with ${pasteShortcut}`);
      return;
    }
    host.paste(text);
    host.focus();
  }, [host, readOnly, clipboard, show, pasteShortcut]);

  useEffect(() => {
    if (!element || !host) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const selection = host.getSelection();
      const action = clipboardKeyAction(event, { mac, readOnly, hasSelection: selection !== "" });
      if (action === "copy") {
        event.preventDefault();
        event.stopPropagation();
        void copy(selection);
      } else if (action === "paste") {
        // Not preventDefault: the browser's paste is what delivers the text to xterm.
        event.stopPropagation();
      }
    };
    const doc = element.ownerDocument;
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return;
      doc.removeEventListener("mouseup", onMouseUp, true);
      // xterm finishes the selection on the same mouseup; read it afterwards.
      setTimeout(() => {
        const selection = host.getSelection();
        if (selection) void copy(selection);
      }, 0);
    };
    // A drag often ends past the terminal's edge: listen on the document until it ends.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0) doc.addEventListener("mouseup", onMouseUp, true);
    };
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      // The menu sits in the terminal's box (the element's parent), kept inside it.
      const box = (element.parentElement ?? element).getBoundingClientRect();
      setMenu({
        x: Math.max(0, Math.min(event.clientX - box.left, box.width - MENU_PX.width)),
        y: Math.max(0, Math.min(event.clientY - box.top, box.height - MENU_PX.height)),
        selection: host.getSelection(),
      });
    };
    element.addEventListener("keydown", onKeyDown, true);
    // Capture: xterm stops the mousedown of a selection drag from bubbling.
    element.addEventListener("mousedown", onMouseDown, true);
    element.addEventListener("contextmenu", onContextMenu);
    return () => {
      element.removeEventListener("keydown", onKeyDown, true);
      element.removeEventListener("mousedown", onMouseDown, true);
      doc.removeEventListener("mouseup", onMouseUp, true);
      element.removeEventListener("contextmenu", onContextMenu);
    };
  }, [element, host, mac, readOnly, copy]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const dismissFailed = useCallback(() => setFailed(null), []);
  return {
    flash,
    failed,
    dismissFailed,
    menu,
    closeMenu,
    copy,
    copySelection,
    copyScreen,
    hasSelection,
    pasteFromClipboard,
    mac,
  };
}
