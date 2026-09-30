/**
 * "Team notifications" in Settings, for owners and admins (#42): Slack,
 * Discord and Telegram channels with per-floor routing and per-event
 * toggles, a "Send test" button, and the last delivery result. Webhook URLs
 * and bot tokens are write-only.
 */
import type { NotificationChannelView } from "@regulus/protocol";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectFloors, useBuildingStore } from "../../state/building.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Switch } from "../components/Switch.tsx";
import {
  describeDeliveryCode,
  describeNotificationsError,
  type NotificationsApi,
} from "../notifications/api.ts";
import {
  ChannelForm,
  type ChannelFormValue,
  EVENT_SHORT_LABELS,
  KIND_LABELS,
} from "../notifications/ChannelForm.tsx";

type Editing = { mode: "new" } | { mode: "edit"; channel: NotificationChannelView } | null;

export function TeamWebhooksSection({ api }: { api: NotificationsApi }) {
  const floors = useBuildingStore(useShallow(selectFloors));
  const [channels, setChannels] = useState<NotificationChannelView[] | null>(null);
  const [canStore, setCanStore] = useState(true);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await api.channels();
    if (!res.ok) return setError(describeNotificationsError(res));
    setChannels(res.data.channels);
    setCanStore(res.data.canStore);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const submit = (value: ChannelFormValue) =>
    run(async () => {
      const common = {
        label: value.label,
        floorIds: value.floorIds,
        events: value.events,
        ...(value.kind === "telegram" && value.chatId ? { chatId: value.chatId } : {}),
      };
      const res =
        editing?.mode === "edit"
          ? await api.updateChannel(editing.channel.id, {
              ...common,
              ...(value.secret ? { secret: value.secret } : {}),
            })
          : await api.createChannel({ kind: value.kind, secret: value.secret, ...common });
      if (!res.ok) return setError(describeNotificationsError(res));
      setEditing(null);
      await load();
    });

  const test = (channel: NotificationChannelView) =>
    run(async () => {
      const res = await api.testChannel(channel.id);
      if (!res.ok) return setError(describeNotificationsError(res));
      setNotice({
        ok: res.data.ok,
        text: `${channel.label}: ${describeDeliveryCode(res.data.code)}`,
      });
      await load();
    });

  const setEnabled = (channel: NotificationChannelView, enabled: boolean) =>
    run(async () => {
      const res = await api.updateChannel(channel.id, { enabled });
      if (!res.ok) return setError(describeNotificationsError(res));
      await load();
    });

  const remove = (channel: NotificationChannelView) =>
    run(async () => {
      const res = await api.deleteChannel(channel.id);
      if (!res.ok) return setError(describeNotificationsError(res));
      await load();
    });

  const floorNames = (ids: string[] | null) =>
    ids === null
      ? "All floors"
      : ids.map((id) => floors.find((f) => f.floorId === id)?.name ?? "removed floor").join(", ") ||
        "No floors";

  return (
    <section className="rg-field" aria-label="Team notifications">
      <div className="rg-field__label">Team notifications</div>
      <div className="rg-field__hint">
        Post robot events to Slack, Discord or Telegram. Events wait 5 s to settle, repeats are
        deduplicated, and each channel is rate limited.
      </div>
      {!canStore && (
        <FormAlert kind="info">
          The server has no OFFICE_MASTER_KEY, so it cannot store webhook secrets.
        </FormAlert>
      )}
      {channels?.length === 0 && <div>No channels yet.</div>}
      {channels?.map((c) =>
        editing?.mode === "edit" && editing.channel.id === c.id ? (
          <ChannelForm
            key={c.id}
            initial={c}
            busy={busy}
            onSubmit={(v) => void submit(v)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div
            key={c.id}
            className="rg-notify-channel"
            style={{ borderTop: "1px solid #ddd", paddingTop: 6 }}
          >
            <Switch
              checked={c.enabled}
              disabled={busy}
              onChange={(on) => void setEnabled(c, on)}
              label={`${KIND_LABELS[c.kind]}: ${c.label}`}
              hint={`${floorNames(c.floorIds)} · ${c.events.map((e) => EVENT_SHORT_LABELS[e]).join(", ") || "no events"}`}
            />
            {c.lastDelivery && (
              <div className="rg-field__hint">
                Last delivery {new Date(c.lastDelivery.at).toLocaleString()}:{" "}
                {c.lastDelivery.ok ? "sent" : describeDeliveryCode(c.lastDelivery.code)}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void test(c)}>
                Send test
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setEditing({ mode: "edit", channel: c })}
              >
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void remove(c)}
              >
                Delete
              </Button>
            </div>
          </div>
        ),
      )}
      {editing?.mode === "new" ? (
        <ChannelForm
          busy={busy}
          onSubmit={(v) => void submit(v)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        canStore && (
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setEditing({ mode: "new" })}
            >
              Add channel…
            </Button>
          </div>
        )
      )}
      {notice && <FormAlert kind={notice.ok ? "info" : "error"}>{notice.text}</FormAlert>}
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}
