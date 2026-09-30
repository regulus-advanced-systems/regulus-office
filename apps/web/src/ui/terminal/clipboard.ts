/**
 * Copy and paste for the terminals (#156). xterm.js itself only copies on a
 * browser `copy` event (Cmd+C on a Mac, or the native context menu), and in
 * control mode Ctrl+C is the terminal's interrupt, so nothing could be copied
 * on Linux or Windows. The office adds:
 *
 * - selecting text copies it;
 * - Ctrl+Shift+C / Ctrl+Insert (Cmd+C on a Mac) copies, and so does Ctrl+C
 *   for a watcher with a selection (a watcher cannot interrupt anyway);
 * - Ctrl+Shift+V / Shift+Insert (Cmd+V on a Mac) pastes in control mode:
 *   the browser's own paste reaches xterm, which brackets it when the
 *   program asked for bracketed paste. Plain Ctrl+V still goes to the
 *   program (Claude Code uses it to paste images);
 * - a right-click menu with Copy and Paste.
 *
 * Nothing here logs the text or sends it anywhere but the clipboard and,
 * for a paste, the controller's own terminal.
 */

export type ClipboardAction = "copy" | "paste";

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface ClipboardContext {
  mac: boolean;
  readOnly: boolean;
  hasSelection: boolean;
}

/** What a keydown means for the clipboard, or null to leave it to the terminal. */
export function clipboardKeyAction(ev: KeyLike, ctx: ClipboardContext): ClipboardAction | null {
  if (ev.altKey) return null;
  const key = ev.key.toLowerCase();
  if (ctx.mac) {
    if (!ev.metaKey || ev.ctrlKey || ev.shiftKey) return null;
    if (key === "c") return ctx.hasSelection ? "copy" : null;
    if (key === "v") return ctx.readOnly ? null : "paste";
    return null;
  }
  if (ev.metaKey) return null;
  if (ev.ctrlKey && ev.shiftKey && key === "c") return "copy";
  if (ev.ctrlKey && ev.shiftKey && key === "v") return ctx.readOnly ? null : "paste";
  if (ev.ctrlKey && !ev.shiftKey && key === "insert") return "copy";
  if (ev.shiftKey && !ev.ctrlKey && key === "insert") return ctx.readOnly ? null : "paste";
  if (ev.ctrlKey && !ev.shiftKey && key === "c" && ctx.readOnly && ctx.hasSelection) return "copy";
  return null;
}

export function isMacPlatform(nav: { platform?: string; userAgent?: string } = navigator): boolean {
  return /mac|iphone|ipad/i.test(nav.platform || nav.userAgent || "");
}

export interface ClipboardApi {
  writeText?: (text: string) => Promise<void>;
  readText?: () => Promise<string>;
}

const browserClipboard = (): ClipboardApi | undefined =>
  typeof navigator === "undefined" ? undefined : navigator.clipboard;

/**
 * Puts `text` on the clipboard. Uses the async Clipboard API, falling back to
 * a hidden textarea and `execCommand("copy")` where it is missing (plain http).
 */
export async function copyText(
  text: string,
  clipboard: ClipboardApi | undefined = browserClipboard(),
): Promise<boolean> {
  if (!text) return false;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  previous?.focus?.();
  return ok;
}

/** Reads the clipboard for the Paste menu item; null when the browser refuses. */
export async function readText(
  clipboard: ClipboardApi | undefined = browserClipboard(),
): Promise<string | null> {
  if (!clipboard?.readText) return null;
  try {
    return await clipboard.readText();
  } catch {
    return null;
  }
}
