/**
 * Browser client for notifications (#42): my preferences, my waiting henchmen
 * (tab badge), and, for owners/admins, the team webhook channels. A webhook
 * URL or bot token goes out in one request body; no response carries one.
 */
import {
  type CreateNotificationChannel,
  NOTIFICATION_ATTENTION_API_PATH,
  NOTIFICATION_CHANNELS_API_PATH,
  NOTIFICATION_PREFS_API_PATH,
  NotificationChannelsResponse,
  NotificationChannelView,
  NotificationPrefs,
  NotificationTestResult,
  NotifyAttention,
  notificationChannelPath,
  type UpdateNotificationChannel,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

const NO_CONTENT: Parser<void> = { safeParse: () => ({ success: true, data: undefined }) };

export function createNotificationsApi(options: { fetch?: typeof fetch; baseUrl?: string } = {}) {
  const base = options.baseUrl ?? "";

  async function call<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const doFetch = options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: "network_error" };
    }
    let json: unknown = null;
    if (res.status !== 204) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const b = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      const out: ApiFailure = {
        ok: false,
        status: res.status,
        code: typeof b.error === "string" ? b.error.toLowerCase() : `http_${res.status}`,
      };
      return out;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }

  return {
    prefs: () => call<NotificationPrefs>("GET", NOTIFICATION_PREFS_API_PATH, NotificationPrefs),
    savePrefs: (prefs: NotificationPrefs) =>
      call<NotificationPrefs>("PUT", NOTIFICATION_PREFS_API_PATH, NotificationPrefs, prefs),
    attention: () => call<NotifyAttention>("GET", NOTIFICATION_ATTENTION_API_PATH, NotifyAttention),
    channels: () =>
      call<NotificationChannelsResponse>(
        "GET",
        NOTIFICATION_CHANNELS_API_PATH,
        NotificationChannelsResponse,
      ),
    createChannel: (input: CreateNotificationChannel) =>
      call<NotificationChannelView>(
        "POST",
        NOTIFICATION_CHANNELS_API_PATH,
        NotificationChannelView,
        input,
      ),
    updateChannel: (id: string, patch: UpdateNotificationChannel) =>
      call<NotificationChannelView>(
        "PATCH",
        notificationChannelPath(id),
        NotificationChannelView,
        patch,
      ),
    deleteChannel: (id: string) => call<void>("DELETE", notificationChannelPath(id), NO_CONTENT),
    testChannel: (id: string) =>
      call<NotificationTestResult>(
        "POST",
        notificationChannelPath(id, true),
        NotificationTestResult,
      ),
  };
}

export type NotificationsApi = ReturnType<typeof createNotificationsApi>;

const ERRORS: Record<string, string> = {
  master_key_required: "The server has no OFFICE_MASTER_KEY, so it cannot store webhook secrets.",
  webhook_host_not_allowed:
    "That URL is not a Slack (hooks.slack.com) or Discord (discord.com) webhook.",
  invalid_webhook_url: "That does not look like a webhook URL. Copy it again from the app.",
  invalid_bot_token: "That does not look like a Telegram bot token (123456:ABC…).",
  chat_id_required: "Telegram needs a chat id.",
  too_many_tests: "Wait a few seconds before sending another test.",
  owner_or_admin_required: "Only office owners and admins can change team notifications.",
  invalid_body: "Some fields are missing or invalid.",
  network_error: "The office is not reachable.",
};

export function describeNotificationsError(failure: ApiFailure): string {
  return ERRORS[failure.code] ?? `Something went wrong (${failure.code}).`;
}

const TEST_CODES: Record<string, string> = {
  sent: "Test message sent.",
  http_404: "The provider says this webhook does not exist (404). Was it deleted?",
  http_403: "The provider refused the message (403).",
  http_401: "The provider refused the credentials (401).",
  http_400: "The provider rejected the message (400). Check the chat id.",
  telegram_rejected: "Telegram rejected the message. Is the bot a member of that chat?",
  rate_limited: "The provider is rate limiting this webhook; try again later.",
  timeout: "The provider did not answer in time.",
  network_error: "The office could not reach the provider.",
  undecryptable: "The stored secret cannot be decrypted (master key changed?). Replace it.",
};

export function describeDeliveryCode(code: string): string {
  return TEST_CODES[code] ?? `Delivery failed (${code}).`;
}
