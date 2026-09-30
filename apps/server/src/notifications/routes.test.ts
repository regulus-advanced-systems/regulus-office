/** HTTP surface of notifications (#42) over a real server with sessions and a fake Slack/Discord/Telegram. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_ATTENTION_API_PATH,
  NOTIFICATION_CHANNELS_API_PATH,
  NOTIFICATION_PREFS_API_PATH,
  type NotificationChannelsResponse,
  type NotificationChannelView,
  notificationChannelPath,
} from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { auditLog, notificationChannels } from "../db/schema/index.ts";
import { createNotifications } from "./setup.ts";
import { captureLogger, startFakeWebhooks, testKeyring } from "./testing.ts";

const fake = startFakeWebhooks();
const log = captureLogger();
let office: Office;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let admin: { id: string; cookie: string };

beforeAll(async () => {
  office = startOffice();
  const notifications = createNotifications({
    db: office.db,
    keyring: testKeyring(),
    logger: log.logger,
    config: { githubApiBase: "http://127.0.0.1:1", githubWebBase: "https://github.com" },
    personal: { sendToUser: () => {} },
    policy: fake.policy(),
  });
  notifications.mount(office.server.router, office.auth);
  owner = await office.signUp("Olga");
  member = await office.signUp("Mia");
  admin = await office.signUp("Ada");
  office.db.$client.run(`update user_profiles set role = 'admin' where user_id = '${admin.id}'`);
});

afterAll(async () => {
  await office.stop();
  fake.stop();
});

const send = (path: string, method: string, cookie: string, body?: unknown, origin?: string) =>
  office.request(path, {
    method,
    cookie,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: origin ? { origin } : undefined,
  });

const SECRETS = () => ["fakeSlackSecret123", "fakeDiscordSecret_abc", fake.telegramToken];

function expectNoSecrets(text: string) {
  for (const secret of SECRETS()) expect(text).not.toContain(secret);
}

describe("preferences", () => {
  test("signed-in humans read and replace their own; adminErrors only for managers", async () => {
    expect((await office.request(NOTIFICATION_PREFS_API_PATH)).status).toBe(401);
    const initial = await (await send(NOTIFICATION_PREFS_API_PATH, "GET", member.cookie)).json();
    expect(initial).toEqual(DEFAULT_NOTIFICATION_PREFS);
    const wanted = {
      ...DEFAULT_NOTIFICATION_PREFS,
      adminErrors: true,
      quietHours: { enabled: true, start: "21:30", end: "07:00" },
    };
    const saved = await (
      await send(NOTIFICATION_PREFS_API_PATH, "PUT", member.cookie, wanted)
    ).json();
    expect(saved.adminErrors).toBe(false);
    expect(saved.quietHours.start).toBe("21:30");
    const asAdmin = await (
      await send(NOTIFICATION_PREFS_API_PATH, "PUT", admin.cookie, wanted)
    ).json();
    expect(asAdmin.adminErrors).toBe(true);
    const bad = await send(NOTIFICATION_PREFS_API_PATH, "PUT", member.cookie, { desktop: {} });
    expect(bad.status).toBe(400);
    const cross = await send(
      NOTIFICATION_PREFS_API_PATH,
      "PUT",
      member.cookie,
      wanted,
      "https://evil.example",
    );
    expect(cross.status).toBe(403);
  });

  test("attention lists the human's waiting robots (none here)", async () => {
    const res = await send(NOTIFICATION_ATTENTION_API_PATH, "GET", member.cookie);
    expect(await res.json()).toEqual({ agentIds: [] });
  });
});

describe("team channels", () => {
  const slackInput = () => ({
    kind: "slack",
    label: "Team",
    secret: fake.slackUrl,
    floorIds: null,
    events: ["needs_input", "done", "pr_merged"],
  });

  test("owners and admins only; same origin for writes", async () => {
    expect((await send(NOTIFICATION_CHANNELS_API_PATH, "GET", member.cookie)).status).toBe(403);
    expect(
      (await send(NOTIFICATION_CHANNELS_API_PATH, "POST", member.cookie, slackInput())).status,
    ).toBe(403);
    const cross = await send(
      NOTIFICATION_CHANNELS_API_PATH,
      "POST",
      owner.cookie,
      slackInput(),
      "https://evil.example",
    );
    expect(cross.status).toBe(403);
    expect((await send(NOTIFICATION_CHANNELS_API_PATH, "GET", admin.cookie)).status).toBe(200);
  });

  test("create, list, update, test and delete; the secret never comes back", async () => {
    const created = await send(NOTIFICATION_CHANNELS_API_PATH, "POST", owner.cookie, slackInput());
    expect(created.status).toBe(201);
    const createdText = await created.text();
    expectNoSecrets(createdText);
    const view = JSON.parse(createdText) as NotificationChannelView;
    expect(view).toMatchObject({ kind: "slack", label: "Team", floorIds: null, enabled: true });

    const tg = await send(NOTIFICATION_CHANNELS_API_PATH, "POST", admin.cookie, {
      kind: "telegram",
      label: "Ops chat",
      secret: fake.telegramToken,
      chatId: "-100123",
      floorIds: ["floor-x"],
      events: ["error"],
    });
    expect(tg.status).toBe(201);

    const listRes = await send(NOTIFICATION_CHANNELS_API_PATH, "GET", owner.cookie);
    const listText = await listRes.text();
    expectNoSecrets(listText);
    const list = JSON.parse(listText) as NotificationChannelsResponse;
    expect(list.canStore).toBe(true);
    expect(list.channels.map((c) => c.label)).toEqual(["Team", "Ops chat"]);

    // Stored encrypted.
    const rows = office.db.select().from(notificationChannels).all();
    expectNoSecrets(JSON.stringify(rows));

    const patched = await send(notificationChannelPath(view.id), "PATCH", owner.cookie, {
      events: ["error"],
      enabled: false,
      secret: fake.slackUrl.replace("fakeSlackSecret123", "fakeSlackSecret123b"),
    });
    expect(patched.status).toBe(200);
    const patchedView = (await patched.json()) as NotificationChannelView;
    expect(patchedView).toMatchObject({ events: ["error"], enabled: false });

    fake.requests.length = 0;
    const tested = await send(notificationChannelPath(view.id, true), "POST", owner.cookie);
    expect(await tested.json()).toEqual({ ok: true, code: "sent" });
    expect(fake.requests[0]?.path).toBe("/services/T000/B000/fakeSlackSecret123b");
    expect(String(fake.requests[0]?.body.text)).toContain("Test robot");
    const again = await send(notificationChannelPath(view.id, true), "POST", owner.cookie);
    expect(again.status).toBe(429);

    const after = (await (
      await send(NOTIFICATION_CHANNELS_API_PATH, "GET", owner.cookie)
    ).json()) as NotificationChannelsResponse;
    expect(after.channels.find((c) => c.id === view.id)?.lastDelivery).toMatchObject({
      ok: true,
      code: "sent",
    });

    expect((await send(notificationChannelPath(view.id), "DELETE", owner.cookie)).status).toBe(204);
    expect((await send(notificationChannelPath(view.id), "DELETE", owner.cookie)).status).toBe(404);

    const audit = office.db.select().from(auditLog).all();
    const actions = audit.map((a) => a.action).filter((a) => a.startsWith("notification_channel"));
    expect(actions).toEqual([
      "notification_channel.create",
      "notification_channel.create",
      "notification_channel.update",
      "notification_channel.delete",
    ]);
    expectNoSecrets(JSON.stringify(audit));
    expectNoSecrets(log.text());
  });

  test("bad secrets are refused without echoing them", async () => {
    const other = await send(NOTIFICATION_CHANNELS_API_PATH, "POST", owner.cookie, {
      ...slackInput(),
      secret: "https://evil.example/services/T/B/leakme",
    });
    expect(other.status).toBe(400);
    const text = await other.text();
    expect(text).toContain("webhook_host_not_allowed");
    expect(text).not.toContain("leakme");
    const noChat = await send(NOTIFICATION_CHANNELS_API_PATH, "POST", owner.cookie, {
      kind: "telegram",
      label: "x",
      secret: fake.telegramToken,
      floorIds: null,
      events: [],
    });
    expect(noChat.status).toBe(400);
    expect(await noChat.text()).not.toContain(fake.telegramToken);
  });

  test("without a master key nothing can be stored", async () => {
    const plain = startOffice();
    const n = createNotifications({
      db: plain.db,
      keyring: undefined,
      logger: log.logger,
      config: { githubApiBase: "http://127.0.0.1:1", githubWebBase: "https://github.com" },
      personal: { sendToUser: () => {} },
      policy: fake.policy(),
    });
    n.mount(plain.server.router, plain.auth);
    const boss = await plain.signUp("Boss");
    const res = await plain.request(NOTIFICATION_CHANNELS_API_PATH, {
      method: "POST",
      cookie: boss.cookie,
      body: JSON.stringify(slackInput()),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "master_key_required" });
    await plain.stop();
  });
});
