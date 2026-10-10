/** Help overlay content: every registered shortcut, grouped. */
import {
  type HotkeyBinding,
  hotkeys,
  MOVEMENT_HELP,
  PALETTE_HELP,
  SOCIAL_HELP,
} from "./registry.ts";

export function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

export function groupBindings(list: readonly HotkeyBinding[]): [string, HotkeyBinding[]][] {
  const groups = new Map<string, HotkeyBinding[]>();
  for (const b of list) {
    const bucket = groups.get(b.group) ?? [];
    bucket.push(b);
    groups.set(b.group, bucket);
  }
  return Array.from(groups.entries());
}

/** Everything the help overlay lists: movement first, then the registered hotkeys, then the wheel's keys. */
export function helpBindings(registered: readonly HotkeyBinding[] = hotkeys.list()) {
  return [...MOVEMENT_HELP, ...registered, ...PALETTE_HELP, ...SOCIAL_HELP];
}

export function HotkeyList({ bindings = helpBindings() }: { bindings?: readonly HotkeyBinding[] }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {groupBindings(bindings).map(([group, items]) => (
        <section key={group} aria-label={group}>
          <h3
            style={{
              margin: "0 0 6px",
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {group}
          </h3>
          <dl
            style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px" }}
          >
            {items.map((b) => (
              <div key={b.id} style={{ display: "contents" }}>
                <dt>
                  <kbd className="rg-kbd">{keyLabel(b.key)}</kbd>
                </dt>
                <dd style={{ margin: 0 }}>{b.description}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="rg-muted" style={{ margin: 0, fontSize: 12 }}>
        <kbd className="rg-kbd">Esc</kbd> closes any dialog. Shortcuts pause while a dialog is open
        or while typing.
      </p>
    </div>
  );
}
