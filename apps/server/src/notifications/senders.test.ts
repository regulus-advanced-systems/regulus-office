import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_SENDER_POLICY, sendWebhook, validateSecret } from "./senders.ts";
import { startFakeWebhooks } from "./testing.ts";

const fake = startFakeWebhooks();
afterAll(() => fake.stop());

describe("validateSecret", () => {
  const policy = DEFAULT_SENDER_POLICY;
  test("accepts the real providers' shapes", () => {
    expect(
      validateSecret("slack", "https://hooks.slack.com/services/T1/B2/abc", policy),
    ).toBeNull();
    expect(
      validateSecret("discord", "https://discord.com/api/webhooks/123/tok-en_1", policy),
    ).toBeNull();
    expect(validateSecret("telegram", "123456:ABCdefGHIjklMNOpqrSTUvwx_yz-12", policy)).toBeNull();
  });

  test("refuses other hosts, plain http, credentials in URLs and odd paths", () => {
    expect(validateSecret("slack", "https://evil.example/services/T1/B2/abc", policy)).toBe(
      "webhook_host_not_allowed",
    );
    expect(validateSecret("slack", "http://hooks.slack.com/services/T1/B2/abc", policy)).toBe(
      "invalid_webhook_url",
    );
    expect(validateSecret("discord", "https://u:p@discord.com/api/webhooks/1/x", policy)).toBe(
      "invalid_webhook_url",
    );
    expect(validateSecret("discord", "https://discord.com/api/users/1", policy)).toBe(
      "invalid_webhook_url",
    );
    expect(validateSecret("slack", "not a url", policy)).toBe("invalid_webhook_url");
    expect(validateSecret("telegram", "https://api.telegram.org/bot1:x", policy)).toBe(
      "invalid_bot_token",
    );
  });
});

describe("sendWebhook against fake providers", () => {
  const policy = fake.policy();

  test("Slack, Discord and Telegram succeed", async () => {
    fake.requests.length = 0;
    const slack = await sendWebhook(
      { kind: "slack", secret: fake.slackUrl, chatId: null },
      { text: "hi" },
      policy,
    );
    const discord = await sendWebhook(
      { kind: "discord", secret: fake.discordUrl, chatId: null },
      { content: "hi" },
      policy,
    );
    const telegram = await sendWebhook(
      { kind: "telegram", secret: fake.telegramToken, chatId: "-100" },
      { chat_id: "-100", text: "hi" },
      policy,
    );
    expect([slack.code, discord.code, telegram.code]).toEqual(["sent", "sent", "sent"]);
    expect(fake.requests.map((r) => r.path)).toEqual([
      "/services/T000/B000/fakeSlackSecret123",
      "/api/webhooks/123456/fakeDiscordSecret_abc",
      `/bot${fake.telegramToken}/sendMessage`,
    ]);
  });

  test("429 carries the provider's retry-after (header or body)", async () => {
    fake.script.push({ status: 429, headers: { "retry-after": "3" } });
    const slack = await sendWebhook(
      { kind: "slack", secret: fake.slackUrl, chatId: null },
      {},
      policy,
    );
    expect(slack).toEqual({ ok: false, code: "rate_limited", retryable: true, retryAfterMs: 3000 });
    fake.script.push({
      status: 429,
      body: JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 7 } }),
    });
    const tg = await sendWebhook(
      { kind: "telegram", secret: fake.telegramToken, chatId: "1" },
      {},
      policy,
    );
    expect(tg.retryAfterMs).toBe(7000);
  });

  test("4xx is final, 5xx and network errors are retryable; codes only", async () => {
    fake.script.push({ status: 404, body: "no_service fakeSlackSecret123" });
    const gone = await sendWebhook(
      { kind: "slack", secret: fake.slackUrl, chatId: null },
      {},
      policy,
    );
    expect(gone).toEqual({ ok: false, code: "http_404", retryable: false });
    fake.script.push({ status: 503 });
    const down = await sendWebhook(
      { kind: "discord", secret: fake.discordUrl, chatId: null },
      {},
      policy,
    );
    expect(down).toEqual({ ok: false, code: "http_503", retryable: true });
    const unreachable = await sendWebhook(
      { kind: "slack", secret: "http://127.0.0.1:1/services/T/B/x", chatId: null },
      {},
      { ...policy, slackHosts: ["127.0.0.1:1"] },
    );
    expect(unreachable.code).toBe("network_error");
    expect(unreachable.retryable).toBe(true);
  });

  test("Telegram ok:false is a failure; a missing chat id never sends", async () => {
    fake.script.push({
      status: 200,
      body: JSON.stringify({ ok: false, description: "chat not found" }),
    });
    const res = await sendWebhook(
      { kind: "telegram", secret: fake.telegramToken, chatId: "1" },
      {},
      policy,
    );
    expect(res.code).toBe("telegram_rejected");
    const before = fake.requests.length;
    const missing = await sendWebhook(
      { kind: "telegram", secret: fake.telegramToken, chatId: null },
      {},
      policy,
    );
    expect(missing.code).toBe("missing_chat_id");
    expect(fake.requests.length).toBe(before);
  });

  test("a redirect is not followed", async () => {
    fake.script.push({ status: 302, headers: { location: "http://127.0.0.1:1/elsewhere" } });
    const res = await sendWebhook(
      { kind: "slack", secret: fake.slackUrl, chatId: null },
      {},
      policy,
    );
    expect(res.code).toBe("http_302");
  });
});
