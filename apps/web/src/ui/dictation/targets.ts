/**
 * Where dictated text lands (#260): the thing that has keyboard focus, if it
 * takes typed text.
 *
 * - A henchman's terminal (or a login terminal) the person controls. The text
 *   goes in through the terminal's own paste path, which is the path typing
 *   takes: nothing arrives while the terminal is read-only, and the office
 *   refuses input from a watcher's connection anyway. A terminal that is only
 *   watched is `blocked`, never a target.
 * - A text box: a `<textarea>` or a plain text `<input>` (the lobby chat, an
 *   office agent's conversation, a prompt or task box). Never a password or
 *   other typed field, a read-only or disabled one, the whiteboard, or
 *   anything under `data-dictation="off"`.
 *
 * Dictated text is one line of plain text: no line breaks and no control
 * characters, so nothing is submitted until the person presses Enter.
 */
import type { TerminalHost } from "../terminal/host.ts";

export interface DictationTarget {
  kind: "terminal" | "field";
  /** The element the mic button and the indicator stand by. */
  element: HTMLElement;
  /** Still there and still writable? */
  alive(): boolean;
  /** Type one finished phrase. */
  insert(phrase: string): void;
}

export type TargetLookup =
  | { target: DictationTarget }
  /** A terminal the person may only watch. */
  | { blocked: "watch-only" }
  | null;

/** One line of plain text: control characters (Enter among them) become spaces. */
export function cleanTranscript(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const control =
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    out += control ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Whether a phrase typed after `before` needs a space in front. */
export function needsSpace(before: string, phrase: string): boolean {
  if (before === "" || /\s$/.test(before)) return false;
  return !/^[.,;:!?)\]}]/.test(phrase);
}

interface TerminalEntry {
  element: HTMLElement;
  host: TerminalHost;
  readOnly: () => boolean;
}

const terminals = new Set<TerminalEntry>();
const watchers = new Set<() => void>();
const changed = () => {
  for (const w of watchers) w();
};

/** Told when a terminal comes, goes or changes between watching and control. */
export function onDictationTerminalsChanged(listener: () => void): () => void {
  watchers.add(listener);
  return () => void watchers.delete(listener);
}

/** A terminal on screen offers itself (TerminalScreen); returns the unregister. */
export function registerDictationTerminal(
  element: HTMLElement,
  host: TerminalHost,
  readOnly: () => boolean,
): () => void {
  const entry: TerminalEntry = { element, host, readOnly };
  terminals.add(entry);
  changed();
  return () => {
    terminals.delete(entry);
    changed();
  };
}

function terminalTarget(entry: TerminalEntry): DictationTarget {
  let typed = false;
  return {
    kind: "terminal",
    element: entry.element,
    alive: () => terminals.has(entry) && entry.element.isConnected && !entry.readOnly(),
    insert: (phrase) => {
      const text = cleanTranscript(phrase);
      // The same gate as typing: a watcher's terminal takes nothing.
      if (!text || !terminals.has(entry) || entry.readOnly()) return;
      // What is on the prompt line is the program's; phrases of one hold are spaced apart.
      entry.host.paste(typed ? ` ${text}` : text);
      typed = true;
    },
  };
}

const TEXT_INPUT_TYPES = new Set(["text", "search"]);

type Field = HTMLInputElement | HTMLTextAreaElement;

function asField(el: Element): Field | null {
  const tag = el.tagName;
  if (tag === "TEXTAREA") return el as HTMLTextAreaElement;
  if (tag !== "INPUT") return null;
  const type = (el.getAttribute("type") ?? "text").toLowerCase();
  return TEXT_INPUT_TYPES.has(type) ? (el as HTMLInputElement) : null;
}

function writable(field: Field): boolean {
  return field.isConnected && !field.disabled && !field.readOnly;
}

/** Type into a text box at the caret, the way a paste would, and tell React. */
export function insertIntoField(field: Field, phrase: string): void {
  const text = cleanTranscript(phrase);
  if (!text || !writable(field)) return;
  const value = field.value;
  const start = field.selectionStart ?? value.length;
  const end = field.selectionEnd ?? start;
  let insert = needsSpace(value.slice(0, start), text) ? ` ${text}` : text;
  const max = field.maxLength;
  if (max >= 0) insert = insert.slice(0, Math.max(0, max - (value.length - (end - start))));
  if (!insert) return;
  // Through the element's own setter, not the one React puts on the node: React
  // would take that for its own write and skip onChange.
  const proto = field.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set;
  const next = value.slice(0, start) + insert + value.slice(end);
  if (setValue) setValue.call(field, next);
  else field.value = next;
  const caret = start + insert.length;
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function fieldTarget(field: Field): DictationTarget {
  return {
    kind: "field",
    element: field,
    alive: () => writable(field),
    insert: (phrase) => insertIntoField(field, phrase),
  };
}

/** The dictation target for the element that has focus. */
export function resolveTarget(active: Element | null | undefined): TargetLookup {
  if (!active || !active.isConnected) return null;
  for (const entry of terminals) {
    if (!entry.element.contains(active)) continue;
    return entry.readOnly() ? { blocked: "watch-only" } : { target: terminalTarget(entry) };
  }
  // An xterm that did not offer itself (a laptop screen in the scene) has a textarea too.
  if (active.closest('.xterm, .rg-whiteboard, .excalidraw, [data-dictation="off"]')) return null;
  const field = asField(active);
  return field && writable(field) ? { target: fieldTarget(field) } : null;
}
