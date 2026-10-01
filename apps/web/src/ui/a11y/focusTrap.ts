/**
 * Focus-trap helpers (SPEC §11: every panel keyboard-navigable). The pure
 * parts (`nextFocusIndex`, `resolveTrapMove`) are unit-tested without a DOM;
 * `getFocusable` and `trapTabKey` are the thin DOM bindings used by Modal.
 */

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

/**
 * Index of the element that should receive focus after Tab / Shift+Tab.
 * `current` is the index of the active element within `count` items, or -1
 * when focus is outside the trap (or on the container itself).
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}

export interface TrapMove {
  /** Element index to focus, or -1 to leave focus alone. */
  index: number;
  /** Whether the browser default should be suppressed. */
  preventDefault: boolean;
}

/**
 * Decide what a Tab keypress inside a trap should do. With no focusable
 * children the container keeps focus; otherwise focus cycles.
 */
export function resolveTrapMove(count: number, current: number, shiftKey: boolean): TrapMove {
  if (count === 0) return { index: -1, preventDefault: true };
  return { index: nextFocusIndex(count, current, shiftKey), preventDefault: true };
}

const radioName = (el: HTMLElement): string | null =>
  el.tagName === "INPUT" && (el as HTMLInputElement).type === "radio"
    ? (el as HTMLInputElement).name || null
    : null;

/**
 * Visible, enabled, tabbable descendants of `root` in document order. A
 * named radio group is one tab stop, as in the browser: its checked radio
 * (else its first); arrow keys move within the group.
 */
export function getFocusable(root: ParentNode): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
  );
  const stops = new Map<string, HTMLElement>();
  for (const el of all) {
    const name = radioName(el);
    if (!name) continue;
    const stop = stops.get(name);
    if (!stop || (!(stop as HTMLInputElement).checked && (el as HTMLInputElement).checked)) {
      stops.set(name, el);
    }
  }
  return all.filter((el) => {
    const name = radioName(el);
    return !name || stops.get(name) === el;
  });
}

/** keydown handler body for a trap container; returns true when it acted. */
export function trapTabKey(root: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== "Tab") return false;
  const items = getFocusable(root);
  const active = document.activeElement;
  const current = active instanceof HTMLElement ? items.indexOf(active) : -1;
  const move = resolveTrapMove(items.length, current, event.shiftKey);
  if (move.preventDefault) event.preventDefault();
  if (move.index >= 0) items[move.index]?.focus();
  else root.focus();
  return true;
}
