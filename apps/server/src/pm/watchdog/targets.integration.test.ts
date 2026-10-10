/**
 * Targets and the office's stored credentials (#253, second review), over a
 * real office server:
 *
 * - an admin who cannot see a target's room can stop watching it, but cannot
 *   get it back under a room of their own by removing it and adding it again:
 *   the target is kept as "not watched", with its room;
 * - a stored SSH key or Sentry token is pointed at something new (a new app,
 *   another address, a new project, another organisation) only by the office
 *   owner, or by an admin who gives the credential again;
 * - a host key nobody could read cannot be accepted.
 *
 * Olga owns the office and sees no room. Ada is an admin and sees both rooms.
 * Sam is made an admin here and sees Borealis only.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  WATCHDOG_HOSTS_API_PATH,
  WATCHDOG_SENTRY_PROJECTS_API_PATH,
  WATCHDOG_SETTINGS_API_PATH,
  type WatchdogHostView,
  type WatchdogSettingsView,
  watchdogHostKeyPath,
} from "@regulus/protocol";
import { auditLog, watchdogApps, watchdogSentryProjects } from "../../db/schema/index.ts";
import { APOLLO, BOREALIS } from "../test-helpers.ts";
import { fingerprints } from "./hostkey.ts";
import {
  type CheckResult,
  FIRST_HOST_KEY,
  judging,
  OTHER_HOST_KEY,
  TEST_PRIVATE_KEY,
  TEST_SENTRY_TOKEN,
  type WatchdogOffice,
  watchdogOffice,
} from "./testing/kit.ts";

setDefaultTimeout(60_000);

let o: WatchdogOffice;
let hostId: string;
let ada: string;
let sam: string;
let olga: string;

const HOST = { label: "prod-1", host: "prod-1.example.com", username: "watchdog" };
const OTHER_TOKEN = "sntryu_FAKE_another_token_0123456789abcdef";

beforeAll(async () => {
  o = await watchdogOffice();
  hostId = (await o.configure()).id;
  await o.setApps([{ name: "api", log: ["Error: disk full on /var"] }, { name: "worker" }]);
  o.db.$client.run(`update user_profiles set role = 'admin' where user_id = '${o.people.sam.id}'`);
  ada = o.people.ada.cookie;
  sam = o.people.sam.cookie;
  olga = o.people.olga.cookie;
}, 60_000);
afterAll(() => o.stopAll());

const answer = async (res: Response) => [res.status, await res.json()];
const putHost = (cookie: string, body: Record<string, unknown>, id = hostId) =>
  o.send(`${WATCHDOG_HOSTS_API_PATH}/${id}`, "PUT", cookie, { ...HOST, ...body });
const putProjects = (cookie: string, projects: unknown, sentryToken?: string) =>
  o.send(WATCHDOG_SENTRY_PROJECTS_API_PATH, "PUT", cookie, {
    projects,
    ...(sentryToken ? { sentryToken } : {}),
  });
const settings = async (cookie: string) =>
  (await (await o.send(WATCHDOG_SETTINGS_API_PATH, "GET", cookie)).json()) as WatchdogSettingsView;
const appRows = () =>
  o.db
    .select()
    .from(watchdogApps)
    .all()
    .filter((a) => a.hostId === hostId)
    .map((a) => [a.name, a.operationId, a.watched])
    .sort();
const projectRows = () =>
  o.db
    .select()
    .from(watchdogSentryProjects)
    .all()
    .map((p) => [p.slug, p.operationId, p.watched])
    .sort();
const lastAudit = (action: string) => {
  const row = o.db
    .select()
    .from(auditLog)
    .all()
    .filter((a) => a.action === action)
    .at(-1);
  return [row?.userId, JSON.parse(row?.metaJson ?? "{}")];
};
const ROOM_NOT_YOURS = [403, { error: "room_not_yours" }];
const credentialRequired = (res: unknown[]) => {
  expect(res[0]).toBe(403);
  expect(res[1]).toMatchObject({ error: "credential_required" });
};

describe("a target in a room the admin cannot see", () => {
  test("stops being watched but keeps its room: removing and adding it again is not a way into it", async () => {
    const apiId = o.db
      .select()
      .from(watchdogApps)
      .all()
      .find((a) => a.name === "api")?.id;
    // Sam cannot see Apollo. He stops watching Apollo's app.
    expect((await putHost(sam, { apps: [{ name: "worker" }] })).status).toBe(200);
    expect(appRows()).toEqual([
      ["api", APOLLO, false],
      ["worker", null, true],
    ]);
    expect(lastAudit("watchdog.host_save")[1]).toMatchObject({ keptUnwatched: 1 });
    const shown = (await settings(sam)).hosts[0]?.apps.find((a) => a.name === "api");
    expect(shown).toEqual({
      id: apiId as string,
      name: "api",
      operationId: null,
      operationHidden: true,
      watched: false,
    });
    expect(JSON.stringify(await settings(sam))).not.toContain(APOLLO);
    // Now he adds "api" again: with no room, in his own room, as it was, with the key given
    // again. Each is a change to the target that is there, and each gets the one answer.
    for (const app of [
      { name: "api", operationId: null },
      { name: "api", operationId: BOREALIS },
      { name: "api", operationId: APOLLO },
      { name: "api" },
    ]) {
      const res = await putHost(sam, {
        privateKey: TEST_PRIVATE_KEY,
        apps: [app, { name: "worker" }],
      });
      expect(await answer(res)).toEqual(ROOM_NOT_YOURS);
    }
    expect(appRows()).toEqual([
      ["api", APOLLO, false],
      ["worker", null, true],
    ]);
    // It is not read: no part for Apollo's app, and nothing of its log reaches anyone.
    const seen: string[] = [];
    o.setScript(
      judging(
        () => null,
        (check: CheckResult) => void seen.push(...check.signals.map((s) => s.summary)),
      ),
    );
    const before = (await o.sshCalls()).length;
    await o.round();
    const remote = (await o.sshCalls()).slice(before).map((c) => c.remote.join(" "));
    expect(remote.some((r) => r.includes("api"))).toBe(false);
    expect(seen.join("\n")).not.toContain("disk full");
    // Ada sees Apollo: she watches it again, and it is the same target in the same room.
    expect((await putHost(ada, { apps: [{ name: "api" }, { name: "worker" }] })).status).toBe(200);
    expect(appRows()).toEqual([
      ["api", APOLLO, true],
      ["worker", null, true],
    ]);
    expect(o.watchdog.store.apps().find((a) => a.name === "api")?.id).toBe(apiId as string);
  });

  test("the same for a Sentry project", async () => {
    const webId = o.watchdog.store.sentryProjects()[0]?.id;
    expect((await putProjects(sam, [])).status).toBe(200);
    expect(projectRows()).toEqual([["web", APOLLO, false]]);
    expect(lastAudit("watchdog.sentry_projects")[1]).toMatchObject({ keptUnwatched: 1 });
    expect(o.watchdog.store.sentryProjects()).toEqual([]);
    expect((await settings(sam)).sentry.projects).toEqual([
      {
        id: webId as string,
        slug: "web",
        operationId: null,
        operationHidden: true,
        watched: false,
      },
    ]);
    for (const project of [
      { slug: "web", operationId: null },
      { slug: "web", operationId: BOREALIS },
      { slug: "web", operationId: "op-nowhere" },
      { slug: "web" },
    ]) {
      expect(await answer(await putProjects(sam, [project], TEST_SENTRY_TOKEN))).toEqual(
        ROOM_NOT_YOURS,
      );
    }
    expect(projectRows()).toEqual([["web", APOLLO, false]]);
    expect((await putProjects(ada, [{ slug: "web" }])).status).toBe(200);
    expect(projectRows()).toEqual([["web", APOLLO, true]]);
    expect(o.watchdog.store.sentryProjects()[0]?.id).toBe(webId as string);
  });

  test("deleted by someone who sees its room, it is really gone", async () => {
    expect((await putHost(ada, { apps: [{ name: "worker" }] })).status).toBe(200);
    expect(appRows()).toEqual([["worker", null, true]]);
    expect(
      (
        await putHost(ada, {
          apps: [{ name: "api", operationId: APOLLO }, { name: "worker" }],
          privateKey: TEST_PRIVATE_KEY,
        })
      ).status,
    ).toBe(200);
  });

  test("a host with such a target is not deleted by that admin: it stays, not watched", async () => {
    const res = await o.send(`${WATCHDOG_HOSTS_API_PATH}/${hostId}`, "DELETE", sam);
    expect(res.status).toBe(204);
    // Apollo's app is kept with its room; the app without a room, which he can see, is gone.
    expect(appRows()).toEqual([["api", APOLLO, false]]);
    expect(lastAudit("watchdog.host_delete")).toEqual([o.people.sam.id, { kept: true }]);
    expect(o.watchdog.store.host(hostId)).toBeDefined();
    expect(
      (
        await putHost(ada, {
          apps: [{ name: "api" }, { name: "worker" }],
          privateKey: TEST_PRIVATE_KEY,
        })
      ).status,
    ).toBe(200);
  });
});

describe("the office's stored credentials", () => {
  test("a new app on a host that has a key: the office owner, or the key given again", async () => {
    const withBilling = [
      { name: "api" },
      { name: "worker" },
      { name: "billing", operationId: BOREALIS },
    ];
    credentialRequired(await answer(await putHost(sam, { apps: withBilling })));
    credentialRequired(await answer(await putHost(ada, { apps: withBilling })));
    expect(appRows().map((a) => a[0])).toEqual(["api", "worker"]);
    // With the key: he could read that host anyway.
    expect((await putHost(sam, { apps: withBilling, privateKey: TEST_PRIVATE_KEY })).status).toBe(
      200,
    );
    expect(lastAudit("watchdog.host_save")).toEqual([
      o.people.sam.id,
      expect.objectContaining({ appsAdded: 1, onStoredKey: "given_again", keyReplaced: true }),
    ]);
    // The owner, without it.
    const withCron = [...withBilling.map((a) => ({ name: a.name })), { name: "cron" }];
    expect((await putHost(olga, { apps: withCron })).status).toBe(200);
    expect(lastAudit("watchdog.host_save")).toEqual([
      o.people.olga.id,
      expect.objectContaining({ appsAdded: 1, onStoredKey: "owner", keyReplaced: false }),
    ]);
    expect(appRows().map((a) => a[0])).toEqual(["api", "billing", "cron", "worker"]);
    // Changing what is there needs neither.
    expect((await putHost(sam, { label: "production", apps: withCron })).status).toBe(200);
  });

  test("a new Sentry project, or another organisation, on the stored token: the same", async () => {
    const withShop = [{ slug: "web" }, { slug: "shop", operationId: BOREALIS }];
    credentialRequired(await answer(await putProjects(sam, withShop)));
    credentialRequired(await answer(await putProjects(ada, withShop)));
    expect(projectRows().map((p) => p[0])).toEqual(["web"]);
    expect((await putProjects(sam, withShop, OTHER_TOKEN)).status).toBe(200);
    // The token he gave is the one that is used from now on, not the office's old copy.
    expect(o.watchdog.store.sentryToken()?.reveal()).toBe(OTHER_TOKEN);
    expect(lastAudit("watchdog.sentry_projects")).toEqual([
      o.people.sam.id,
      expect.objectContaining({ added: 1, onStoredToken: "given_again", tokenReplaced: true }),
    ]);
    expect(JSON.stringify(lastAudit("watchdog.sentry_projects"))).not.toContain("sntryu_");
    expect(
      (await putProjects(olga, [...withShop.map((p) => ({ slug: p.slug })), { slug: "docs" }]))
        .status,
    ).toBe(200);
    expect(lastAudit("watchdog.sentry_projects")[1]).toMatchObject({
      added: 1,
      onStoredToken: "owner",
    });
    // The organisation the stored token is read from.
    const patch = (cookie: string, body: Record<string, unknown>) =>
      o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", cookie, body);
    credentialRequired(await answer(await patch(sam, { sentryOrganization: "other" })));
    expect(o.watchdog.store.settings().sentryOrganization).toBe("acme");
    expect(
      (await patch(sam, { sentryOrganization: "other", sentryToken: OTHER_TOKEN })).status,
    ).toBe(200);
    expect(lastAudit("watchdog.settings")[1]).toMatchObject({ organizationChanged: "given_again" });
    expect((await patch(olga, { sentryOrganization: "acme" })).status).toBe(200);
  });

  test("another address for a host: the same, and the new machine can be pinned with the change", async () => {
    const made = await o.send(WATCHDOG_HOSTS_API_PATH, "POST", ada, {
      label: "prod-2",
      host: "prod-2.example.com",
      username: "watchdog",
      privateKey: TEST_PRIVATE_KEY,
      hostKey: `prod-2.example.com ${FIRST_HOST_KEY}`,
      apps: [{ name: "api", operationId: APOLLO }],
    });
    const second = ((await made.json()) as WatchdogHostView).id;
    const moved = { label: "prod-2", host: "elsewhere.example.com", apps: [{ name: "api" }] };
    // Whoever controls the new address would supply what those rooms are told.
    credentialRequired(await answer(await putHost(sam, moved, second)));
    credentialRequired(
      await answer(
        await putHost(ada, { ...moved, host: "prod-2.example.com", port: 2222 }, second),
      ),
    );
    expect(o.watchdog.store.host(second)).toMatchObject({
      host: "prod-2.example.com",
      port: 22,
      hostKey: FIRST_HOST_KEY,
    });
    // With the key, and the new machine's own key given: pinned at once.
    const pinned = await putHost(
      ada,
      {
        ...moved,
        privateKey: TEST_PRIVATE_KEY,
        hostKey: `elsewhere.example.com ${OTHER_HOST_KEY}`,
      },
      second,
    );
    expect(await answer(pinned)).toEqual([
      200,
      expect.objectContaining({ pinned: fingerprints(OTHER_HOST_KEY), pinnedBy: "given" }),
    ]);
    expect(lastAudit("watchdog.host_save")[1]).toMatchObject({
      moved: true,
      pin: "given",
      onStoredKey: "given_again",
    });
    // The owner, with no key for the new machine: not yet verified, first contact will be trusted.
    const unpinned = await putHost(olga, { ...moved, host: "third.example.com" }, second);
    expect(await answer(unpinned)).toEqual([
      200,
      expect.objectContaining({ pinned: [], pinnedBy: "none" }),
    ]);
    expect(lastAudit("watchdog.host_save")[1]).toMatchObject({
      moved: true,
      pin: "first_contact",
      pinCleared: true,
      onStoredKey: "owner",
    });
    await o.send(`${WATCHDOG_HOSTS_API_PATH}/${second}`, "DELETE", ada);
    expect(o.watchdog.store.host(second)).toBeUndefined();
  });
});

describe("accepting a host's new key", () => {
  test("is refused when the office could not read which key the host shows; the pin stays", async () => {
    o.db.$client.run(
      `update watchdog_hosts set host_key = '${FIRST_HOST_KEY}', host_key_source = 'learned', offered_host_key = '', offered_at = ${Date.now()} where id = '${hostId}'`,
    );
    const res = await o.send(watchdogHostKeyPath(hostId), "POST", ada);
    expect(await answer(res)).toEqual([
      409,
      {
        error: "nothing_offered",
        message:
          "the host showed another key, but the office could not read which; there is nothing to accept yet",
      },
    ]);
    expect(o.watchdog.store.host(hostId)).toMatchObject({
      hostKey: FIRST_HOST_KEY,
      hostKeySource: "learned",
    });
  });
});
