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
 * - a right-click menu with Copy and Paste;
 * - "Copy selection" and "Copy screen" buttons, and when the browser refuses
 *   every way to write the clipboard, the text shown selected to copy by hand
 *   (#164).
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
 * Puts `text` on the clipboard: the async Clipboard API first, then the copy
 * command ({@link copyWithCommand}) where the API is missing (plain http) or
 * refused (no permission, #164). True only when one of them took the text.
 * Call it from a click or key press: browsers allow both only then.
 */
export async function copyText(
  text: string,
  clipboard: ClipboardApi | undefined = browserClipboard(),
  options: CopyCommandOptions = {},
): Promise<boolean> {
  if (!text) return false;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // refused: fall through to the copy command
    }
  }
  return copyWithCommand(text, options);
}

export interface CopyCommandOptions {
  doc?: Document;
  /**
   * Where the hidden textarea goes: inside the open dialog, whose focus trap would
   * otherwise pull focus out of a textarea on <body> before the copy (#164).
   */
  container?: HTMLElement | null;
}

/**
 * `execCommand("copy")`, twice over. First with a `copy` listener that hands the
 * browser `text` (no focus or selection change; `beforecopy` is cancelled so Chromium
 * enables Copy without a selection). If no copy event carried it, a hidden textarea in
 * `container` is selected and copied. True only when the browser ran the copy with `text`.
 */
export function copyWithCommand(text: string, options: CopyCommandOptions = {}): boolean {
  const doc = options.doc ?? (typeof document === "undefined" ? undefined : document);
  if (!doc || !text) return false;
  let delivered = false;
  const enable = (event: Event) => event.preventDefault();
  const onCopy = (event: Event) => {
    const data = (event as ClipboardEvent).clipboardData;
    if (!data) return;
    data.setData("text/plain", text);
    event.preventDefault();
    // xterm's own copy handler would put its selection there instead.
    event.stopPropagation();
    delivered = true;
  };
  doc.addEventListener("beforecopy", enable, true);
  doc.addEventListener("copy", onCopy, true);
  try {
    if (runCopy(doc) && delivered) return true;
  } finally {
    doc.removeEventListener("beforecopy", enable, true);
    doc.removeEventListener("copy", onCopy, true);
  }
  return copyFromTextarea(text, doc, options.container ?? doc.body);
}

function runCopy(doc: Document): boolean {
  try {
    return doc.execCommand("copy");
  } catch {
    return false;
  }
}

function copyFromTextarea(text: string, doc: Document, container: HTMLElement): boolean {
  const previous = doc.activeElement as HTMLElement | null;
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  Object.assign(area.style, { position: "fixed", top: "0", left: "0", opacity: "0" });
  container.appendChild(area);
  area.focus({ preventScroll: true });
  area.select();
  // A focus trap may have taken focus back: then the copy would not take this text.
  const selected = doc.activeElement === area && area.selectionEnd - area.selectionStart > 0;
  const ok = selected && runCopy(doc);
  area.remove();
  previous?.focus?.({ preventScroll: true });
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
