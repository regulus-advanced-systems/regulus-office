/**
 * Sentry in the watchdog's setup, for office owners and admins (#253, D30):
 * the organisation, the host, the access token (write-only: typed once, never
 * shown again) and the projects to watch, each with the room it belongs to.
 */
import {
  type OperationSummary,
  type UpdateWatchdogSettings,
  WATCHDOG_LIMITS,
  type WatchdogSettingsView,
} from "@regulus/protocol";
import { useEffect, useId, useState } from "react";
import { Button } from "../components/Button.tsx";
import { describeWatchdogError, type WatchdogApi } from "./api.ts";
import { type RoomChoice, RoomSelect, roomChoice } from "./RoomSelect.tsx";

interface ProjectRow {
  key: number;
  slug: string;
  room: RoomChoice;
}
let nextKey = 1;

export interface SentrySetupProps {
  api: WatchdogApi;
  settings: WatchdogSettingsView;
  operations: readonly Pick<OperationSummary, "operationId" | "name">[];
  busy: boolean;
  /** Run a change: busy, the error or the status line, and the report's reload are the parent's. */
  run: (done: string, fn: () => Promise<string | null>) => Promise<void>;
  patch: (done: string, change: UpdateWatchdogSettings) => Promise<void>;
  /** The settings as the server has them after a change. */
  take: (next: WatchdogSettingsView) => void;
}

export function SentrySetup(props: SentrySetupProps) {
  const { api, settings, operations, busy, run, patch, take } = props;
  const ids = { org: useId(), host: useId(), token: useId() };
  const [organization, setOrganization] = useState(settings.sentry.organization);
  const [sentryHost, setSentryHost] = useState(settings.sentry.host);
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  // What the server has now replaces what was typed, and the token field is emptied.
  useEffect(() => {
    setOrganization(settings.sentry.organization);
    setSentryHost(settings.sentry.host);
    setToken("");
    setProjects(
      settings.sentry.projects
        .filter((p) => p.watched)
        .map((p) => ({ key: nextKey++, slug: p.slug, room: roomChoice(p) })),
    );
  }, [settings]);
  const notWatched = settings.sentry.projects.filter((p) => !p.watched).map((p) => p.slug);

  const saveSentry = () =>
    run("Sentry saved.", async () => {
      const first = await api.updateSettings({
        sentryOrganization: organization.trim(),
        sentryHost: sentryHost.trim() || "sentry.io",
        ...(token.trim() ? { sentryToken: token.trim() } : {}),
      });
      if (!first.ok) return describeWatchdogError(first);
      const res = await api.setSentryProjects({
        projects: projects
          .filter((p) => p.slug.trim())
          .map((p) => ({
            slug: p.slug.trim(),
            ...(p.room === undefined ? {} : { operationId: p.room }),
          })),
        // With the token typed again, an admin may add a project (the office checks).
        ...(token.trim() ? { sentryToken: token.trim() } : {}),
      });
      if (!res.ok) return describeWatchdogError(res);
      take(res.data);
      return null;
    });

  return (
    <section className="rg-settings__group" aria-label="Watchdog Sentry">
      <h3 className="rg-settings__heading">Sentry</h3>
      <div className="rg-field__hint">
        The office reads the new and regressed issues of the projects below over Sentry's API and
        hands them to the watchdog to judge. It comments its verdict on an issue and never resolves
        one. Changing the host removes the stored token.
      </div>
      <div className="rg-settings__row">
        <div className="rg-settings__grow">
          <label className="rg-field__label" htmlFor={ids.org}>
            Organisation slug
          </label>
          <input
            id={ids.org}
            className="rg-input"
            value={organization}
            placeholder="acme"
            onChange={(e) => setOrganization(e.target.value)}
          />
        </div>
        <div className="rg-settings__grow">
          <label className="rg-field__label" htmlFor={ids.host}>
            Sentry host
          </label>
          <input
            id={ids.host}
            className="rg-input"
            value={sentryHost}
            placeholder="sentry.io"
            onChange={(e) => setSentryHost(e.target.value)}
          />
        </div>
      </div>
      <label className="rg-field__label" htmlFor={ids.token}>
        Access token
      </label>
      <div className="rg-settings__row">
        <input
          id={ids.token}
          className="rg-input"
          type="password"
          autoComplete="off"
          value={token}
          maxLength={WATCHDOG_LIMITS.tokenMax}
          placeholder={
            settings.sentry.hasToken
              ? "A token is stored. Type a new one to replace it."
              : "sntryu_…"
          }
          onChange={(e) => setToken(e.target.value)}
        />
        {settings.sentry.hasToken && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void patch("The token was removed.", { sentryToken: null })}
          >
            Remove token
          </Button>
        )}
      </div>
      <div className="rg-field__hint">
        A token that can read issues and events and write comments (event:read, event:write). Stored
        encrypted and never shown again.
        {settings.sentry.hasToken &&
          " Adding a project or changing the organisation uses the stored token: unless you own the office, type the token again to do that."}
      </div>
      <fieldset className="rg-watchdog-form__apps">
        <legend className="rg-field__label">Projects to watch</legend>
        {projects.map((project, i) => (
          <div key={project.key} className="rg-settings__row">
            <input
              className="rg-input"
              aria-label={`Project ${i + 1} slug`}
              value={project.slug}
              placeholder="web"
              onChange={(e) =>
                setProjects((rows) =>
                  rows.map((r) => (r.key === project.key ? { ...r, slug: e.target.value } : r)),
                )
              }
            />
            <RoomSelect
              label={`Room of project ${i + 1}`}
              value={project.room}
              operations={operations}
              onChange={(room) =>
                setProjects((rows) => rows.map((r) => (r.key === project.key ? { ...r, room } : r)))
              }
            />
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Remove project ${i + 1}`}
              onClick={() => setProjects((rows) => rows.filter((r) => r.key !== project.key))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setProjects((rows) => [...rows, { key: nextKey++, slug: "", room: null }])
            }
          >
            Add a project
          </Button>
        </div>
        {notWatched.length > 0 && (
          <div className="rg-field__hint">
            Kept but not watched: {notWatched.join(", ")}. Whoever stopped watching it could not see
            its room; only someone who can see that room can watch it again or remove it for good.
          </div>
        )}
      </fieldset>
      <div className="rg-settings__actions">
        <Button size="sm" disabled={busy} onClick={() => void saveSentry()}>
          Save Sentry
        </Button>
      </div>
    </section>
  );
}
