/**
 * View toggle (SPEC §9.2): a HUD button and the `V` hotkey both flip the
 * view store between third and first person. `useViewHotkey` is bound once
 * per page (the scene binds it), so the `regulus:hotkey` event toggles once
 * however many HUD panels are on screen.
 */
import { useCallback } from "react";
import { useViewStore } from "../../state/view.ts";
import { Button } from "../components/Button.tsx";
import { type HotkeyEventDetail, hotkeys } from "../hotkeys/registry.ts";
import { useHotkeyEvents } from "../hotkeys/useHotkeys.ts";

export const VIEW_HOTKEY_ID = "toggleView";

/** Toggle the view on the `toggleView` hotkey event. Call once per page. */
export function useViewHotkey(target?: Window): void {
  const toggle = useViewStore((s) => s.toggle);
  const handler = useCallback(
    (detail: HotkeyEventDetail) => {
      if (detail.id === VIEW_HOTKEY_ID) toggle();
    },
    [toggle],
  );
  useHotkeyEvents(handler, target);
}

export function viewHint(pointerLocked: boolean, lookPaused = false): string {
  if (lookPaused) return "Looking around is paused while a window is open";
  return pointerLocked
    ? "Mouse to look, WASD to walk, Esc to return"
    : "Click the scene to look around, Esc to return";
}

export function ViewToggle() {
  const mode = useViewStore((s) => s.mode);
  const locked = useViewStore((s) => s.pointerLocked);
  const paused = useViewStore((s) => s.lookPaused);
  const toggle = useViewStore((s) => s.toggle);
  const firstPerson = mode === "first_person";
  const key =
    hotkeys
      .list()
      .find((b) => b.id === VIEW_HOTKEY_ID)
      ?.key.toUpperCase() ?? "V";
  return (
    <div className="rg-viewtoggle">
      <div className="rg-statusbox__row">
        <span className="rg-muted">View</span>
        <Button
          size="sm"
          variant={firstPerson ? "primary" : "secondary"}
          aria-pressed={firstPerson}
          title={`Toggle first-person view (${key})`}
          onClick={toggle}
        >
          First person <kbd className="rg-kbd">{key}</kbd>
        </Button>
      </div>
      {firstPerson && (
        <div className="rg-viewtoggle__hint rg-muted" aria-live="polite">
          {viewHint(locked, paused)}
        </div>
      )}
    </div>
  );
}
