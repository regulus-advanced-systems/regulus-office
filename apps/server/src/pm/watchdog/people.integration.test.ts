/**
 * What people may do with the watchdog (#253, D30), over a real office server:
 * who sets it up and what they are shown of it, that its keys only go in, and
 * what the watchdog can and cannot do in a conversation with a person.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  OFFICE_AGENTS_API_PATH,
  WATCHDOG_API_PATH,
  WATCHDOG_HOSTS_API_PATH,
  WATCHDOG_ROUNDS_API_PATH,
  WATCHDOG_SENTRY_PROJECTS_API_PATH,
  WATCHDOG_SETTINGS_API_PATH,
  type WatchdogFindingView,
  type WatchdogHostView,
  type WatchdogSettingsView,
} from "@regulus/protocol";
import { auditLog, officeAgents, watchdogFindings, watchdogHosts } from "../../db/schema/index.ts";
import { APOLLO, BOREALIS } from "../test-helpers.ts";
import {
  type CheckResult,
  judging,
  STACK,
  TEST_PRIVATE_KEY,
  TEST_SENTRY_TOKEN,
  type WatchdogOffice,
  watchdogOffice,
} from "./testing/kit.ts";

setDefaultTimeout(60_000);

let o: WatchdogOffice;
let hostId: string;

beforeAll(async () => {
  o = await watchdogOffice();
}, 60_000);
afterAll(() => o.stopAll());

const HOST = {
  label: "prod-1",
  host: "prod-1.example.com",
  username: "watchdog",
  privateKey: TEST_PRIVATE_KEY,
  apps: [{ name: "api", operationId: APOLLO }, { name: "worker" }],
};
const get = async <T>(path: string, cookie: string) =>
  (await (await o.send(path, "GET", cookie)).json()) as T;
const settingsOf = (cookie: string) =>
  get<WatchdogSettingsView>(WATCHDOG_SETTINGS_API_PATH, cookie);
const audits = () =>
  o.db
    .select()
    .from(auditLog)
    .all()
    .filter((a) => a.targetKind === "watchdog");
const errorOf = (r: { ok: boolean; error?: string }) => (r.ok ? "ok" : r.error);

describe("setting the watchdog up", () => {
  test("is for office owners and admins; a member is refused everywhere", async () => {
    const mia = o.people.mia.cookie;
    for (const [method, path, body] of [
      ["GET", WATCHDOG_SETTINGS_API_PATH, undefined],
      ["PATCH", WATCHDOG_SETTINGS_API_PATH, { enabled: true }],
      ["PUT", WATCHDOG_SENTRY_PROJECTS_API_PATH, { projects: [] }],
      ["POST", WATCHDOG_HOSTS_API_PATH, HOST],
      ["POST", WATCHDOG_ROUNDS_API_PATH, undefined],
    ] as const) {
      const res = await o.send(path, method, mia, body);
      expect([method, path, res.status]).toEqual([method, path, 403]);
      expect(await res.json()).toEqual({ error: "owner_or_admin_required" });
    }
    expect((await o.send(WATCHDOG_API_PATH, "GET", "")).status).toBe(401);
    // A write from another site is refused before anything is read.
    const evil = await o.send(
      WATCHDOG_SETTINGS_API_PATH,
      "PATCH",
      o.people.ada.cookie,
      { enabled: true },
      "https://evil.example",
    );
    expect(evil.status).toBe(403);
  });

  test("the SSH key and the Sentry token go in and never come out", async () => {
    hostId = (await o.configure()).id;
    const settings = await settingsOf(o.people.ada.cookie);
    expect(settings.sentry).toMatchObject({
      organization: "acme",
      hasToken: true,
      host: "sentry.io",
    });
    expect(settings.hosts[0]).toMatchObject({
      label: "prod-1",
      hasKey: true,
      port: 22,
      pinned: [],
    });
    expect(settings.agents).toEqual([{ id: o.agent.id, name: "Cerberus" }]);
    expect(settings).toMatchObject({
      intervalMinutes: 60,
      fixMode: "ask",
      autoFixBy: null,
      autoFixPerRound: 1,
      autoFixPerDay: 3,
    });
    // Not in any response, and not in the database as it was typed.
    const row = o.db.select().from(watchdogHosts).get();
    for (const text of [JSON.stringify(settings), JSON.stringify(row), JSON.stringify(audits())]) {
      expect(text).not.toContain("PRIVATE KEY");
      expect(text).not.toContain("FAKEFAKE");
      expect(text).not.toContain(TEST_SENTRY_TOKEN);
    }
    expect(audits().map((a) => a.action)).toEqual([
      "watchdog.settings",
      "watchdog.sentry_projects",
      "watchdog.host_save",
    ]);
    // Which fields changed, never their values.
    expect(JSON.parse(audits()[0]?.metaJson ?? "{}")).toEqual({
      fields: ["agentId", "enabled", "sentryOrganization", "sentryToken"],
    });
    // The stored key is the one that was typed, readable only with the master key.
    expect(o.watchdog.store.hostKey(row as never).reveal()).toBe(`${TEST_PRIVATE_KEY}\n`);
    expect(o.watchdog.store.sentryToken()?.reveal()).toBe(TEST_SENTRY_TOKEN);
  });

  test("changing the Sentry host removes the stored token, and the audit log says so", async () => {
    const ada = o.people.ada.cookie;
    const moved = await o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", ada, {
      sentryHost: "sentry.attacker.example",
    });
    // The token was typed for sentry.io: it is never sent to another host.
    expect(((await moved.json()) as WatchdogSettingsView).sentry).toMatchObject({
      host: "sentry.attacker.example",
      hasToken: false,
    });
    expect(o.watchdog.store.sentryToken()).toBeNull();
    expect(JSON.parse(audits().at(-1)?.metaJson ?? "{}")).toEqual({
      fields: ["sentryHost"],
      tokenCleared: true,
    });
    // The same host again clears nothing; a new host with a token keeps that token.
    const back = await o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", ada, {
      sentryHost: "sentry.io",
      sentryToken: TEST_SENTRY_TOKEN,
    });
    expect(((await back.json()) as WatchdogSettingsView).sentry.hasToken).toBe(true);
    await o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", ada, { sentryHost: "sentry.io" });
    expect(o.watchdog.store.sentryToken()?.reveal()).toBe(TEST_SENTRY_TOKEN);
    expect("tokenCleared" in JSON.parse(audits().at(-1)?.metaJson ?? "{}")).toBe(false);
  });

  test("a change keeps the stored key unless a new one is given; a new host needs one", async () => {
    const { privateKey: _key, ...withoutKey } = HOST;
    const before = o.db.select().from(watchdogHosts).get()?.encryptedKey;
    const changed = await o.send(
      `${WATCHDOG_HOSTS_API_PATH}/${hostId}`,
      "PUT",
      o.people.ada.cookie,
      {
        ...withoutKey,
        label: "production",
      },
    );
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as WatchdogHostView).label).toBe("production");
    expect(o.db.select().from(watchdogHosts).get()?.encryptedKey).toBe(before as string);
    const keyless = await o.send(WATCHDOG_HOSTS_API_PATH, "POST", o.people.ada.cookie, withoutKey);
    expect([keyless.status, await keyless.json()]).toEqual([
      400,
      { error: "private_key_required" },
    ]);
    // A host name that would be read as an ssh option, and an app name with a shell in it.
    for (const bad of [
      { ...HOST, host: "-oProxyCommand=evil" },
      { ...HOST, apps: [{ name: "api; rm -rf /" }] },
      { ...HOST, username: "root;id" },
      { ...HOST, privateKey: "not a key" },
    ]) {
      const res = await o.send(WATCHDOG_HOSTS_API_PATH, "POST", o.people.ada.cookie, bad);
      expect(res.status).toBe(400);
    }
  });

  test("a target goes only into a room the admin can see; a hidden room is not named and cannot be changed (D26, D27)", async () => {
    // Olga owns the office and has linked no GitHub account: she sees no room.
    const olga = o.people.olga.cookie;
    const put = (cookie: string, projects: unknown) =>
      o.send(WATCHDOG_SENTRY_PROJECTS_API_PATH, "PUT", cookie, { projects });
    const refused = await put(olga, [{ slug: "web" }, { slug: "api", operationId: BOREALIS }]);
    expect([refused.status, await refused.json()]).toEqual([404, { error: "no_such_room" }]);
    // A room that does not exist answers the same.
    const none = await put(o.people.ada.cookie, [
      { slug: "web" },
      { slug: "x", operationId: "op-nowhere" },
    ]);
    expect([none.status, await none.json()]).toEqual([404, { error: "no_such_room" }]);

    const forOlga = await settingsOf(olga);
    expect(forOlga.sentry.projects).toEqual([
      {
        id: expect.any(String),
        slug: "web",
        operationId: null,
        operationHidden: true,
        watched: true,
      },
    ]);
    expect(forOlga.hosts[0]?.apps.map((a) => [a.name, a.operationId, a.operationHidden])).toEqual([
      ["api", null, true],
      ["worker", null, false],
    ]);
    expect(JSON.stringify(forOlga)).not.toContain(APOLLO);
    // She can neither take the room away from a target she cannot see into, nor move it.
    for (const operationId of [null, "op-nowhere"]) {
      const res = await put(olga, [{ slug: "web", operationId }]);
      expect([res.status, await res.json()]).toEqual([403, { error: "room_not_yours" }]);
    }
    const { privateKey: _key, ...host } = HOST;
    const unmap = await o.send(`${WATCHDOG_HOSTS_API_PATH}/${hostId}`, "PUT", olga, {
      ...host,
      apps: [{ name: "api", operationId: null }, { name: "worker" }],
    });
    expect([unmap.status, await unmap.json()]).toEqual([403, { error: "room_not_yours" }]);
    // Saving what she was shown keeps the rooms she cannot see as they are.
    expect((await put(olga, [{ slug: "web" }])).status).toBe(200);
    expect(o.watchdog.store.sentryProjects().map((p) => p.operationId)).toEqual([APOLLO]);
    expect(o.watchdog.store.apps().map((a) => [a.name, a.operationId])).toEqual([
      ["api", APOLLO],
      ["worker", null],
    ]);
    // Ada sees Apollo and may move its target.
    expect((await put(o.people.ada.cookie, [{ slug: "web", operationId: BOREALIS }])).status).toBe(
      200,
    );
    expect((await put(o.people.ada.cookie, [{ slug: "web", operationId: APOLLO }])).status).toBe(
      200,
    );
  });

  test("only a shared watchdog that runs as a Claude Code session can be chosen", async () => {
    const pm = await o.send(OFFICE_AGENTS_API_PATH, "POST", o.people.ada.cookie, {
      name: "Moneypenny",
      owner: "office",
      engine: "cli-session",
      role: "pm",
      provider: "claude-code",
      model: "sonnet",
      profileId: "office:claude-code",
    });
    const pmId = ((await pm.json()) as { id: string }).id;
    const patch = (agentId: string) =>
      o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", o.people.ada.cookie, { agentId });
    const wrongJob = await patch(pmId);
    expect([wrongJob.status, await wrongJob.json()]).toEqual([400, { error: "not_a_watchdog" }]);
    // A watchdog on Hermes: a turn of the office's own is only honoured by the session engine.
    const row = o.officeAgents.store.get(o.agent.id);
    if (!row) throw new Error("no agent");
    o.db
      .insert(officeAgents)
      .values({
        ...row,
        id: "hermes-dog",
        name: "Fenrir",
        nameKey: "fenrir",
        engine: "hermes-managed",
      })
      .run();
    const hermes = await patch("hermes-dog");
    expect(hermes.status).toBe(400);
    expect(await hermes.json()).toEqual({
      error: "engine_not_supported",
      message:
        "the watchdog must run as a Claude Code session in the office: a Hermes agent cannot do rounds",
    });
    expect((await settingsOf(o.people.ada.cookie)).agents).toEqual([
      { id: o.agent.id, name: "Cerberus" },
    ]);
    // The watchdog's tools do not exist for another agent, and it wears its own kit.
    const { token } = (await (
      await o.send(`${OFFICE_AGENTS_API_PATH}/${pmId}/tokens`, "POST", o.people.ada.cookie, {
        label: "test",
      })
    ).json()) as { token: string };
    for (const name of ["watchdog_check", "watchdog_request_round", "watchdog_read_report"]) {
      expect((await o.tool(token, name, { onBehalfOf: o.people.ada.id })).body).toMatchObject({
        ok: false,
        error: "unknown_tool",
      });
    }
    expect(o.agent.appearance).toBe("black_ops");
  });
});

describe("the watchdog in a conversation", () => {
  const say = async (cookie: string, text: string) => {
    const res = await o.send(`${OFFICE_AGENTS_API_PATH}/${o.agent.id}/messages`, "POST", cookie, {
      text,
    });
    expect(res.status).toBeLessThan(300);
    await o.settled();
    await o.fake.idle();
  };

  test("has its two tools and no others: nothing of a round, no memory, no chat, no question", async () => {
    await o.setApps([
      { name: "api", log: STACK },
      { name: "worker", status: "errored" },
    ]);
    let tools: string[] = [];
    const got: Record<string, string | undefined> = {};
    o.setScript(async (turn) => {
      if (turn.round) return "done";
      tools = await turn.tools();
      for (const [name, input] of [
        ["watchdog_check", {}],
        [
          "watchdog_record_finding",
          { title: "x", sources: [{ key: "pm2:a:err:b" }], disposition: "notify", reason: "x" },
        ],
        ["watchdog_finish_round", { summary: "x" }],
        ["memory_save", { text: "the api is down" }],
        ["note_write", { title: "t", text: "x" }],
        ["ask_human", { question: "?", userId: o.people.sam.id }],
        ["list_operations", {}],
      ] as const) {
        got[name] = errorOf(await turn.call(name, input));
      }
      return "I can read you your report.";
    });
    await say(o.people.mia.cookie, "what can you do?");
    expect(tools.sort()).toEqual(["watchdog_read_report", "watchdog_request_round"]);
    // The token of its engine run, outside any turn, opens nothing at all (#301).
    const run = o.fake.started.get(o.agent.id)?.office.token.reveal() ?? "";
    for (const name of ["watchdog_read_report", "watchdog_request_round", "watchdog_check"]) {
      expect((await o.tool(run, name)).body).toMatchObject({ ok: false, error: "forbidden" });
    }
    expect(got).toEqual({
      watchdog_check: "unknown_tool",
      watchdog_record_finding: "unknown_tool",
      watchdog_finish_round: "unknown_tool",
      memory_save: "unknown_tool",
      note_write: "unknown_tool",
      ask_human: "unknown_tool",
      list_operations: "unknown_tool",
    });
  });

  test("a round is asked for by who may set the watchdog up; it runs in turns of the office's own", async () => {
    const asked: Record<string, unknown> = {};
    const roundTurns: string[][] = [];
    o.setScript(async (turn) => {
      if (turn.round) {
        return judging(
          () => ({}),
          (check: CheckResult) => void roundTurns.push(check.signals.map((s) => s.from)),
        )(turn);
      }
      const who = turn.message.userId;
      // The tools take no person: the office knows whose turn this is from its token. Naming
      // an admin gets a member nothing.
      asked[who] = await turn.call("watchdog_request_round", { onBehalfOf: o.people.ada.id });
      return "ok";
    });
    // A member: reading their report is theirs, asking for a round is not.
    await say(o.people.mia.cookie, "do a round now please");
    expect(asked[o.people.mia.id]).toMatchObject({ ok: false, error: "forbidden" });
    expect(o.watchdog.parts.rounds(5)).toEqual([]);
    // An admin, while the watchdog is switched off: nothing starts.
    const ada = o.people.ada.cookie;
    await o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", ada, { enabled: false });
    await say(ada, "do a round now");
    expect(asked[o.people.ada.id]).toMatchObject({
      ok: true,
      result: { started: false, note: "No round was started: the watchdog is switched off." },
    });
    expect(o.watchdog.parts.rounds(5)).toEqual([]);
    // Switched on: the round runs, one turn per room, and the audit log says who asked.
    await o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", ada, { enabled: true });
    await say(ada, "do a round now");
    expect(asked[o.people.ada.id]).toMatchObject({ ok: true, result: { started: true } });
    expect(o.watchdog.parts.rounds(5).map((r) => [r.trigger, r.state, r.requestedBy])).toEqual([
      ["chat", "done", o.people.ada.id],
    ]);
    expect(roundTurns).toEqual([["PM2"], ["PM2", "PM2"]]);
    const request = audits().filter((a) => a.action === "watchdog.round_request");
    expect(request.map((a) => [a.userId, JSON.parse(a.metaJson)])).toEqual([
      [o.people.ada.id, { via: "chat" }],
    ]);
    expect(o.db.select().from(watchdogFindings).all().length).toBe(3);
  });

  test("asked how production is doing, it reads a person what that person may see", async () => {
    const read: Record<string, { findings: WatchdogFindingView[] }> = {};
    o.setScript(async (turn) => {
      const who = turn.message.userId;
      // Everyone names the owner; each still gets what they themselves may see.
      read[who] = await turn.ok("watchdog_read_report", { onBehalfOf: o.people.olga.id });
      return "Here is your report.";
    });
    await say(o.people.mia.cookie, "how is production?");
    await say(o.people.olga.cookie, "how is production?");
    await say(o.people.sam.cookie, "how is production?");
    const labels = (id: string) =>
      read[id]?.findings.flatMap((f) => f.sources.map((s) => s.label)).sort();
    expect(labels(o.people.mia.id)).toEqual(["api on production", "api on production"]);
    expect(labels(o.people.olga.id)).toEqual(["worker on production"]);
    expect(labels(o.people.sam.id)).toEqual([]);
    expect(JSON.stringify(read[o.people.mia.id])).not.toContain("worker");
  });

  test("the button asks for the same round; a second one while it runs is refused", async () => {
    let inside: Response | undefined;
    o.setScript(async (turn) => {
      await turn.ok("watchdog_check");
      inside ??= await o.send(WATCHDOG_ROUNDS_API_PATH, "POST", o.people.ada.cookie);
      await turn.ok("watchdog_finish_round", { summary: "quiet" });
      return "done";
    });
    const res = await o.send(WATCHDOG_ROUNDS_API_PATH, "POST", o.people.ada.cookie);
    expect(res.status).toBe(202);
    await o.settled();
    expect([inside?.status, await inside?.json()]).toEqual([
      409,
      { error: "conflict", message: "a round is already under way" },
    ]);
    const [last] = o.watchdog.parts.rounds(1);
    expect(last).toMatchObject({ trigger: "manual", state: "done", requestedBy: o.people.ada.id });
    expect(JSON.parse(audits().at(-1)?.metaJson ?? "{}")).toEqual({ via: "button" });
  });
});
