import { afterAll, describe, expect, test } from "bun:test";
import { WebhookDispatcher } from "./delivery.ts";
import type { ChannelTarget } from "./senders.ts";
import { captureLogger, startFakeWebhooks } from "./testing.ts";

const fake = startFakeWebhooks();
afterAll(() => fake.stop());

function dispatcher(extra: Partial<ConstructorParameters<typeof WebhookDispatcher>[0]> = {}) {
  const clock = { t: 1_000_000 };
  const sleeps: number[] = [];
  const log = captureLogger();
  const results: string[] = [];
  const d = new WebhookDispatcher({
    policy: fake.policy(),
    logger: log.logger,
    now: () => clock.t,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
    onResult: (_id, r) => results.push(r.code),
    ...extra,
  });
  return { d, clock, sleeps, log, results };
}

const slack = (): ChannelTarget => ({ kind: "slack", secret: fake.slackUrl, chatId: null });

describe("WebhookDispatcher", () => {
  test("retries 5xx and 429 with backoff, honouring Retry-After", async () => {
    const { d, sleeps, results } = dispatcher();
    fake.requests.length = 0;
    fake.script.push({ status: 502 }, { status: 429, headers: { "retry-after": "9" } });
    const res = await d.enqueue("c1", slack, { text: "x" });
    expect(res.code).toBe("sent");
    expect(fake.requests).toHaveLength(3);
    // backoff 1 s, then max(5 s, Retry-After 9 s); pacing waits are the 1.1 s spacing.
    expect(sleeps.filter((ms) => ms === 1_000 || ms === 9_000)).toEqual([1_000, 9_000]);
    expect(results).toEqual(["sent"]);
  });

  test("gives up after the last backoff step and records the failure", async () => {
    const { d, results, log } = dispatcher({ backoffMs: [10, 10] });
    fake.requests.length = 0;
    fake.script.push({ status: 500 }, { status: 500 }, { status: 500 });
    const res = await d.enqueue("c1", slack, { text: "x" });
    expect(res.code).toBe("http_500");
    expect(fake.requests).toHaveLength(3);
    expect(results).toEqual(["http_500"]);
    expect(log.text()).toContain("notification delivery failed");
    expect(log.text()).not.toContain("fakeSlackSecret123");
  });

  test("a 4xx is not retried; a Retry-After over the cap gives up", async () => {
    const { d } = dispatcher();
    fake.requests.length = 0;
    fake.script.push({ status: 404 });
    expect((await d.enqueue("c1", slack, {})).code).toBe("http_404");
    fake.script.push({ status: 429, headers: { "retry-after": "3600" } });
    expect((await d.enqueue("c1", slack, {})).code).toBe("rate_limited");
    expect(fake.requests).toHaveLength(2);
  });

  test("`retry: false` sends once (Send test)", async () => {
    const { d } = dispatcher();
    fake.requests.length = 0;
    fake.script.push({ status: 503 });
    expect((await d.enqueue("c1", slack, {}, { retry: false })).code).toBe("http_503");
    expect(fake.requests).toHaveLength(1);
  });

  test("paces a channel: spacing between sends and a per-minute cap", async () => {
    const { d, clock } = dispatcher({ perMinute: 3, minSpacingMs: 1_000 });
    const sentAt: number[] = [];
    const resolve = () => {
      sentAt.push(clock.t);
      return slack();
    };
    await Promise.all([1, 2, 3, 4].map(() => d.enqueue("c1", resolve, {})));
    expect(sentAt[1]! - sentAt[0]!).toBeGreaterThanOrEqual(1_000);
    expect(sentAt[3]! - sentAt[0]!).toBeGreaterThanOrEqual(60_000);
  });

  test("drops messages beyond the queue limit", async () => {
    const { d } = dispatcher({ queueLimit: 2 });
    const all = await Promise.all([1, 2, 3].map(() => d.enqueue("c9", slack, {})));
    expect(all.map((r) => r.code)).toEqual(["sent", "sent", "queue_full"]);
  });

  test("a channel deleted meanwhile, or closed dispatcher, sends nothing", async () => {
    const { d } = dispatcher();
    expect((await d.enqueue("gone", () => null, {})).code).toBe("channel_gone");
    d.close();
    expect((await d.enqueue("c1", slack, {})).code).toBe("shutting_down");
  });
});
