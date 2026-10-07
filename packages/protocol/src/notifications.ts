/**
 * Notifications (SPEC §10 Ops, D15; issue #42).
 *
 * Personal: a human's own henchmen raise desktop notifications and the tab
 * badge. The server pushes `notify.event` / `notify.attention` BuildingRoom
 * messages to that human's clients only (admins may opt in to other henchmen's
 * errors). Preferences are per user, stored by the office.
 *
 * Team: owners and admins route events to Slack, Discord or Telegram.
 * Webhook URLs and bot tokens are write-only: a request may carry one, no
 * response ever does. Messages carry only henchman name, owner, operation, status,
 * task title and PR links; never terminal output or permission details.
 */
import { z } from "zod";
import { Id, TimestampMs } from "./common.ts";
import { PROVIDER_IDS, type ProviderId } from "./enums.ts";

export const NOTIFICATION_EVENTS = [
  "needs_input",
  "needs_permission",
  "done",
  "error",
  "pr_opened",
  "pr_merged",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const NotificationEventSchema = z.enum(NOTIFICATION_EVENTS);

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  needs_input: "needs your input",
  needs_permission: "asks for permission",
  done: "is done",
  error: "hit an error",
  pr_opened: "opened a pull request",
  pr_merged: "got its pull request merged",
};

export const WEBHOOK_KINDS = ["slack", "discord", "telegram"] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

const PROVIDER_NAMES: Record<ProviderId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  opencode: "OpenCode",
  "kimi-code": "Kimi Code",
  custom: "Custom",
};

/**
 * How notifications and the usage wall name a henchman: its own name (#256) with
 * whose it is, "Gasket, Ada's Codex henchman"; without a name, "Ada's Codex henchman".
 */
export function henchmanDisplayName(ownerName: string, provider: ProviderId, name = ""): string {
  const who = ownerName.trim() || "Someone";
  const whose = `${who}'s ${PROVIDER_NAMES[provider] ?? "henchman"} henchman`;
  return name.trim() ? `${name.trim()}, ${whose}` : whose;
}

// ---- Personal notifications ------------------------------------------------

/** BuildingRoom server→client: one event about a henchman, sent to its owner (or opted-in admins). */
export const NOTIFY_EVENT_MESSAGE = "notify.event";
/** BuildingRoom server→client: the recipient's own henchmen that are waiting for them now. */
export const NOTIFY_ATTENTION_MESSAGE = "notify.attention";

export const NotifyEvent = z.object({
  id: z.string().min(1).max(128),
  event: NotificationEventSchema,
  agentId: Id,
  operationId: Id,
  operationName: z.string().max(100),
  henchmanName: z.string().max(120),
  ownerName: z.string().max(64),
  provider: z.enum(PROVIDER_IDS),
  taskTitle: z.string().max(200),
  prNumber: z.number().int().nonnegative(),
  prUrl: z.string().max(400),
  /** True when the recipient owns the henchman; false for an admin's emergency notice. */
  own: z.boolean(),
  ts: TimestampMs,
});
export type NotifyEvent = z.infer<typeof NotifyEvent>;

export const NotifyAttention = z.object({
  agentIds: z.array(Id).max(500),
});
export type NotifyAttention = z.infer<typeof NotifyAttention>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

export const NotificationPrefs = z.object({
  /** Desktop notification per event type (the tab badge is always on). */
  desktop: z.object({
    needs_input: z.boolean(),
    needs_permission: z.boolean(),
    done: z.boolean(),
    error: z.boolean(),
    pr_opened: z.boolean(),
    pr_merged: z.boolean(),
  }),
  /** Owners/admins only: also notify when anyone's henchman hits an error. */
  adminErrors: z.boolean(),
  /** Silence desktop notifications between `start` and `end` (browser local time). */
  quietHours: z.object({ enabled: z.boolean(), start: HHMM, end: HHMM }),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  desktop: {
    needs_input: true,
    needs_permission: true,
    done: true,
    error: true,
    pr_opened: false,
    pr_merged: true,
  },
  adminErrors: false,
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
};

// ---- Team webhooks (owners/admins) -----------------------------------------

export const NOTIFICATIONS_API_PATH = "/api/notifications";
export const NOTIFICATION_PREFS_API_PATH = `${NOTIFICATIONS_API_PATH}/prefs`;
export const NOTIFICATION_CHANNELS_API_PATH = `${NOTIFICATIONS_API_PATH}/channels`;
/** GET: `NotifyAttention` for the signed-in human (the tab badge on (re)connect). */
export const NOTIFICATION_ATTENTION_API_PATH = `${NOTIFICATIONS_API_PATH}/attention`;
/** `${NOTIFICATION_CHANNELS_API_PATH}/:id` (PATCH, DELETE) and `/:id/test` (POST). */
export const notificationChannelPath = (id: string, test = false) =>
  `${NOTIFICATION_CHANNELS_API_PATH}/${encodeURIComponent(id)}${test ? "/test" : ""}`;

const Label = z.string().trim().min(1).max(60);
const Events = z.array(NotificationEventSchema).max(NOTIFICATION_EVENTS.length);
/** null = every operation. */
const OperationIds = z.array(Id).max(200).nullable();
/** Numeric chat id (`-100…` for groups/channels) or `@channelusername`. */
export const TelegramChatId = z
  .string()
  .trim()
  .regex(/^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/, "chat id or @channel");
/** A webhook URL (Slack, Discord) or a Telegram bot token. Write-only. */
const Secret = z.string().trim().min(8).max(500);

export const CreateNotificationChannel = z.object({
  kind: z.enum(WEBHOOK_KINDS),
  label: Label,
  secret: Secret,
  chatId: TelegramChatId.optional(),
  operationIds: OperationIds,
  events: Events,
  enabled: z.boolean().default(true),
});
export type CreateNotificationChannel = z.input<typeof CreateNotificationChannel>;

export const UpdateNotificationChannel = z.object({
  label: Label.optional(),
  /** Replace the stored URL / token. */
  secret: Secret.optional(),
  chatId: TelegramChatId.optional(),
  operationIds: OperationIds.optional(),
  events: Events.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateNotificationChannel = z.infer<typeof UpdateNotificationChannel>;

export const NotificationChannelView = z.object({
  id: Id,
  kind: z.enum(WEBHOOK_KINDS),
  label: z.string().max(60),
  /** Telegram only; not a secret. */
  chatId: z.string().max(40).nullable(),
  operationIds: z.array(Id).nullable(),
  events: z.array(NotificationEventSchema),
  enabled: z.boolean(),
  lastDelivery: z.object({ at: TimestampMs, ok: z.boolean(), code: z.string().max(40) }).nullable(),
  createdAt: TimestampMs,
});
export type NotificationChannelView = z.infer<typeof NotificationChannelView>;

export const NotificationChannelsResponse = z.object({
  channels: z.array(NotificationChannelView),
  /** False without OFFICE_MASTER_KEY: webhook secrets cannot be stored. */
  canStore: z.boolean(),
});
export type NotificationChannelsResponse = z.infer<typeof NotificationChannelsResponse>;

export const NotificationTestResult = z.object({
  ok: z.boolean(),
  /** `sent`, or a short error code such as `http_404`, `timeout`, `rate_limited`. */
  code: z.string().max(40),
});
export type NotificationTestResult = z.infer<typeof NotificationTestResult>;
