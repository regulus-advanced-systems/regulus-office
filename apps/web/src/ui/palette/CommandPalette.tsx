/**
 * The command palette (#261): Ctrl+K (Cmd+K) opens a console dialog with one
 * text field and a list. Type to narrow it, Up and Down to move, Enter to go,
 * Escape (or Ctrl+K again) to close; the mouse works too but is never
 * needed. What it lists is built once, when it opens, from what this browser
 * already holds for its viewer (entries.ts says from where and why that is
 * all a person may see); what an entry does is in run.ts.
 *
 * Focus stays in the text field the whole time (a combobox over a listbox,
 * `aria-activedescendant` naming the highlighted row), so typing never has to
 * find its way back.
 */
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useUiStore } from "../../state/ui.ts";
import { Modal } from "../components/Modal.tsx";
import { buildEntries, type PaletteEntry, type PaletteSources, paletteResults } from "./entries.ts";
import { PALETTE_OVERLAY, useCommandPaletteHotkey } from "./hotkey.ts";
import { gatherSources, runPaletteAction } from "./run.ts";
import "./palette.css";

export interface CommandPaletteProps {
  /** What to list from; defaults to the stores (tests pass a fixed snapshot). */
  sources?: () => PaletteSources;
  /** What picking an entry does; defaults to `runPaletteAction`. */
  run?: (entry: PaletteEntry) => void;
}

export function CommandPalette({
  sources = gatherSources,
  run = (entry) => runPaletteAction(entry.action),
}: CommandPaletteProps) {
  const close = useUiStore((s) => s.closeOverlay);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ids = { input: useId(), list: useId() };
  // A snapshot, read once per opening: the list does not shift under the cursor while people walk about.
  const entries = useMemo(() => buildEntries(sources()), []);
  const { shown, more } = useMemo(() => paletteResults(entries, query), [entries, query]);
  const at = Math.min(active, Math.max(0, shown.length - 1));
  const optionId = (i: number) => `${ids.list}-${i}`;

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [at, shown]);

  const onClose = () => close(PALETTE_OVERLAY);
  const pick = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    // Close first: what the entry opens takes the keyboard next.
    onClose();
    run(entry);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (shown.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((at + step + shown.length) % shown.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(shown[at]);
    }
  };

  return (
    <Modal open onClose={onClose} title="Command palette" width={600} initialFocus={inputRef}>
      <div className="rg-palette">
        <label className="rg-sr-only" htmlFor={ids.input}>
          Go to a level, room, person, henchman, issue or action
        </label>
        <input
          ref={inputRef}
          id={ids.input}
          type="text"
          role="combobox"
          className="rg-input rg-palette__input"
          data-testid="palette-input"
          placeholder="Go to a level, room, person, henchman, issue or action"
          aria-expanded="true"
          aria-controls={ids.list}
          aria-autocomplete="list"
          aria-activedescendant={shown.length > 0 ? optionId(at) : undefined}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {/* Focus stays in the combobox, which names the highlighted option; rows take the mouse only. */}
        <div
          ref={listRef}
          id={ids.list}
          role="listbox"
          aria-label="Commands"
          className="rg-palette__list"
          data-testid="palette-list"
        >
          {shown.map((entry, i) => (
            <div
              key={entry.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === at}
              className="rg-palette__option"
              data-entry={entry.id}
              // Keep focus in the text field when the mouse is used.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => i !== at && setActive(i)}
              onClick={() => pick(entry)}
            >
              <span className="rg-palette__group">{entry.group}</span>
              <span className="rg-palette__title">{entry.title}</span>
              {entry.hint && <span className="rg-palette__hint">{entry.hint}</span>}
            </div>
          ))}
        </div>
        <p className="rg-palette__status" role="status" data-testid="palette-status">
          {shown.length === 0
            ? "Nothing here by that name."
            : more > 0
              ? `${more} more: keep typing to narrow it down.`
              : ""}
        </p>
        <p className="rg-palette__help">
          <kbd className="rg-kbd">↑</kbd> <kbd className="rg-kbd">↓</kbd> move ·{" "}
          <kbd className="rg-kbd">Enter</kbd> go · <kbd className="rg-kbd">Esc</kbd> close
        </p>
      </div>
    </Modal>
  );
}

/** Mounted once in the HUD: binds Ctrl/Cmd+K and shows the palette while it is open. */
export function CommandPaletteHost(props: CommandPaletteProps) {
  useCommandPaletteHotkey();
  const open = useUiStore((s) => s.overlay === PALETTE_OVERLAY);
  return open ? <CommandPalette {...props} /> : null;
}
