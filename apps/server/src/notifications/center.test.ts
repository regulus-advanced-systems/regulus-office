import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_NOTIFICATION_PREFS, NOTIFY_ATTENTION_MESSAGE } from "@regulus/protocol";
import { type CenterSetup, centerSetup } from "./center.fixture.ts";
import { startFakeWebhooks } from "./testing.ts";

const fake = startFakeWebhooks();
afterAll(() => fake.stop());

let s: CenterSetup;
beforeEach(() => {
  s = centerSetup(fake);
  fake.requests.length = 0;
});

describe("personal notifications", () => {
  test("the tab badge follows the owner's waiting henchmen, sent to the owner only", () => {
    s.center.statusChanged(s.henchman("a1", "waiting_input"), "working");
    s.center.statusChanged(s.henchman("a2", "waiting_permission", 2), "working");
    const badges = s.sent.filter((m) => m.type === NOTIFY_ATTENTION_MESSAGE);
    expect(badges.every((b) => b.userId === s.member.id)).toBe(true);
    expect((badges.at(-1)?.payload as { agentIds: string[] }).agentIds.sort()).toEqual([
      "a1",
      "a2",
    ]);
    s.center.statusChanged(s.henchman("a1", "working"), "waiting_input");
    expect(
      (
        s.sent.filter((m) => m.type === NOTIFY_ATTENTION_MESSAGE).at(-1)?.payload as {
          agentIds: string[];
        }
      ).agentIds,
    ).toEqual(["a2"]);
  });

  test("events settle: a henchman that asks and carries on notifies nobody", () => {
    s.center.statusChanged(s.henchman("a1", "waiting_input"), "working");
    s.center.statusChanged(s.henchman("a1", "working"), "waiting_input");
    s.settle();
    expect(s.events()).toHaveLength(0);
    s.center.statusChanged(s.henchman("a1", "waiting_input"), "working");
    s.settle();
    expect(s.events()).toHaveLength(1);
    const { userId, payload } = s.events()[0]!;
    expect(userId).toBe(s.member.id);
    expect(payload).toMatchObject({
      event: "needs_input",
      agentId: "a1",
      operationName: "Web app",
      // Its own name first (#256), then whose it is.
      henchmanName: "Gasket, Mia's Codex henchman",
      taskTitle: "Fix the login page",
      own: true,
    });
  });

  test("dedupe: one event per henchman per cooldown", () => {
    for (let i = 0; i < 5; i++) {
      s.center.statusChanged(s.henchman("a1", "waiting_input"), "working");
      s.settle();
      s.center.statusChanged(s.henchman("a1", "working"), "waiting_input");
      s.settle();
    }
    expect(s.events()).toHaveLength(1);
    s.clock.t += 61_000;
    s.center.statusChanged(s.henchman("a1", "waiting_input"), "working");
    s.settle();
    expect(s.events()).toHaveLength(2);
  });

  test("the owner's per-event preference is respected", () => {
    s.directory.setPrefs(s.member.id, {
      ...DEFAULT_NOTIFICATION_PREFS,
      desktop: { ...DEFAULT_NOTIFICATION_PREFS.desktop, done: false },
    });
    s.center.statusChanged(s.henchman("a1", "done"), "working");
    s.settle();
    expect(s.events()).toHaveLength(0);
  });

  test("errors reach opted-in admins who can see the room as foreign notices; nobody else", () => {
    s.directory.setPrefs(s.admin.id, { ...DEFAULT_NOTIFICATION_PREFS, adminErrors: true });
    // Ada's own GitHub account can read operation-1's repo; her role alone shows her nothing.
    s.setAccess(s.admin.id, 1, "view");
    s.center.statusChanged(s.henchman("a1", "error"), "working");
    s.settle();
    const byUser = s.events().map((e) => [e.userId, e.payload.own]);
    expect(byUser).toEqual([
      [s.member.id, true],
      [s.admin.id, false],
    ]);
    // The office owner sees the room too, but did not opt in.
    expect(s.events().some((e) => e.userId === s.owner.id || e.userId === s.other.id)).toBe(false);
  });

  test("a PR opened through the office notifies once; an existing PR does not", () => {
    s.directory.setPrefs(s.member.id, {
      ...DEFAULT_NOTIFICATION_PREFS,
      desktop: { ...DEFAULT_NOTIFICATION_PREFS.desktop, pr_opened: true },
    });
    const view = s.henchman("a1", "idle");
    s.center.pullRequestOpened(view, {
      number: 7,
      url: "https://github.com/octo/web/pull/7",
      created: false,
    });
    s.center.pullRequestOpened(view, {
      number: 7,
      url: "https://github.com/octo/web/pull/7",
      created: true,
    });
    expect(s.events().map((e) => [e.payload.event, e.payload.prNumber, e.payload.prUrl])).toEqual([
      ["pr_opened", 7, "https://github.com/octo/web/pull/7"],
    ]);
  });
});

describe("team webhooks", () => {
  const addChannels = () => {
    s.channels.create(
      {
        kind: "slack",
        label: "all",
        secret: fake.slackUrl,
        operationIds: null,
        events: ["needs_input", "error"],
      },
      s.owner.id,
    );
    s.channels.create(
      {
        kind: "discord",
        label: "api operation",
        secret: fake.discordUrl,
        operationIds: ["operation-2"],
        events: ["done", "pr_merged"],
      },
      s.owner.id,
    );
    s.channels.create(
      {
        kind: "telegram",
        label: "tg",
        secret: fake.telegramToken,
        chatId: "-1001",
        operationIds: null,
        events: ["pr_merged"],
        enabled: false,
      },
      s.owner.id,
    );
  };

  test("routes by event and operation; disabled channels get nothing", async () => {
    addChannels();
    s.center.statusChanged(s.henchman("a1", "waiting_input"), "working");
    s.center.statusChanged(s.henchman("a2", "done", 2), "working");
    s.settle();
    s.center.pullRequestMerged({ ...s.henchman("a2", "idle", 2), prNumber: 5 });
    s.center.statusChanged(s.henchman("a1", "done"), "waiting_input");
    s.settle();
    await s.dispatcher.drain();
    const paths = fake.requests.map((r) => r.path.split("/")[1]);
    expect(paths.sort()).toEqual(["api", "api", "services"]);
    const slack = fake.requests.find((r) => r.path.startsWith("/services/"))!;
    expect(String(slack.body.text)).toContain("needs your input");
    const merged = fake.requests.find((r) => String(r.body.content).includes("merged"))!;
    expect(String(merged.body.content)).toContain("<https://github.com/octo/api/pull/5>");
  });

  test("messages carry only henchman, owner, operation, status, task and PR link", async () => {
    addChannels();
    s.center.statusChanged(s.henchman("a1", "error"), "working");
    s.settle();
    await s.dispatcher.drain();
    const text = String(fake.requests[0]?.body.text);
    expect(text).toContain("Mia's Codex henchman hit an error");
    expect(text).toContain("Operation: Web app");
    expect(text).toContain("Owner: Mia");
    expect(text).toContain("Task: Fix the login page");
    expect(Object.keys(fake.requests[0]!.body).sort()).toEqual([
      "text",
      "unfurl_links",
      "unfurl_media",
    ]);
  });

  test("a flapping henchman is capped per henchman", async () => {
    addChannels();
    // Past the 60 s cooldown each time, all within the 10 min window.
    for (let i = 0; i < 9; i++) {
      s.clock.t += 61_000;
      s.center.statusChanged(s.henchman("a1", "waiting_input"), "working");
      s.settle();
    }
    await s.dispatcher.drain();
    expect(fake.requests).toHaveLength(8);
    expect(s.log.text()).toContain("team notification capped");
  });

  test("Send test reaches a disabled channel once and records the result", async () => {
    addChannels();
    const tg = s.channels.list().find((c) => c.kind === "telegram")!;
    const res = await s.center.sendTest(tg.id);
    expect(res).toEqual({ ok: true, code: "sent" });
    expect(fake.requests[0]?.path).toBe(`/bot${fake.telegramToken}/sendMessage`);
    expect(fake.requests[0]?.body.chat_id).toBe("-1001");
    expect(await s.center.sendTest("nope")).toEqual({ ok: false, code: "not_found" });
  });

  test("logs never contain a webhook URL or token", async () => {
    addChannels();
    fake.script.push({ status: 404 }, { status: 404 });
    s.center.statusChanged(s.henchman("a1", "error"), "working");
    s.settle();
    await s.dispatcher.drain();
    const text = s.log.text();
    for (const secret of ["fakeSlackSecret123", "fakeDiscordSecret_abc", fake.telegramToken]) {
      expect(text).not.toContain(secret);
    }
  });
});
