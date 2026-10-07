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
import { auditLog, notificationChannels, operations } from "../db/schema/index.ts";
import { seedRoomMember } from "../github/access/test-snapshot.ts";
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
  // Two rooms. The owner's GitHub account can see both repos, the admin's only
  // operation-x's: an office role alone shows nobody a room (#270).
  for (const [index, id] of ["operation-x", "operation-y"].entries()) {
    office.db
      .insert(operations)
      .values({
        id,
        name: id,
        slug: id,
        index: index + 1,
        paletteId: "oak-sky",
        layoutTemplateId: "t",
      })
      .run();
    seedRoomMember(office.db, owner.id, id, "manage");
  }
  seedRoomMember(office.db, admin.id, "operation-x", "view");
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

  test("attention lists the human's waiting henchmen (none here)", async () => {
    const res = await send(NOTIFICATION_ATTENTION_API_PATH, "GET", member.cookie);
    expect(await res.json()).toEqual({ agentIds: [] });
  });
});

describe("team channels", () => {
  const slackInput = () => ({
    kind: "slack",
    label: "Team",
    secret: fake.slackUrl,
    operationIds: null,
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
    expect(view).toMatchObject({ kind: "slack", label: "Team", operationIds: null, enabled: true });

    const tg = await send(NOTIFICATION_CHANNELS_API_PATH, "POST", admin.cookie, {
      kind: "telegram",
      label: "Ops chat",
      secret: fake.telegramToken,
      chatId: "-100123",
      operationIds: ["operation-x"],
      events: ["error"],
    });
    // The admin's own GitHub account can see operation-x's repo.
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
    expect(String(fake.requests[0]?.body.text)).toContain("Test henchman");
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

  test("a channel can only name rooms its author can see; other ids are refused as unknown", async () => {
    const naming = (operationIds: string[]) => ({ ...slackInput(), operationIds });
    const before = office.db.select().from(notificationChannels).all().length;
    // operation-y exists, but the admin's GitHub account cannot see its repo.
    const hidden = await send(
      NOTIFICATION_CHANNELS_API_PATH,
      "POST",
      admin.cookie,
      naming(["operation-x", "operation-y"]),
    );
    expect(hidden.status).toBe(400);
    expect(await hidden.json()).toEqual({ error: "unknown_operation" });
    // The same answer as for a room that does not exist.
    const missing = await send(
      NOTIFICATION_CHANNELS_API_PATH,
      "POST",
      owner.cookie,
      naming(["nope"]),
    );
    expect([missing.status, await missing.json()]).toEqual([400, { error: "unknown_operation" }]);
    expect(office.db.select().from(notificationChannels).all()).toHaveLength(before);

    const made = await send(
      NOTIFICATION_CHANNELS_API_PATH,
      "POST",
      owner.cookie,
      naming(["operation-x", "operation-y"]),
    );
    expect(made.status).toBe(201);
    const view = (await made.json()) as NotificationChannelView;
    expect(view.operationIds).toEqual(["operation-x", "operation-y"]);
    // Patching follows the same rule, and a refused patch changes nothing.
    const patched = await send(notificationChannelPath(view.id), "PATCH", admin.cookie, {
      label: "Renamed",
      operationIds: ["operation-y"],
    });
    expect(patched.status).toBe(400);
    expect(await patched.json()).toEqual({ error: "unknown_operation" });
    const row = office.db.select().from(notificationChannels).all().at(-1);
    expect(row).toMatchObject({ label: "Team", operationIdsJson: '["operation-x","operation-y"]' });
    const allowed = await send(notificationChannelPath(view.id), "PATCH", owner.cookie, {
      operationIds: ["operation-y"],
    });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as NotificationChannelView).operationIds).toEqual([
      "operation-y",
    ]);
    expect((await send(notificationChannelPath(view.id), "DELETE", owner.cookie)).status).toBe(204);
  });

  test("the list and the PATCH answer show a viewer only the room ids they can see", async () => {
    const made = await send(NOTIFICATION_CHANNELS_API_PATH, "POST", owner.cookie, {
      ...slackInput(),
      operationIds: ["operation-x", "operation-y"],
    });
    const { id } = (await made.json()) as NotificationChannelView;
    const idsFor = async (cookie: string) => {
      const list = (await (
        await send(NOTIFICATION_CHANNELS_API_PATH, "GET", cookie)
      ).json()) as NotificationChannelsResponse;
      return list.channels.find((c) => c.id === id)?.operationIds;
    };
    expect(await idsFor(owner.cookie)).toEqual(["operation-x", "operation-y"]);
    const asAdmin = await send(NOTIFICATION_CHANNELS_API_PATH, "GET", admin.cookie);
    const text = await asAdmin.text();
    expect(text).not.toContain("operation-y");
    expect(await idsFor(admin.cookie)).toEqual(["operation-x"]);
    // A patch that leaves the rooms alone answers with the same narrowed view, and keeps both.
    const renamed = await send(notificationChannelPath(id), "PATCH", admin.cookie, {
      label: "Renamed",
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ label: "Renamed", operationIds: ["operation-x"] });
    expect(await idsFor(owner.cookie)).toEqual(["operation-x", "operation-y"]);
    // An admin whose GitHub account loses the last room sees the channel with no room ids.
    seedRoomMember(office.db, admin.id, "operation-x", null);
    expect(await idsFor(admin.cookie)).toEqual([]);
    seedRoomMember(office.db, admin.id, "operation-x", "view");
    expect((await send(notificationChannelPath(id), "DELETE", owner.cookie)).status).toBe(204);
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
      operationIds: null,
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
