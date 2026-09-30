/**
 * "Notifications" in Settings (#42): desktop notifications for my own
 * robots (browser permission, one switch per event, quiet hours), for
 * owners/admins other robots' errors, and the team webhooks section.
 */
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationPrefs,
} from "@regulus/protocol";
import { useEffect, useId, useState } from "react";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Switch } from "../components/Switch.tsx";
import {
  createNotificationsApi,
  describeNotificationsError,
  type NotificationsApi,
} from "../notifications/api.ts";
import {
  type DesktopPermission,
  desktopPermission,
  requestDesktopPermission,
} from "../notifications/desktop.ts";
import { useNotificationsStore } from "../notifications/notificationSync.ts";
import { TeamWebhooksSection } from "./TeamWebhooksSection.tsx";

const defaultApi = createNotificationsApi();

export const EVENT_SWITCH_LABELS: Record<NotificationEvent, string> = {
  needs_input: "Needs my input",
  needs_permission: "Asks for permission",
  done: "Done",
  error: "Error",
  pr_opened: "Pull request opened",
  pr_merged: "Pull request merged",
};

function PermissionLine({
  permission,
  onAsk,
}: {
  permission: DesktopPermission;
  onAsk: () => void;
}) {
  if (permission === "unsupported") {
    return (
      <div className="rg-field__hint">
        This browser has no desktop notifications; the tab badge still works.
      </div>
    );
  }
  if (permission === "denied") {
    return (
      <div className="rg-field__hint">
        Desktop notifications are blocked for this site in the browser settings. You get in-app
        toasts and the tab badge.
      </div>
    );
  }
  if (permission === "granted") {
    return <div className="rg-field__hint">Desktop notifications are allowed in this browser.</div>;
  }
  return (
    <div>
      <Button variant="secondary" size="sm" onClick={onAsk}>
        Allow desktop notifications
      </Button>
    </div>
  );
}

export function NotificationsSection({ api = defaultApi }: { api?: NotificationsApi }) {
  const role = useSessionStore((s) => s.user?.role);
  const manager = canManageOffice(role);
  const stored = useNotificationsStore((s) => s.prefs);
  const setStored = useNotificationsStore((s) => s.setPrefs);
  const [permission, setPermission] = useState<DesktopPermission>(desktopPermission);
  const [error, setError] = useState<string | null>(null);
  const ids = { start: useId(), end: useId() };
  const prefs = stored ?? DEFAULT_NOTIFICATION_PREFS;

  useEffect(() => {
    if (stored) return;
    void api.prefs().then((res) => {
      if (res.ok) setStored(res.data);
    });
  }, [api, stored, setStored]);

  const save = async (next: NotificationPrefs) => {
    const previous = prefs;
    setStored(next);
    setError(null);
    const res = await api.savePrefs(next);
    if (res.ok) setStored(res.data);
    else {
      setStored(previous);
      setError(describeNotificationsError(res));
    }
  };
  const setEvent = (event: NotificationEvent, on: boolean) =>
    void save({ ...prefs, desktop: { ...prefs.desktop, [event]: on } });
  const setQuiet = (patch: Partial<NotificationPrefs["quietHours"]>) =>
    void save({ ...prefs, quietHours: { ...prefs.quietHours, ...patch } });

  return (
    <>
      <section className="rg-field" aria-label="Notifications">
        <div className="rg-field__label">Notifications</div>
        <div className="rg-field__hint">
          For your own robots. The tab title shows how many of them wait for you.
        </div>
        <PermissionLine
          permission={permission}
          onAsk={() => void requestDesktopPermission().then(setPermission)}
        />
        {NOTIFICATION_EVENTS.map((event) => (
          <Switch
            key={event}
            checked={prefs.desktop[event]}
            onChange={(on) => setEvent(event, on)}
            label={EVENT_SWITCH_LABELS[event]}
            hint={`When one of your robots ${NOTIFICATION_EVENT_LABELS[event]}.`}
          />
        ))}
        {manager && (
          <Switch
            checked={prefs.adminErrors}
            onChange={(on) => void save({ ...prefs, adminErrors: on })}
            label="Anyone's robot hits an error"
            hint="Owners and admins: also notify me about other people's robots in error."
          />
        )}
        <Switch
          checked={prefs.quietHours.enabled}
          onChange={(on) => setQuiet({ enabled: on })}
          label="Quiet hours"
          hint="No desktop notifications in this window (this computer's time)."
        />
        {prefs.quietHours.enabled && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label htmlFor={ids.start}>From</label>
            <input
              id={ids.start}
              className="rg-input"
              type="time"
              value={prefs.quietHours.start}
              onChange={(e) => e.currentTarget.value && setQuiet({ start: e.currentTarget.value })}
              style={{ width: 120 }}
            />
            <label htmlFor={ids.end}>to</label>
            <input
              id={ids.end}
              className="rg-input"
              type="time"
              value={prefs.quietHours.end}
              onChange={(e) => e.currentTarget.value && setQuiet({ end: e.currentTarget.value })}
              style={{ width: 120 }}
            />
          </div>
        )}
        {error && <FormAlert>{error}</FormAlert>}
      </section>
      {manager && <TeamWebhooksSection api={api} />}
    </>
  );
}
