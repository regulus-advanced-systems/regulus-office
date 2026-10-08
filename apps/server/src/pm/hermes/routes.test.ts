/**
 * A person's Hermes in the office, over a real server with sessions and the
 * fake Hermes gateway (#58): creating the agent with its connection, talking
 * to it, who may use or read the connection (its owner, nobody else), and
 * that the address and the token appear in no response, log, audit entry or
 * stored row.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type HermesConnectionTestResult,
  OFFICE_AGENT_HERMES_TEST_API_PATH,
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentConversation,
  type OfficeAgentsResponse,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
  officeAgentHermesPath,
} from "@regulus/protocol";
import { auditLog, officeAgentConnections, officeAgents } from "../../db/schema/index.ts";
import { type AgentsOffice, APOLLO, agentsOffice, BOREALIS } from "../test-helpers.ts";
import { HERMES_TESTS_PER_MINUTE } from "./service.ts";
import { FakeHermesGateway } from "./testing/fake-gateway.ts";

let o: AgentsOffice;
let mias: FakeHermesGateway;
let sams: FakeHermesGateway;
/** Everything any response said, to search for leaks at the end. */
const responses: string[] = [];

beforeAll(async () => {
  o = await agentsOffice({
    hermes: {
      healthIntervalMs: 25,
      backoffBaseMs: 5,
      backoffMaxMs: 25,
      sendAttempts: 2,
      client: { requestTimeoutMs: 500, streamIdleMs: 500 },
    },
  });
  mias = new FakeHermesGateway({ key: "mia-hermes-key-SECRET-0123456789" }).up();
  sams = new FakeHermesGateway({ key: "sam-hermes-key-SECRET-0123456789" }).up();
});
afterAll(async () => {
  await o.stop();
  await mias.down();
  await sams.down();
});

const A = OFFICE_AGENTS_API_PATH;
async function call<T>(path: string, method: string, cookie: string, body?: unknown) {
  const res = await o.send(path, method, cookie, body);
  const text = await res.text();
  responses.push(text);
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T & { error?: string } };
}
const hermesAgent = (name: string, gateway: FakeHermesGateway, extra: object = {}) => ({
  name,
  owner: "me",
  engine: "hermes-external",
  role: "pm",
  // Whatever the form sends here is not used: Hermes brings its own model.
  provider: "claude-code",
  model: "sonnet",
  hermes: { url: gateway.url, token: gateway.key },
  ...extra,
});
const test_ = (cookie: string, body: unknown) =>
  call<HermesConnectionTestResult>(OFFICE_AGENT_HERMES_TEST_API_PATH, "POST", cookie, body);
const conversation = async (cookie: string, id: string) =>
  (await call<OfficeAgentConversation>(`${A}/${id}/conversation`, "GET", cookie)).body;
async function reply(cookie: string, id: string) {
  const deadline = Date.now() + 3000;
  for (;;) {
    const c = await conversation(cookie, id);
    // An answer, or a system line saying why there is none.
    if (c.messages.length > 1 && c.messages.at(-1)?.author !== "person") return c;
    if (Date.now() > deadline) throw new Error("no reply in time");
    await Bun.sleep(10);
  }
}

describe("a person's own Hermes as an office agent", () => {
  let agent: OfficeAgentView;

  test("the engine is offered, and trying a connection says what is wrong in plain words", async () => {
    const list = await call<OfficeAgentsResponse>(A, "GET", o.people.mia.cookie);
    expect(list.body.engines).toContain("hermes-external");

    const ok = await test_(o.people.mia.cookie, { url: mias.url, token: mias.key });
    expect(ok.body).toEqual({
      ok: true,
      code: "connected",
      detail: "Connected to Hermes 0.21.5.",
      version: "0.21.5",
    });
    const bad = await test_(o.people.mia.cookie, { url: mias.url, token: "not-the-right-key" });
    expect(bad.body).toMatchObject({ ok: false, code: "bad_token" });
    const nothing = await test_(o.people.mia.cookie, {
      url: "http://127.0.0.1:1",
      token: mias.key,
    });
    expect(nothing.body).toMatchObject({ ok: false, code: "unreachable" });
    // Not an address the office will call, and never with a password in it.
    for (const url of [
      "file:///etc/passwd",
      "http://user:pw@host:8642",
      "http://169.254.169.254",
    ]) {
      expect((await test_(o.people.mia.cookie, { url, token: mias.key })).status).toBe(400);
    }
  });

  test("it is created with its connection, which is stored encrypted and never sent back", async () => {
    const made = await call<OfficeAgentView>(
      A,
      "POST",
      o.people.mia.cookie,
      hermesAgent("Hermes", mias),
    );
    expect(made.status).toBe(201);
    agent = made.body;
    expect(agent).toMatchObject({
      engine: "hermes-external",
      owner: { kind: "user", userId: o.people.mia.id },
      model: "hermes",
      provider: "custom",
      canTalk: true,
      canConfigure: true,
    });
    expect(agent.config?.hermes).toMatchObject({ connected: true, continuesSession: false });
    const row = o.db.select().from(officeAgentConnections).all()[0];
    expect(row?.ownerUserId).toBe(o.people.mia.id);
    expect(row?.encryptedSecret).not.toContain(mias.key);
    expect(row?.encryptedSecret).not.toContain("127.0.0.1");
  });

  test("without a connection, or as a shared agent, it is refused and nothing is left behind", async () => {
    const before = o.db.select().from(officeAgents).all().length;
    const { hermes: _none, ...bare } = hermesAgent("No connection", mias);
    expect((await call(A, "POST", o.people.mia.cookie, bare)).body.error).toBe(
      "hermes_connection_required",
    );
    const shared = await call(A, "POST", o.people.olga.cookie, {
      ...hermesAgent("Office Hermes", mias),
      owner: "office",
    });
    expect(shared.status).toBe(400);
    expect(shared.body.error).toBe("personal_only");
    expect(o.db.select().from(officeAgents).all().length).toBe(before);
  });

  test("its owner talks to it in the office, and the message reaches their Hermes", async () => {
    const sent = await call(`${A}/${agent.id}/messages`, "POST", o.people.mia.cookie, {
      text: "What did we decide yesterday?",
    });
    expect(sent.status).toBe(202);
    const c = await reply(o.people.mia.cookie, agent.id);
    expect(c.messages.map((m) => [m.author, m.text])).toEqual([
      ["person", "What did we decide yesterday?"],
      ["agent", "Hermes heard: What did we decide yesterday?"],
    ]);
    expect(mias.received()).toEqual(["What did we decide yesterday?"]);
    // Sam's Hermes heard nothing.
    expect(sams.received()).toEqual([]);
    const mine = (await call<OfficeAgentsResponse>(A, "GET", o.people.mia.cookie)).body.agents;
    expect(mine.find((a) => a.id === agent.id)?.status).toBe("ready");
  });

  test("its Hermes uses the office tools with an access code, with its owner's rights only", async () => {
    const minted = await call<OfficeAgentTokenCreated>(
      `${A}/${agent.id}/tokens`,
      "POST",
      o.people.mia.cookie,
      { label: "My Hermes" },
    );
    expect(minted.status).toBe(201);
    // What Hermes would do through its `mcp_servers.office` entry, here over the REST twin.
    const operations = await o.tool(minted.body.token, "list_operations");
    expect(operations.status).toBe(200);
    // Mia is in Apollo and not in Borealis; so is her Hermes.
    expect(JSON.stringify(operations.body)).toContain("Apollo");
    expect(JSON.stringify(operations.body)).not.toContain("Borealis");
    // Her rights are her own GitHub permission on each room's repo (#270), read at every call:
    // when GitHub gives her Borealis and takes Apollo away, her Hermes follows at once.
    o.setAccess(BOREALIS, o.people.mia.id, "view");
    const moved = JSON.stringify((await o.tool(minted.body.token, "list_operations")).body);
    expect(moved).toContain("Borealis");
    expect(moved).not.toContain("Apollo");
    o.setAccess(APOLLO, o.people.mia.id, "spawn");
    const back = JSON.stringify((await o.tool(minted.body.token, "list_operations")).body);
    expect(back).toContain("Apollo");
    expect(back).not.toContain("Borealis");
  });

  test("another member cannot see it; an admin and the office owner see its card and nothing of the connection", async () => {
    const sam = o.people.sam.cookie;
    expect((await call(`${A}/${agent.id}/conversation`, "GET", sam)).status).toBe(404);
    expect((await call(`${A}/${agent.id}/messages`, "POST", sam, { text: "hi" })).status).toBe(404);
    expect(
      (await call(officeAgentHermesPath(agent.id), "PUT", sam, { url: sams.url, token: sams.key }))
        .status,
    ).toBe(404);
    expect((await test_(sam, { agentId: agent.id })).status).toBe(404);

    for (const admin of [o.people.ada, o.people.olga]) {
      const seen = (await call<OfficeAgentsResponse>(A, "GET", admin.cookie)).body.agents.find(
        (a) => a.id === agent.id,
      );
      // The card: that it exists, what it runs as and how it is doing.
      expect(seen).toMatchObject({ engine: "hermes-external", status: "ready", canTalk: false });
      expect(seen?.config).toBeUndefined();
      // Not the connection: neither using it, nor trying it, nor replacing it.
      expect(
        (await call(`${A}/${agent.id}/messages`, "POST", admin.cookie, { text: "hi" })).status,
      ).toBe(403);
      expect((await test_(admin.cookie, { agentId: agent.id })).status).toBe(403);
      const hijack = await call(officeAgentHermesPath(agent.id), "PUT", admin.cookie, {
        url: sams.url,
        token: sams.key,
      });
      expect(hijack.status).toBe(403);
      expect(hijack.body.error).toBe("not_your_agent");
    }
    expect(mias.received()).toHaveLength(1);
    expect(sams.received()).toEqual([]);
  });

  test("a connection row moved to another person's agent does not open", async () => {
    const samsAgent = (
      await call<OfficeAgentView>(
        A,
        "POST",
        o.people.sam.cookie,
        hermesAgent("Sams Hermes", sams, { role: "assistant" }),
      )
    ).body;
    const stolen = o.db
      .select()
      .from(officeAgentConnections)
      .all()
      .find((r) => r.agentId === agent.id);
    // As if someone with the database copied Mia's envelope onto Sam's agent.
    o.db.$client.run(
      `update office_agent_connections set encrypted_secret = '${stolen?.encryptedSecret}' where agent_id = '${samsAgent.id}'`,
    );
    const tried = await test_(o.people.sam.cookie, { agentId: samsAgent.id });
    expect(tried.status).toBe(409);
    expect(tried.body.error).toBe("hermes_connection_unreadable");
    const sent = await call(`${A}/${samsAgent.id}/messages`, "POST", o.people.sam.cookie, {
      text: "hi",
    });
    expect(sent.status).toBe(409);
    expect(mias.received()).toHaveLength(1);
    // Sam enters his own again and it works, on his Hermes.
    const fixed = await call(officeAgentHermesPath(samsAgent.id), "PUT", o.people.sam.cookie, {
      url: sams.url,
      token: sams.key,
    });
    expect(fixed.status).toBe(200);
    await call(`${A}/${samsAgent.id}/messages`, "POST", o.people.sam.cookie, {
      text: "hello mine",
    });
    await reply(o.people.sam.cookie, samsAgent.id);
    expect(sams.received()).toEqual(["hello mine"]);
    expect(mias.received()).toHaveLength(1);
  });

  test("an admin may stop it in an emergency; the gateway going away shows on the card", async () => {
    const stopped = await call<OfficeAgentView>(
      `${A}/${agent.id}/stop`,
      "POST",
      o.people.ada.cookie,
    );
    expect(stopped.body.status).toBe("stopped");
    await call(`${A}/${agent.id}/start`, "POST", o.people.mia.cookie);
    await mias.down();
    const deadline = Date.now() + 3000;
    let seen: OfficeAgentView | undefined;
    while (Date.now() < deadline) {
      seen = (await call<OfficeAgentsResponse>(A, "GET", o.people.ada.cookie)).body.agents.find(
        (a) => a.id === agent.id,
      );
      if (seen?.status === "error") break;
      await Bun.sleep(10);
    }
    // The admin view: an error and why, in words that name no address.
    expect(seen?.status).toBe("error");
    expect(seen?.statusReason).toContain("cannot be reached");
    expect(seen?.statusReason).not.toContain("127.0.0.1");

    // A message meanwhile is answered with what happened, not swallowed.
    const sent = await call(`${A}/${agent.id}/messages`, "POST", o.people.mia.cookie, {
      text: "are you there?",
    });
    expect(sent.status).toBe(202);
    const c = await reply(o.people.mia.cookie, agent.id);
    expect(c.messages.at(-1)).toMatchObject({ author: "system" });
    expect(c.messages.at(-1)?.text).toContain("Your message was not sent");

    mias.up();
    const back = Date.now() + 3000;
    while (Date.now() < back) {
      seen = (await call<OfficeAgentsResponse>(A, "GET", o.people.mia.cookie)).body.agents.find(
        (a) => a.id === agent.id,
      );
      if (seen?.status === "ready") break;
      await Bun.sleep(10);
    }
    expect(seen?.status).toBe("ready");
  });

  test("replacing the connection stops the agent; a wrong token then fails in plain words", async () => {
    const replaced = await call<OfficeAgentView>(
      officeAgentHermesPath(agent.id),
      "PUT",
      o.people.mia.cookie,
      {
        url: mias.url,
        token: "an-old-key-that-is-wrong-now",
        sessionId: "20261007_telegram_dm",
      },
    );
    expect(replaced.status).toBe(200);
    expect(replaced.body.status).toBe("stopped");
    expect(replaced.body.config?.hermes).toMatchObject({ connected: true, continuesSession: true });
    const sent = await call<{ message?: string }>(
      `${A}/${agent.id}/messages`,
      "POST",
      o.people.mia.cookie,
      {
        text: "hello?",
      },
    );
    expect(sent.status).toBe(409);
    expect(sent.body.error).toBe("hermes_bad_token");
    expect(sent.body.message).toContain("refused the access token");
    const c = await conversation(o.people.mia.cookie, agent.id);
    expect(c.messages.at(-1)?.text).toContain("Not delivered");
  });

  test("trying connections is limited per person", async () => {
    let last = 200;
    for (let i = 0; i <= HERMES_TESTS_PER_MINUTE && last === 200; i++) {
      last = (await test_(o.people.ada.cookie, { url: sams.url, token: sams.key })).status;
    }
    expect(last).toBe(429);
    // Viewers cannot make the office call an address at all.
    o.db.$client.run(
      `update user_profiles set role = 'viewer' where user_id = '${o.people.sam.id}'`,
    );
    expect((await test_(o.people.sam.cookie, { url: sams.url, token: sams.key })).status).toBe(403);
  });

  test("no response, log line, audit entry or stored row holds a token or an address", async () => {
    const audits = JSON.stringify(o.db.select().from(auditLog).all());
    const rows = JSON.stringify([
      o.db.select().from(officeAgents).all(),
      o.db.select().from(officeAgentConnections).all(),
    ]);
    const everything = [responses.join("\n"), o.log.text(), audits, rows].join("\n");
    for (const secret of [
      mias.key,
      sams.key,
      "an-old-key-that-is-wrong-now",
      "not-the-right-key",
    ]) {
      expect(everything).not.toContain(secret);
    }
    for (const address of [mias.url, sams.url, "127.0.0.1:"]) {
      expect(everything).not.toContain(address);
    }
    // The audit trail says that connections were set, by whom, and nothing of what they hold.
    const set = o.audits("office_agent.connection_set");
    expect(set.length).toBeGreaterThanOrEqual(3);
    expect(set.at(-1)?.meta).toEqual({ engine: "hermes-external", continuesSession: true });
    // The tokens went to the gateways they belong to and nowhere else.
    expect(sams.requests.some((r) => r.authorization?.includes(mias.key))).toBe(false);
    expect(mias.requests.some((r) => r.authorization?.includes(sams.key))).toBe(false);
  });
});
