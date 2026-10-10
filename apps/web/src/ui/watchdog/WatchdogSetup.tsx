/**
 * What the watchdog watches, for office owners and admins (#253, D30): which
 * agent does the rounds and how often, whether a proposed fix waits for a
 * person, the Sentry organisation, token and projects, and the hosts with
 * their PM2 apps. The Sentry token and the SSH keys are write-only.
 */
import {
  type UpdateWatchdogSettings,
  WATCHDOG_LIMITS,
  type WatchdogHostView,
  type WatchdogSettingsView,
  watchdogIntervalLabel,
} from "@regulus/protocol";
import { useCallback, useEffect, useId, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectOperations, useBuildingStore } from "../../state/building.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Switch } from "../components/Switch.tsx";
import { describeWatchdogError, type WatchdogApi } from "./api.ts";
import { HostCard } from "./HostCard.tsx";
import { HostForm } from "./HostForm.tsx";
import { SentrySetup } from "./SentrySetup.tsx";

const INTERVALS = [15, 30, 60, 120, 240, 720, 1440];
type Editing = { mode: "new" } | { mode: "edit"; host: WatchdogHostView } | null;

export function WatchdogSetup({ api, onChanged }: { api: WatchdogApi; onChanged: () => void }) {
  const operations = useBuildingStore(useShallow(selectOperations));
  const ids = {
    agent: useId(),
    every: useId(),
    model: useId(),
    perRound: useId(),
    perDay: useId(),
  };
  const [settings, setSettings] = useState<WatchdogSettingsView | null>(null);
  const [fixModel, setFixModel] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const take = useCallback((next: WatchdogSettingsView) => {
    setSettings(next);
    setFixModel(next.fixModel);
  }, []);

  const load = useCallback(async () => {
    const res = await api.settings();
    if (!res.ok) return setError(describeWatchdogError(res));
    take(res.data);
  }, [api, take]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (done: string, fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setStatus("");
    const failed = await fn();
    setBusy(false);
    if (failed) return setError(failed);
    setStatus(done);
    onChanged();
  };
  const patch = (done: string, change: UpdateWatchdogSettings) =>
    run(done, async () => {
      const res = await api.updateSettings(change);
      if (!res.ok) return describeWatchdogError(res);
      take(res.data);
      return null;
    });

  if (!settings) {
    return (
      <section className="rg-settings__group" aria-label="Watchdog setup">
        <h3 className="rg-settings__heading">What it watches</h3>
        {error ? <FormAlert>{error}</FormAlert> : <p className="rg-muted">Loading…</p>}
      </section>
    );
  }

  const saveHost = (value: Parameters<WatchdogApi["createHost"]>[0]) =>
    run("Host saved.", async () => {
      const res =
        editing?.mode === "edit"
          ? await api.updateHost(editing.host.id, value)
          : await api.createHost(value);
      if (!res.ok) return describeWatchdogError(res);
      setEditing(null);
      await load();
      return null;
    });
  const removeHost = (host: WatchdogHostView) =>
    // It stays in the list when an app of it is in a room this person cannot see: not watched.
    run(`${host.label} is no longer watched.`, async () => {
      const res = await api.deleteHost(host.id);
      if (!res.ok) return describeWatchdogError(res);
      await load();
      return null;
    });
  const acceptKey = (host: WatchdogHostView) =>
    run(`The new key of ${host.label} is pinned.`, async () => {
      const res = await api.acceptHostKey(host.id);
      if (!res.ok) return describeWatchdogError(res);
      await load();
      return null;
    });
  const roomName = (app: { operationId: string | null; operationHidden: boolean }) =>
    app.operationHidden
      ? "a room you cannot see"
      : app.operationId === null
        ? "no room"
        : (operations.find((o) => o.operationId === app.operationId)?.name ?? "a room");

  return (
    <>
      <section className="rg-settings__group" aria-label="Watchdog duty">
        <h3 className="rg-settings__heading">Duty</h3>
        {!settings.canStore && (
          <FormAlert kind="info">
            The server has no OFFICE_MASTER_KEY, so it cannot store an SSH key or the Sentry token.
          </FormAlert>
        )}
        <label className="rg-field__label" htmlFor={ids.agent}>
          Who does the rounds
        </label>
        <select
          id={ids.agent}
          className="rg-input"
          disabled={busy}
          value={settings.agentId ?? ""}
          onChange={(e) => void patch("Saved.", { agentId: e.target.value || null })}
        >
          <option value="">Nobody</option>
          {settings.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <div className="rg-field__hint">
          A shared agent whose job is Watchdog, made under Agents. An inexpensive model is enough
          for the rounds (DeepSeek Flash); it runs on an office key.
        </div>
        <Switch
          checked={settings.enabled}
          disabled={busy}
          onChange={(enabled) => void patch(enabled ? "On duty." : "Off duty.", { enabled })}
          label="Rounds on a schedule"
          hint="Off: it does a round only when someone asks, here or in chat."
        />
        <label className="rg-field__label" htmlFor={ids.every}>
          How often
        </label>
        <select
          id={ids.every}
          className="rg-input"
          disabled={busy}
          value={settings.intervalMinutes}
          onChange={(e) => void patch("Saved.", { intervalMinutes: Number(e.target.value) })}
        >
          {[...new Set([...INTERVALS, settings.intervalMinutes])]
            .sort((a, b) => a - b)
            .map((m) => (
              <option key={m} value={m}>
                {watchdogIntervalLabel(m)}
              </option>
            ))}
        </select>
        <Switch
          checked={settings.fixMode === "auto"}
          disabled={busy}
          onChange={(auto) =>
            void patch(auto ? "Fixes are started unasked." : "Fixes wait for a person.", {
              fixMode: auto ? "auto" : "ask",
            })
          }
          label="Start fixes without asking"
          hint="Off: a proposed fix waits for a person to read it and agree."
        />
        <div className="rg-field__hint rg-watchdog__warning" role="note">
          {settings.autoFixBy
            ? `On, switched on by ${settings.autoFixBy.displayName}. `
            : "What switching this on means. "}
          A coding henchman runs in {settings.autoFixBy ? "their" : "your"} name, on{" "}
          {settings.autoFixBy ? "their" : "your"} credentials, in rooms where{" "}
          {settings.autoFixBy ? "they" : "you"} may queue work, from what the watchdog read in
          production logs and Sentry. Nobody reads the finding first, and part of a log can be
          written by whoever sends requests to the app. The result is always a draft pull request,
          never a merge.
        </div>
        <div className="rg-settings__row">
          <label className="rg-field__label" htmlFor={ids.perRound}>
            At most per round
          </label>
          <input
            id={ids.perRound}
            className="rg-input rg-watchdog__port"
            type="number"
            min={0}
            max={WATCHDOG_LIMITS.autoFixCapMax}
            disabled={busy}
            value={settings.autoFixPerRound}
            onChange={(e) => void patch("Saved.", { autoFixPerRound: Number(e.target.value) })}
          />
          <label className="rg-field__label" htmlFor={ids.perDay}>
            and per day
          </label>
          <input
            id={ids.perDay}
            className="rg-input rg-watchdog__port"
            type="number"
            min={0}
            max={WATCHDOG_LIMITS.autoFixCapMax}
            disabled={busy}
            value={settings.autoFixPerDay}
            onChange={(e) => void patch("Saved.", { autoFixPerDay: Number(e.target.value) })}
          />
        </div>
        <div className="rg-field__hint">
          Fixes started without asking. Past these, a proposed fix waits for a person.
        </div>
        <label className="rg-field__label" htmlFor={ids.model}>
          Model that writes a fix
        </label>
        <div className="rg-settings__row">
          <select
            className="rg-input rg-watchdog__provider"
            aria-label="Provider that writes a fix"
            disabled={busy}
            value={settings.fixProvider}
            onChange={(e) =>
              void patch("Saved.", { fixProvider: e.target.value as "claude-code" | "codex" })
            }
          >
            <option value="claude-code">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
          <input
            id={ids.model}
            className="rg-input"
            value={fixModel}
            maxLength={100}
            onChange={(e) => setFixModel(e.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !fixModel.trim() || fixModel.trim() === settings.fixModel}
            onClick={() => void patch("Saved.", { fixModel: fixModel.trim() })}
          >
            Save model
          </Button>
        </div>
        <div className="rg-field__hint">
          A stronger model than the rounds need. The henchman runs on the credentials of the person
          in whose name the fix is written.
        </div>
      </section>

      <SentrySetup
        api={api}
        settings={settings}
        operations={operations}
        busy={busy}
        run={run}
        patch={patch}
        take={take}
      />

      <section className="rg-settings__group" aria-label="Watchdog hosts">
        <h3 className="rg-settings__heading">Hosts</h3>
        <div className="rg-field__hint">
          Over SSH, as a read-only user, the watchdog reads PM2's process list and error logs:
          restarts, crash loops and new error lines since its last round.
        </div>
        {settings.hosts.length === 0 && editing === null && (
          <p className="rg-muted">No hosts yet.</p>
        )}
        {settings.hosts.map((host) =>
          editing?.mode === "edit" && editing.host.id === host.id ? (
            <HostForm
              key={host.id}
              initial={host}
              operations={operations}
              busy={busy}
              onSubmit={(v) => void saveHost(v)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <HostCard
              key={host.id}
              host={host}
              busy={busy}
              roomName={roomName}
              onChange={() => setEditing({ mode: "edit", host })}
              onRemove={() => void removeHost(host)}
              onAcceptKey={() => void acceptKey(host)}
            />
          ),
        )}
        {editing?.mode === "new" ? (
          <HostForm
            operations={operations}
            busy={busy}
            onSubmit={(v) => void saveHost(v)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={!settings.canStore || settings.hosts.length >= WATCHDOG_LIMITS.hostsMax}
              onClick={() => setEditing({ mode: "new" })}
            >
              Add a host
            </Button>
          </div>
        )}
        {error && <FormAlert>{error}</FormAlert>}
        <div role="status" aria-live="polite" className="rg-field__hint">
          {status}
        </div>
      </section>
    </>
  );
}
