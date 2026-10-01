/**
 * Message bodies for each webhook kind (#42). Only robot name, owner, floor,
 * status, task title and PR link go out. Every value that a human typed
 * (task title, floor name, display name) is escaped for the target format so
 * it cannot mention @everyone, forge links or break the layout.
 *
 * - Slack incoming webhooks: `{ text }`, mrkdwn; `&`, `<`, `>` must be
 *   escaped (docs.slack.dev/messaging/formatting-message-text#escaping).
 * - Discord execute webhook: `{ content, allowed_mentions }`, content ≤ 2000
 *   chars; `allowed_mentions: { parse: [] }` keeps user text from pinging
 *   anyone (docs.discord.com/developers/resources/webhook#execute-webhook).
 * - Telegram sendMessage: plain text (no `parse_mode`), ≤ 4096 chars, link
 *   previews off (core.telegram.org/bots/api#sendmessage).
 */
import { NOTIFICATION_EVENT_LABELS, type WebhookKind } from "@regulus/protocol";
import type { RobotNotice } from "./events.ts";

const TITLE_MAX = 200;

/** Collapse whitespace/control characters: one line per field. */
function oneLine(text: string, max = TITLE_MAX): string {
  const flat = text.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function escapeSlack(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeDiscord(text: string): string {
  // Markdown and mention characters; allowed_mentions is the real mention guard.
  return text.replace(/([\\*_~`|>#[\]])/g, "\\$1");
}

interface Parts {
  headline: string;
  lines: string[];
}

function parts(n: RobotNotice, esc: (s: string) => string): Parts {
  const headline = `${esc(oneLine(n.robotName, 120))} ${NOTIFICATION_EVENT_LABELS[n.event]}`;
  const lines = [
    `Operation: ${esc(oneLine(n.floorName, 100))}`,
    `Owner: ${esc(oneLine(n.ownerName, 64))}`,
  ];
  if (n.taskTitle.trim()) lines.push(`Task: ${esc(oneLine(n.taskTitle))}`);
  return { headline, lines };
}

export type WebhookBody = Record<string, unknown>;

export function slackBody(n: RobotNotice): WebhookBody {
  const { headline, lines } = parts(n, escapeSlack);
  if (n.prUrl) lines.push(`<${escapeSlack(n.prUrl)}|Pull request #${n.prNumber}>`);
  return {
    text: [`*${headline}*`, ...lines].join("\n"),
    unfurl_links: false,
    unfurl_media: false,
  };
}

export function discordBody(n: RobotNotice): WebhookBody {
  const { headline, lines } = parts(n, escapeDiscord);
  // <url> suppresses the embed.
  if (n.prUrl) lines.push(`Pull request #${n.prNumber}: <${n.prUrl}>`);
  return {
    content: [`**${headline}**`, ...lines].join("\n").slice(0, 2000),
    allowed_mentions: { parse: [] },
  };
}

export function telegramBody(n: RobotNotice, chatId: string): WebhookBody {
  const { headline, lines } = parts(n, (s) => s);
  if (n.prUrl) lines.push(`Pull request #${n.prNumber}: ${n.prUrl}`);
  return {
    chat_id: chatId,
    text: [headline, ...lines].join("\n").slice(0, 4096),
    link_preview_options: { is_disabled: true },
  };
}

export function webhookBody(kind: WebhookKind, n: RobotNotice, chatId: string | null): WebhookBody {
  switch (kind) {
    case "slack":
      return slackBody(n);
    case "discord":
      return discordBody(n);
    case "telegram":
      return telegramBody(n, chatId ?? "");
  }
}

/** The "Send test" message: fixed text, no robot data. */
export function testNotice(now: number): RobotNotice {
  return {
    id: `test-${now}`,
    event: "done",
    agentId: "test",
    floorId: "test",
    floorName: "Test operation",
    ownerUserId: "test",
    ownerName: "Regulus Office",
    robotName: "Test henchman",
    provider: "custom",
    taskTitle: "Checking that this channel receives office notifications",
    prNumber: 0,
    prUrl: "",
    ts: now,
  };
}
