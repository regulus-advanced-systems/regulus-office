/**
 * Keep keyboard focus inside `ref` while `active`, close on Escape and give
 * focus back to whatever had it when the trap engaged (SPEC §11).
 */
import { type RefObject, useEffect } from "react";
import { getFocusable, trapTabKey } from "./focusTrap.ts";

export interface FocusTrapOptions {
  active: boolean;
  onEscape?: () => void;
  /** Element to focus first; defaults to the first focusable child, else the container. */
  initialFocus?: RefObject<HTMLElement | null>;
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, opts: FocusTrapOptions): void {
  const { active, onEscape, initialFocus } = opts;
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const first = initialFocus?.current ?? getFocusable(root)[0] ?? root;
    first.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscape?.();
        return;
      }
      trapTabKey(root, event);
    };
    // Focus that lands outside (e.g. via mouse) is pulled back in.
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) {
        (getFocusable(root)[0] ?? root).focus();
      }
    };
    root.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      if (opener?.isConnected) opener.focus();
    };
  }, [ref, active, onEscape, initialFocus]);
}
