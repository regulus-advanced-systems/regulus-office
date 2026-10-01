/**
 * ARIA tabs (WAI-ARIA Authoring Practices "Tabs", automatic activation):
 * a `tablist` of `tab` buttons with a roving tab stop, and one `tabpanel`
 * per tab. The arrow keys move between tabs (both axes, so the rail works
 * whether it is laid out vertically or wraps into rows), Home and End jump
 * to the first and last. Only the active panel renders its content; the
 * others stay as empty, hidden panels so every `aria-controls` resolves.
 */
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

export interface TabItem<Id extends string> {
  id: Id;
  label: string;
  render: () => ReactNode;
}

export interface TabsProps<Id extends string> {
  /** Accessible name of the tab list. */
  label: string;
  tabs: readonly TabItem<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

const NEXT = new Set(["ArrowDown", "ArrowRight"]);
const PREV = new Set(["ArrowUp", "ArrowLeft"]);

export function Tabs<Id extends string>({
  label,
  tabs,
  active,
  onSelect,
  orientation = "horizontal",
  className,
}: TabsProps<Id>) {
  const base = useId();
  const refs = useRef(new Map<Id, HTMLButtonElement>());
  const tabId = (id: Id) => `${base}-tab-${id}`;
  const panelId = (id: Id) => `${base}-panel-${id}`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === active);
    let next: number | null = null;
    if (NEXT.has(e.key)) next = (index + 1) % tabs.length;
    else if (PREV.has(e.key)) next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    const tab = next === null ? undefined : tabs[next];
    if (!tab) return;
    e.preventDefault();
    onSelect(tab.id);
    refs.current.get(tab.id)?.focus();
  };

  return (
    <div
      className={["rg-tabs", className].filter(Boolean).join(" ")}
      data-orientation={orientation}
    >
      <div
        role="tablist"
        aria-label={label}
        aria-orientation={orientation}
        className="rg-tabs__list"
        onKeyDown={onKeyDown}
      >
        {tabs.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) refs.current.set(t.id, el);
                else refs.current.delete(t.id);
              }}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={selected}
              aria-controls={panelId(t.id)}
              tabIndex={selected ? 0 : -1}
              className="rg-tabs__tab"
              onClick={() => onSelect(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={panelId(t.id)}
          aria-labelledby={tabId(t.id)}
          hidden={t.id !== active}
          tabIndex={0}
          className="rg-tabs__panel"
        >
          {t.id === active && t.render()}
        </div>
      ))}
    </div>
  );
}
