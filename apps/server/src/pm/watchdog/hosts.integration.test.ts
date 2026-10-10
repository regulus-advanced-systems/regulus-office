/**
 * A watched host's keys (#253), over a real office server and the real SSH
 * probe with stand-ins for `ssh` and `ssh-keyscan`:
 *
 * - the SSH private key is on the runner's volume only while a check runs;
 * - the host's own key is stored on first contact and held to from then on;
 *   a host that shows another key fails its check and the people who run the
 *   office are told; only an admin's explicit acceptance replaces the pin.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  WATCHDOG_HOSTS_API_PATH,
  WATCHDOG_SETTINGS_API_PATH,
  type WatchdogHostView,
  type WatchdogSettingsView,
  watchdogHostKeyPath,
} from "@regulus/protocol";
import { auditLog, watchdogHosts } from "../../db/schema/index.ts";
import { fingerprints } from "./hostkey.ts";
import {
  type CheckResult,
  FIRST_HOST_KEY,
  judging,
  OTHER_HOST_KEY,
  TEST_PRIVATE_KEY,
  type WatchdogOffice,
  watchdogOffice,
} from "./testing/kit.ts";

setDefaultTimeout(60_000);

let o: WatchdogOffice;
let hostId: string;
const APPS = [{ name: "api" }, { name: "worker" }];
/** What each turn was told it could not read. */
const notRead: string[][] = [];
const quiet = judging(
  () => null,
  (check: CheckResult) => void notRead.push(check.notRead),
);

beforeAll(async () => {
  o = await watchdogOffice();
  hostId = (await o.configure()).id;
  await o.setApps(APPS);
  o.setScript(quiet);
}, 60_000);
afterAll(() => o.stopAll());

const host = () => o.db.select().from(watchdogHosts).get();
const view = async (cookie = o.people.ada.cookie) =>
  ((await (await o.send(WATCHDOG_SETTINGS_API_PATH, "GET", cookie)).json()) as WatchdogSettingsView)
    .hosts[0] as WatchdogHostView;
const HOST = { label: "prod-1", host: "prod-1.example.com", username: "watchdog" };

describe("the SSH key on the runner's volume", () => {
  test("is there while a check runs and gone when it ends", async () => {
    expect(await o.keyFolderExists()).toBe(false);
    expect((await o.round()).round?.state).toBe("done");
    const calls = await o.sshCalls();
    // It was a 0600 file while ssh ran, and never on argv or in the environment.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.key?.mode).toBe("600");
      expect(call.argv.join(" ")).not.toContain("PRIVATE KEY");
      expect(call.env.filter((name) => /KEY|TOKEN|SECRET/.test(name))).toEqual([]);
    }
    expect(calls.map((c) => c.remote.slice(0, 2).join(" ")).sort()).toEqual([
      "pm2 jlist",
      "pm2 jlist",
      "pm2 logs",
      "pm2 logs",
    ]);
    expect(await o.keyFolderExists()).toBe(false);
  });

  test("is gone after a check that fails, too", async () => {
    await o.send(`${WATCHDOG_HOSTS_API_PATH}/${hostId}`, "PUT", o.people.ada.cookie, {
      ...HOST,
      host: "unreachable.test",
      // Ada is an admin, not the owner: another address needs the key again.
      privateKey: TEST_PRIVATE_KEY,
      apps: APPS.map((a) => ({ name: a.name })),
    });
    notRead.length = 0;
    expect((await o.round()).round?.state).toBe("done");
    expect(notRead.flat()).toEqual([
      "prod-1: the connection was refused",
      "prod-1: the connection was refused",
    ]);
    expect(await o.keyFolderExists()).toBe(false);
    // What could not be read is told to who may see that room, as the office's own words.
    const res = await o.send("/api/watchdog", "GET", o.people.olga.cookie);
    const report = (await res.json()) as { rounds: Array<{ summaries: string[] }> };
    expect(report.rounds[0]?.summaries).toContain("Not read: prod-1: the connection was refused");
    const back = await o.send(`${WATCHDOG_HOSTS_API_PATH}/${hostId}`, "PUT", o.people.ada.cookie, {
      ...HOST,
      privateKey: TEST_PRIVATE_KEY,
      apps: APPS.map((a) => ({ name: a.name })),
    });
    expect(back.status).toBe(200);
  });
});

describe("the host's own key", () => {
  test("is stored on first contact, shown as a fingerprint, and held to from then on", async () => {
    // The address was changed and changed back above: another address is another machine.
    expect(host()).toMatchObject({ hostKey: "", hostKeySource: "none" });
    await o.round();
    expect(host()).toMatchObject({ hostKey: FIRST_HOST_KEY, hostKeySource: "learned" });
    expect(await view()).toMatchObject({
      pinned: fingerprints(FIRST_HOST_KEY),
      pinnedBy: "learned",
      offered: [],
    });
    expect((await view()).pinned[0]).toMatch(/^ssh-ed25519 SHA256:[A-Za-z0-9+/]{43}$/);
    // From now on: StrictHostKeyChecking=yes, with exactly the pin.
    const before = (await o.sshCalls()).length;
    await o.round();
    const calls = (await o.sshCalls()).slice(before);
    for (const call of calls) {
      expect(call.argv).toContain("StrictHostKeyChecking=yes");
      expect(call.knownHosts.trim()).toBe(`prod-1.example.com ${FIRST_HOST_KEY}`);
    }
  });

  test("saving the host does not drop the pin, and a pin cannot be slipped in with a save", async () => {
    const res = await o.send(`${WATCHDOG_HOSTS_API_PATH}/${hostId}`, "PUT", o.people.ada.cookie, {
      ...HOST,
      label: "prod-1",
      privateKey: TEST_PRIVATE_KEY,
      hostKey: `prod-1.example.com ${OTHER_HOST_KEY}`,
      apps: APPS.map((a) => ({ name: a.name })),
    });
    expect(res.status).toBe(200);
    expect(host()).toMatchObject({ hostKey: FIRST_HOST_KEY, hostKeySource: "learned" });
  });

  test("a host that shows another key fails its check, and the people who run the office are told", async () => {
    await o.setApps(APPS, OTHER_HOST_KEY);
    notRead.length = 0;
    await o.round();
    expect(notRead.flat()).toEqual([
      "prod-1: the host shows another key than the one that is pinned; an admin has to look",
      "prod-1: the host shows another key than the one that is pinned; an admin has to look",
    ]);
    // The pin stands; what the host showed is kept beside it.
    expect(host()).toMatchObject({ hostKey: FIRST_HOST_KEY, offeredHostKey: OTHER_HOST_KEY });
    expect(await view()).toMatchObject({
      pinned: fingerprints(FIRST_HOST_KEY),
      offered: fingerprints(OTHER_HOST_KEY),
    });
    // Told once, to owners and admins only.
    expect(o.alerts.map((a) => [a.userId, a.payload.kind, a.payload.hostLabel]).sort()).toEqual(
      [
        [o.people.ada.id, "host_key_changed", "prod-1"],
        [o.people.olga.id, "host_key_changed", "prod-1"],
      ].sort(),
    );
    await o.round();
    expect(o.alerts.length).toBe(2);
    expect(await o.keyFolderExists()).toBe(false);
  });

  test("only an admin's explicit acceptance replaces the pin, and it is audited", async () => {
    const member = await o.send(watchdogHostKeyPath(hostId), "POST", o.people.mia.cookie);
    expect(member.status).toBe(403);
    expect(host()?.hostKey).toBe(FIRST_HOST_KEY);
    const res = await o.send(watchdogHostKeyPath(hostId), "POST", o.people.ada.cookie);
    expect(res.status).toBe(200);
    expect((await res.json()) as WatchdogHostView).toMatchObject({
      pinned: fingerprints(OTHER_HOST_KEY),
      pinnedBy: "accepted",
      offered: [],
    });
    const audit = o.db
      .select()
      .from(auditLog)
      .all()
      .filter((a) => a.action === "watchdog.host_key_accept");
    expect(audit.map((a) => [a.userId, JSON.parse(a.metaJson)])).toEqual([
      [o.people.ada.id, { from: fingerprints(FIRST_HOST_KEY), to: fingerprints(OTHER_HOST_KEY) }],
    ]);
    // Nothing is offered now: a second acceptance has nothing to accept.
    const again = await o.send(watchdogHostKeyPath(hostId), "POST", o.people.ada.cookie);
    expect([again.status, await again.json()]).toEqual([409, { error: "nothing_offered" }]);
    // The host is read again.
    notRead.length = 0;
    expect((await o.round()).round?.state).toBe("done");
    expect(notRead.flat()).toEqual([]);
  });

  test("a key given with a new host is its pin from the first contact", async () => {
    const res = await o.send(WATCHDOG_HOSTS_API_PATH, "POST", o.people.ada.cookie, {
      label: "prod-2",
      host: "prod-2.example.com",
      username: "watchdog",
      privateKey: TEST_PRIVATE_KEY,
      hostKey: `prod-2.example.com ${FIRST_HOST_KEY}`,
      apps: [{ name: "api" }],
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as WatchdogHostView).toMatchObject({
      pinned: fingerprints(FIRST_HOST_KEY),
      pinnedBy: "given",
    });
    // The stand-in host shows the other key: the given pin refuses it at once.
    notRead.length = 0;
    await o.round();
    expect(notRead.flat().filter((line) => line.startsWith("prod-2"))).toEqual([
      "prod-2: the host shows another key than the one that is pinned; an admin has to look",
    ]);
  });
});
