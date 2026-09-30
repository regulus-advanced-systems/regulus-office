/**
 * One HTTP delivery to Slack, Discord or Telegram (#42). The webhook URL or
 * bot token is a secret: it is only put into the request URL here, never into
 * a log line, an error, a stored status or a response. Results are short
 * codes (`sent`, `http_404`, `timeout`, …), never provider response text.
 *
 * Provider docs:
 * - Slack incoming webhooks: POST JSON to `https://hooks.slack.com/services/…`;
 *   200 `ok`; 1 message/s per webhook, 429 with `Retry-After` seconds
 *   (docs.slack.dev/messaging/sending-messages-using-incoming-webhooks,
 *   docs.slack.dev/apis/web-api/rate-limits).
 * - Discord: POST `https://discord.com/api/webhooks/{id}/{token}`; 204
 *   (or 200 with `?wait=true`); 429 with `Retry-After` / `retry_after`
 *   (docs.discord.com/developers/resources/webhook#execute-webhook,
 *   docs.discord.com/developers/topics/rate-limits).
 * - Telegram: POST `https://api.telegram.org/bot<token>/sendMessage`; JSON
 *   `{ ok, error_code, parameters: { retry_after } }`
 *   (core.telegram.org/bots/api#making-requests, #sendmessage).
 */
import type { WebhookKind } from "@regulus/protocol";
import type { WebhookBody } from "./format.ts";

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface SenderPolicy {
  /** Hosts a Slack webhook URL may point at. */
  slackHosts: readonly string[];
  /** Hosts a Discord webhook URL may point at. */
  discordHosts: readonly string[];
  /** Base URL of the Telegram Bot API. */
  telegramApiBase: string;
  /** Allow plain http URLs (tests with local fake servers only). */
  allowHttp: boolean;
  fetch: FetchFn;
  timeoutMs: number;
}

export const DEFAULT_SENDER_POLICY: SenderPolicy = {
  slackHosts: ["hooks.slack.com"],
  discordHosts: ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"],
  telegramApiBase: "https://api.telegram.org",
  allowHttp: false,
  fetch: (input, init) => fetch(input, init),
  timeoutMs: 10_000,
};

export interface ChannelTarget {
  kind: WebhookKind;
  /** Webhook URL (Slack, Discord) or bot token (Telegram). */
  secret: string;
  chatId: string | null;
}

export interface SendResult {
  ok: boolean;
  code: string;
  /** Worth trying again (network, 5xx, 429). */
  retryable: boolean;
  /** What the provider asked us to wait, when it said. */
  retryAfterMs?: number;
}

const TELEGRAM_TOKEN = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/;

/**
 * Is this secret shaped right for its kind? Returns an error code or null.
 * Restricting hosts keeps an admin-entered URL from turning the office into
 * a request proxy for arbitrary addresses.
 */
export function validateSecret(
  kind: WebhookKind,
  secret: string,
  policy: Pick<SenderPolicy, "slackHosts" | "discordHosts" | "allowHttp">,
): string | null {
  if (kind === "telegram") return TELEGRAM_TOKEN.test(secret) ? null : "invalid_bot_token";
  let url: URL;
  try {
    url = new URL(secret);
  } catch {
    return "invalid_webhook_url";
  }
  const httpOk = url.protocol === "https:" || (policy.allowHttp && url.protocol === "http:");
  if (!httpOk || url.username || url.password) return "invalid_webhook_url";
  const hosts = kind === "slack" ? policy.slackHosts : policy.discordHosts;
  if (!hosts.includes(url.host)) return "webhook_host_not_allowed";
  const path = kind === "slack" ? /^\/services\/[\w/-]+$/ : /^\/api\/webhooks\/\d+\/[\w-]+$/;
  if (!path.test(url.pathname)) return "invalid_webhook_url";
  return null;
}

function targetUrl(target: ChannelTarget, policy: SenderPolicy): string {
  if (target.kind === "telegram") {
    return `${policy.telegramApiBase.replace(/\/+$/, "")}/bot${target.secret}/sendMessage`;
  }
  return target.secret;
}

function retryAfterHeader(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined;
}

async function smallJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await res.text();
    if (text.length > 8192) return null;
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Read the provider's own "retry after" from a 429 body (Discord seconds, Telegram seconds). */
function retryAfterBody(
  kind: WebhookKind,
  body: Record<string, unknown> | null,
): number | undefined {
  if (!body) return undefined;
  const raw =
    kind === "telegram"
      ? (body.parameters as { retry_after?: unknown } | undefined)?.retry_after
      : body.retry_after;
  return typeof raw === "number" && raw >= 0 ? raw * 1000 : undefined;
}

export async function sendWebhook(
  target: ChannelTarget,
  body: WebhookBody,
  policy: SenderPolicy,
): Promise<SendResult> {
  const invalid = validateSecret(target.kind, target.secret, policy);
  if (invalid) return { ok: false, code: invalid, retryable: false };
  if (target.kind === "telegram" && !target.chatId) {
    return { ok: false, code: "missing_chat_id", retryable: false };
  }
  let res: Response;
  try {
    res = await policy.fetch(targetUrl(target, policy), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(policy.timeoutMs),
    });
  } catch (err) {
    const name = (err as { name?: unknown } | null)?.name;
    const code = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error";
    return { ok: false, code, retryable: true };
  }
  let json: Record<string, unknown> | null = null;
  if (target.kind === "slack") await res.body?.cancel().catch(() => {});
  else json = await smallJson(res);
  if (res.status === 429) {
    return {
      ok: false,
      code: "rate_limited",
      retryable: true,
      retryAfterMs: retryAfterHeader(res) ?? retryAfterBody(target.kind, json),
    };
  }
  if (res.status >= 200 && res.status < 300) {
    if (target.kind === "telegram" && json?.ok !== true) {
      return { ok: false, code: "telegram_rejected", retryable: false };
    }
    return { ok: true, code: "sent", retryable: false };
  }
  return { ok: false, code: `http_${res.status}`, retryable: res.status >= 500 };
}
