import { describe, expect, test } from "bun:test";
import type { RobotNotice } from "./events.ts";
import { discordBody, escapeSlack, slackBody, telegramBody, webhookBody } from "./format.ts";

const notice = (extra: Partial<RobotNotice> = {}): RobotNotice => ({
  id: "n1",
  event: "needs_input",
  agentId: "a1",
  floorId: "f1",
  floorName: "Web app",
  ownerUserId: "u1",
  ownerName: "Olga",
  robotName: "Olga's Codex robot",
  provider: "codex",
  taskTitle: "Fix the login page",
  prNumber: 12,
  prUrl: "https://github.com/octo/web/pull/12",
  ts: 1,
  ...extra,
});

describe("webhook message bodies", () => {
  test("Slack: headline, fields and an escaped PR link", () => {
    const body = slackBody(notice({ taskTitle: "a <!channel> & <https://evil|x>" }));
    const text = String(body.text);
    expect(text).toContain("*Olga's Codex robot needs your input*");
    expect(text).toContain("Floor: Web app");
    expect(text).toContain("Owner: Olga");
    expect(text).toContain("Task: a &lt;!channel&gt; &amp; &lt;https://evil|x&gt;");
    expect(text).toContain("<https://github.com/octo/web/pull/12|Pull request #12>");
    expect(text).not.toContain("<!channel>");
    expect(body.unfurl_links).toBe(false);
  });

  test("Discord: no mentions are parsed, markdown is escaped, content capped", () => {
    const body = discordBody(notice({ taskTitle: "@everyone **bold** `x`" }));
    expect(body.allowed_mentions).toEqual({ parse: [] });
    const content = String(body.content);
    expect(content).toContain("\\*\\*bold\\*\\*");
    expect(content).toContain("<https://github.com/octo/web/pull/12>");
    const long = discordBody(notice({ taskTitle: "x".repeat(5000) }));
    expect(String(long.content).length).toBeLessThanOrEqual(2000);
  });

  test("Telegram: plain text for the chat, link previews off, no parse mode", () => {
    const body = telegramBody(notice({ event: "pr_merged" }), "-1001234");
    expect(body.chat_id).toBe("-1001234");
    expect(body.parse_mode).toBeUndefined();
    expect(body.link_preview_options).toEqual({ is_disabled: true });
    expect(String(body.text)).toContain("got its pull request merged");
  });

  test("user text is flattened to one line per field", () => {
    const text = String(
      webhookBody("telegram", notice({ taskTitle: "a\nFloor: fake\r\tb" }), "1").text,
    );
    expect(text.split("\n").filter((l) => l.startsWith("Floor:"))).toHaveLength(1);
  });

  test("no PR line without a PR", () => {
    expect(String(slackBody(notice({ prUrl: "", prNumber: 0 })).text)).not.toContain(
      "Pull request",
    );
  });

  test("escapeSlack", () => {
    expect(escapeSlack("<&>")).toBe("&lt;&amp;&gt;");
  });
});
