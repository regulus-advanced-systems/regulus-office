/**
 * Add or edit one team webhook channel (#42): kind, name, the webhook URL or
 * bot token (write-only: never prefilled, cleared after submit), Telegram
 * chat id, which floors and which events it gets.
 */
import {
  NOTIFICATION_EVENTS,
  type NotificationChannelView,
  type NotificationEvent,
  WEBHOOK_KINDS,
  type WebhookKind,
} from "@regulus/protocol";
import { useId, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectFloors, useBuildingStore } from "../../state/building.ts";
import { Button } from "../components/Button.tsx";

export const KIND_LABELS: Record<WebhookKind, string> = {
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
};

export const EVENT_SHORT_LABELS: Record<NotificationEvent, string> = {
  needs_input: "Needs input",
  needs_permission: "Needs permission",
  done: "Done",
  error: "Error",
  pr_opened: "PR opened",
  pr_merged: "PR merged",
};

const SETUP_HINTS: Record<WebhookKind, string> = {
  slack:
    "Slack: api.slack.com/apps → Create New App → Incoming Webhooks → on → Add New Webhook to Workspace → pick the channel → copy the https://hooks.slack.com/services/… URL.",
  discord:
    "Discord: channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL (https://discord.com/api/webhooks/…).",
  telegram:
    "Telegram: create a bot with @BotFather (/newbot) and paste its token; add the bot to the group, send /start@<your_bot> there, and use the chat id from https://api.telegram.org/bot<token>/getUpdates (groups start with -100).",
};

export interface ChannelFormValue {
  kind: WebhookKind;
  label: string;
  /** Empty when editing and not replacing the secret. */
  secret: string;
  chatId: string;
  floorIds: string[] | null;
  events: NotificationEvent[];
}

export function ChannelForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: NotificationChannelView;
  busy: boolean;
  onSubmit: (value: ChannelFormValue) => void;
  onCancel: () => void;
}) {
  const floors = useBuildingStore(useShallow(selectFloors));
  const [kind, setKind] = useState<WebhookKind>(initial?.kind ?? "slack");
  const [floorIds, setFloorIds] = useState<string[] | null>(initial?.floorIds ?? null);
  const [events, setEvents] = useState<NotificationEvent[]>(
    initial?.events ?? ["needs_input", "needs_permission", "done", "error", "pr_merged"],
  );
  const secretRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLInputElement>(null);
  const ids = { kind: useId(), label: useId(), secret: useId(), chat: useId() };
  const editing = initial !== undefined;

  const toggle = <T,>(list: T[], item: T, on: boolean) =>
    on ? [...new Set([...list, item])] : list.filter((x) => x !== item);

  const submit = () => {
    const input = secretRef.current;
    const secret = input?.value.trim() ?? "";
    if (input) input.value = "";
    onSubmit({
      kind,
      label: labelRef.current?.value.trim() ?? "",
      secret,
      chatId: chatRef.current?.value.trim() ?? "",
      floorIds,
      events,
    });
  };

  return (
    <div className="rg-notify-form" style={{ display: "grid", gap: 6 }}>
      {!editing && (
        <>
          <label className="rg-field__label" htmlFor={ids.kind}>
            Service
          </label>
          <select
            id={ids.kind}
            className="rg-input"
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as WebhookKind)}
          >
            {WEBHOOK_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </>
      )}
      <div className="rg-field__hint">{SETUP_HINTS[kind]}</div>
      <label className="rg-field__label" htmlFor={ids.label}>
        Name
      </label>
      <input
        id={ids.label}
        className="rg-input"
        ref={labelRef}
        defaultValue={initial?.label ?? ""}
        maxLength={60}
        placeholder="#henchmen"
      />
      <label className="rg-field__label" htmlFor={ids.secret}>
        {kind === "telegram" ? "Bot token" : "Webhook URL"}
      </label>
      <input
        id={ids.secret}
        ref={secretRef}
        className="rg-input"
        type="password"
        autoComplete="off"
        placeholder={editing ? "Leave empty to keep the stored one" : ""}
      />
      {kind === "telegram" && (
        <>
          <label className="rg-field__label" htmlFor={ids.chat}>
            Chat id
          </label>
          <input
            id={ids.chat}
            className="rg-input"
            ref={chatRef}
            defaultValue={initial?.chatId ?? ""}
            placeholder="-1001234567890 or @channel"
          />
        </>
      )}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="rg-field__label">Operations</legend>
        <label>
          <input
            type="checkbox"
            checked={floorIds === null}
            onChange={(e) => setFloorIds(e.currentTarget.checked ? null : [])}
          />{" "}
          All operations
        </label>
        {floorIds !== null &&
          floors.map((f) => (
            <label key={f.floorId} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={floorIds.includes(f.floorId)}
                onChange={(e) => setFloorIds(toggle(floorIds, f.floorId, e.currentTarget.checked))}
              />{" "}
              {f.name}
            </label>
          ))}
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="rg-field__label">Events</legend>
        {NOTIFICATION_EVENTS.map((ev) => (
          <label key={ev} style={{ display: "inline-block", marginRight: 12 }}>
            <input
              type="checkbox"
              checked={events.includes(ev)}
              onChange={(e) => setEvents(toggle(events, ev, e.currentTarget.checked))}
            />{" "}
            {EVENT_SHORT_LABELS[ev]}
          </label>
        ))}
      </fieldset>
      <div className="rg-field__hint">
        Messages name the henchman, its owner, operation, status, task title and PR link. Never
        terminal output or permission details. The URL or token is stored encrypted and never shown
        again.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary" size="sm" disabled={busy} onClick={submit}>
          {editing ? "Save" : "Add channel"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
