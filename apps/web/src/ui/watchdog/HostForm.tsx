/**
 * A host the watchdog reads over SSH (#253, D30): where it is, the read-only
 * user, that user's private key, and the PM2 apps to watch on it with the
 * room each belongs to. The private key is write-only: it is typed or pasted
 * here once and never shown again; leaving it empty on a change keeps the
 * stored one. Pointing the stored key at something new (another app, another
 * address) is for the office owner, or needs the key again; the office says
 * so when it refuses. Another address is another machine: its public key can
 * be given with the change.
 */
import {
  type OperationSummary,
  type SaveWatchdogHost,
  WATCHDOG_LIMITS,
  type WatchdogHostView,
} from "@regulus/protocol";
import { useId, useState } from "react";
import { Button } from "../components/Button.tsx";
import { type RoomChoice, RoomSelect, roomChoice } from "./RoomSelect.tsx";

interface AppRow {
  key: number;
  name: string;
  room: RoomChoice;
}

export interface HostFormProps {
  initial?: WatchdogHostView;
  operations: readonly Pick<OperationSummary, "operationId" | "name">[];
  busy: boolean;
  onSubmit: (value: SaveWatchdogHost) => void;
  onCancel: () => void;
}

let nextKey = 1;

export function HostForm({ initial, operations, busy, onSubmit, onCancel }: HostFormProps) {
  const ids = {
    label: useId(),
    host: useId(),
    port: useId(),
    user: useId(),
    hostKey: useId(),
    key: useId(),
  };
  const [label, setLabel] = useState(initial?.label ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [hostKey, setHostKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [apps, setApps] = useState<AppRow[]>(
    () =>
      initial?.apps
        .filter((a) => a.watched)
        .map((a) => ({ key: nextKey++, name: a.name, room: roomChoice(a) })) ?? [
        { key: nextKey++, name: "", room: null },
      ],
  );
  const notWatched = initial?.apps.filter((a) => !a.watched).map((a) => a.name) ?? [];
  const moved =
    initial !== undefined &&
    (host.trim() !== initial.host || (Number(port) || 22) !== initial.port);
  const setApp = (key: number, patch: Partial<AppRow>) =>
    setApps((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const submit = () => {
    onSubmit({
      label: label.trim(),
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      ...(initial && !moved ? {} : { hostKey: hostKey.trim() }),
      ...(privateKey.trim() ? { privateKey } : {}),
      apps: apps
        .filter((a) => a.name.trim())
        .map((a) => ({
          name: a.name.trim(),
          ...(a.room === undefined ? {} : { operationId: a.room }),
        })),
    });
  };

  return (
    <form
      className="rg-watchdog-form"
      aria-label={initial ? `Change host ${initial.label}` : "New host"}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="rg-field__label" htmlFor={ids.label}>
        Name
      </label>
      <input
        id={ids.label}
        className="rg-input"
        value={label}
        maxLength={60}
        placeholder="prod-1"
        onChange={(e) => setLabel(e.target.value)}
        required
      />
      <div className="rg-settings__row">
        <div className="rg-settings__grow">
          <label className="rg-field__label" htmlFor={ids.host}>
            Address
          </label>
          <input
            id={ids.host}
            className="rg-input"
            value={host}
            placeholder="vps.example.com"
            onChange={(e) => setHost(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="rg-field__label" htmlFor={ids.port}>
            Port
          </label>
          <input
            id={ids.port}
            className="rg-input rg-watchdog__port"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
      </div>
      <label className="rg-field__label" htmlFor={ids.user}>
        Read-only user
      </label>
      <input
        id={ids.user}
        className="rg-input"
        value={username}
        placeholder="watchdog"
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <div className="rg-field__hint">
        A user made for this, who can run <code>pm2 jlist</code> and <code>pm2 logs</code> and
        nothing else. The watchdog runs only those two commands and never restarts or changes
        anything.
      </div>
      <label className="rg-field__label" htmlFor={ids.key}>
        That user's SSH private key
      </label>
      <textarea
        id={ids.key}
        className="rg-input rg-watchdog__key"
        rows={3}
        value={privateKey}
        maxLength={WATCHDOG_LIMITS.privateKeyMax}
        autoComplete="off"
        spellCheck={false}
        placeholder={
          initial?.hasKey
            ? "A key is stored. Leave empty to keep it."
            : "-----BEGIN OPENSSH PRIVATE KEY-----"
        }
        onChange={(e) => setPrivateKey(e.target.value)}
        required={!initial}
      />
      <div className="rg-field__hint">
        Stored encrypted by the office and never shown again. Use a key made only for this.
        {initial &&
          " Adding an app or changing the address uses the stored key: unless you own the office, paste the key again to do that."}
      </div>
      {initial && !moved ? (
        <div className="rg-field__hint">
          {initial.pinned.length > 0
            ? "The host's key is pinned. Saving does not change it; if the host shows another key, its check fails until an admin accepts the new one. Another address or port is another machine with a key of its own."
            : "The host's key is not yet verified: the one it shows on first contact will be trusted and stored."}
        </div>
      ) : (
        <>
          <label className="rg-field__label" htmlFor={ids.hostKey}>
            {moved ? "The new machine's public key (optional)" : "The host's public key (optional)"}
          </label>
          <textarea
            id={ids.hostKey}
            className="rg-input rg-watchdog__key"
            rows={2}
            value={hostKey}
            maxLength={WATCHDOG_LIMITS.hostKeyMax}
            spellCheck={false}
            placeholder="vps.example.com ssh-ed25519 AAAA…"
            onChange={(e) => setHostKey(e.target.value)}
          />
          <div className="rg-field__hint">
            As <code>ssh-keyscan</code> prints it. With it the watchdog talks to this host only.
            Without it, the key the host shows the first time is stored and the host is held to that
            one from then on.
          </div>
        </>
      )}
      <fieldset className="rg-watchdog-form__apps">
        <legend className="rg-field__label">PM2 apps to watch</legend>
        {apps.map((app, i) => (
          <div key={app.key} className="rg-settings__row">
            <input
              className="rg-input"
              aria-label={`App ${i + 1} name`}
              value={app.name}
              placeholder="api"
              onChange={(e) => setApp(app.key, { name: e.target.value })}
            />
            <RoomSelect
              label={`Room of app ${i + 1}`}
              value={app.room}
              operations={operations}
              onChange={(room) => setApp(app.key, { room })}
            />
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Remove app ${i + 1}`}
              onClick={() => setApps((rows) => rows.filter((row) => row.key !== app.key))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={apps.length >= WATCHDOG_LIMITS.appsPerHostMax}
            onClick={() => setApps((rows) => [...rows, { key: nextKey++, name: "", room: null }])}
          >
            Add an app
          </Button>
        </div>
        <div className="rg-field__hint">
          A finding shows to the people who can see the app's room, and a fix goes to that room's
          repo. An app without a room shows to office owners and admins only.
        </div>
        {notWatched.length > 0 && (
          <div className="rg-field__hint">
            Kept but not watched: {notWatched.join(", ")}. Whoever stopped watching it could not see
            its room; only someone who can see that room can watch it again or remove it for good.
          </div>
        )}
      </fieldset>
      <div className="rg-settings__actions">
        <Button type="submit" size="sm" disabled={busy}>
          {initial ? "Save host" : "Add host"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
