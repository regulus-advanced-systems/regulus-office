/**
 * "Hermes, run by the office" over a real office server, with the fake
 * Hermes gateway started as a process (#57): who may create one and on which
 * key (a shared agent on an office key only, never anybody's own), talking to
 * it, the office tools it is handed with its own scoped token, a crash shown
 * on the card and healed, removal, and that no key appears in any response,
 * log line, audit entry or stored row.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentConversation,
  type OfficeAgentsResponse,
  type OfficeAgentView,
} from "@regulus/protocol";
import { credentialProfileContext } from "../../../agents/manager/credentials.ts";
import {
  auditLog,
  credentialProfiles,
  officeAgents,
  usageSamples,
} from "../../../db/schema/index.ts";
import { encryptSecret } from "../../../secrets/index.ts";
import { type AgentsOffice, APOLLO, agentsOffice, BOREALIS, OFFICE_KEY } from "../../test-helpers.ts";
import { ProcessHermesHost } from "./testing/process-host.ts";

setDefaultTimeout(30_000);

const MIA_KEY = "sk-ant-api03-MIA-own-key-do-not-leak-2c91";
const SAM_KEY = "sk-SAM-deepseek-key-do-not-leak-88d0";

let o: AgentsOffice;
let root: string;
let host: ProcessHermesHost;
const keys = { mia: "", sam: "", office: "" };
const responses: string[] = [];
/** Every key and token a gateway was started with. */
const handedOver = new Set<string>();

function addKey(userId: string, key: string, deepseek = false): string {
  const id = crypto.randomUUID();
  o.db
    .insert(credentialProfiles)
    .values({
      id,
      userId,
      provider: "claude-code",
      label: deepseek ? "My DeepSeek" : "My Anthropic",
      authKind: deepseek ? "base_url_key" : "api_key",
      baseUrl: deepseek ? "https://api.deepseek.com/anthropic" : null,
      encryptedSecret: encryptSecret(
        key,
        credentialProfileContext({ id, userId }),
        o.keyring.keys,
        o.keyring.current,
      ),
    })
    .run();
  return id;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "57-hermes-routes-"));
  host = new ProcessHermesHost({ root });
  o = await agentsOffice({
    hermes: {
      healthIntervalMs: 25,
      backoffBaseMs: 10,
      backoffMaxMs: 40,
      sendAttempts: 3,
      client: { requestTimeoutMs: 500, streamIdleMs: 500 },
    },
    managedHermes: { host, startPollMs: 20, startTimeoutMs: 8000 },
  });
  keys.office = o.addOfficeKey("claude-code", "Office Anthropic");
  keys.mia = addKey(o.people.mia.id, MIA_KEY);
  keys.sam = addKey(o.people.sam.id, SAM_KEY, true);
});
afterAll(async () => {
  await o.stop();
  await host.reap();
  await rm(root, { recursive: true, force: true });
});

const A = OFFICE_AGENTS_API_PATH;
async function call<T>(path: string, method: string, cookie: string, body?: unknown) {
  const res = await o.send(path, method, cookie, body);
  const text = await res.text();
  responses.push(text);
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T & { error?: string; message?: string },
  };
}
const managed = (name: string, extra: object = {}) => ({
  name,
  owner: "me",
  engine: "hermes-managed",
  role: "assistant",
  provider: "claude-code",
  model: "sonnet",
  ...extra,
});
const started = (agentId: string) => {
  const start = JSON.parse(readFileSync(join(host.home(agentId), "fake-start.json"), "utf8")) as {
    pid: number;
    env: Record<string, string>;
    config: string;
  };
  for (const name of ["API_SERVER_KEY", "OFFICE_AGENT_TOKEN", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"]) {
    const value = start.env[name];
    if (value) handedOver.add(value);
  }
  return start;
};
async function reply(cookie: string, id: string, count: number) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const c = (await call<OfficeAgentConversation>(`${A}/${id}/conversation`, "GET", cookie)).body;
    if (c.messages.length >= count && c.messages.at(-1)?.author !== "person") return c;
    if (Date.now() > deadline) throw new Error("no reply in time");
    await Bun.sleep(15);
  }
}
async function card(cookie: string, id: string) {
  const list = await call<OfficeAgentsResponse>(A, "GET", cookie);
  return list.body.agents.find((a) => a.id === id);
}
async function untilCard(cookie: string, id: string, ok: (a: OfficeAgentView) => boolean) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const seen = await card(cookie, id);
    if (seen && ok(seen)) return seen;
    if (Date.now() > deadline) throw new Error(`card never got there: ${seen?.status}`);
    await Bun.sleep(15);
  }
}

describe("a personal Hermes run by the office", () => {
  let agent: OfficeAgentView;

  test("the engine is offered, and it needs a key its owner may use: no login, nobody else's key", async () => {
    const list = await call<OfficeAgentsResponse>(A, "GET", o.people.mia.cookie);
    expect(list.body.engines).toContain("hermes-managed");

    const login = await call(A, "POST", o.people.mia.cookie, managed("NoKey"));
    expect(login.status).toBe(400);
    expect(login.body.error).toBe("hermes_key_required");
    expect(login.body.message).toContain("subscription login cannot be used");

    const stolen = await call(A, "POST", o.people.mia.cookie, managed("Stolen", { profileId: keys.sam }));
    expect(stolen.status).toBe(400);
    const viewer = await call(A, "POST", o.people.olga.cookie, managed("Fine", { profileId: keys.sam }));
    expect(viewer.status).toBe(400);
    expect(host.launches).toHaveLength(0);
  });

  test("its owner creates it on their own key; nothing is started until it is talked to", async () => {
    const made = await call<OfficeAgentView>(
      A,
      "POST",
      o.people.mia.cookie,
      managed("Scout", { profileId: keys.mia, instructions: "Answer in one line." }),
    );
    expect(made.status).toBe(201);
    agent = made.body;
    expect(agent).toMatchObject({
      engine: "hermes-managed",
      owner: { kind: "user", userId: o.people.mia.id },
      provider: "claude-code",
      model: "sonnet",
      runsOn: { kind: "anthropic", officeKey: false },
      status: "stopped",
    });
    expect(host.launches).toHaveLength(0);
  });

  test("the first message starts Hermes on the owner's key and is answered", async () => {
    const sent = await call(`${A}/${agent.id}/messages`, "POST", o.people.mia.cookie, {
      text: "hello there",
    });
    expect(sent.status).toBe(202);
    const c = await reply(o.people.mia.cookie, agent.id, 2);
    expect(c.messages.at(-1)).toMatchObject({ author: "agent", text: "Hermes heard: hello there" });
    const { env, config } = started(agent.id);
    expect(env.ANTHROPIC_API_KEY).toBe(MIA_KEY);
    expect(config).toContain('default: "claude-sonnet-5-5"');
    expect((await card(o.people.mia.cookie, agent.id))?.status).toBe("ready");
    // What it used is its owner's to pay.
    const usage = o.db.select().from(usageSamples).all();
    expect(usage.some((u) => u.userId === o.people.mia.id && u.inputTokens === 10)).toBe(true);
  });

  test("the office tools it was configured with act with its owner's rights, and no further", async () => {
    const { env, config } = started(agent.id);
    expect(config).toContain(`url: "${o.office.origin}/mcp"`);
    const token = env.OFFICE_AGENT_TOKEN ?? "";
    const operations = JSON.stringify((await o.tool(token, "list_operations")).body);
    expect(operations).toContain(APOLLO);
    expect(operations).not.toContain(BOREALIS);
    // Over MCP, as Hermes itself reaches them.
    const mcp = await fetch(`${o.office.origin}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcp.status).toBe(200);
    expect(await mcp.text()).toContain("list_operations");
  });

  test("to another member it does not exist; an admin sees the card and may not talk to it", async () => {
    const sam = o.people.sam.cookie;
    expect((await call(`${A}/${agent.id}/messages`, "POST", sam, { text: "hi" })).status).toBe(404);
    expect(await card(sam, agent.id)).toBeUndefined();
    const ada = o.people.ada.cookie;
    const seen = await card(ada, agent.id);
    expect(seen?.engine).toBe("hermes-managed");
    expect(seen?.config).toBeUndefined();
    expect((await call(`${A}/${agent.id}/messages`, "POST", ada, { text: "hi" })).status).toBe(403);
  });

  test("a crash shows on the card with its reason, and the office brings it back", async () => {
    const before = started(agent.id).pid;
    host.kill(agent.id);
    const broken = await untilCard(o.people.mia.cookie, agent.id, (a) => a.status === "error");
    expect(broken.statusReason).toContain("Hermes stopped unexpectedly (it was killed)");
    await untilCard(o.people.mia.cookie, agent.id, (a) => a.status === "ready");
    expect(started(agent.id).pid).not.toBe(before);
    await call(`${A}/${agent.id}/messages`, "POST", o.people.mia.cookie, { text: "still there?" });
    const c = await reply(o.people.mia.cookie, agent.id, 4);
    expect(c.messages.at(-1)?.text).toBe("Hermes heard: still there?");
  });

  test("stop ends the process and its token; removing the agent removes Hermes's home", async () => {
    const token = started(agent.id).env.OFFICE_AGENT_TOKEN ?? "";
    const stopped = await call(`${A}/${agent.id}/stop`, "POST", o.people.mia.cookie);
    expect(stopped.status).toBeLessThan(300);
    expect(host.running(agent.id)).toBe(false);
    expect((await o.tool(token, "list_operations")).status).toBe(401);
    expect(existsSync(host.home(agent.id))).toBe(true);

    const removed = await call(`${A}/${agent.id}`, "DELETE", o.people.mia.cookie);
    expect(removed.status).toBe(204);
    expect(existsSync(host.home(agent.id))).toBe(false);
  });
});

describe("a shared Hermes run by the office", () => {
  let shared: OfficeAgentView;

  test("only an owner or admin creates it, and only on an office key: never a person's own", async () => {
    const office = (extra: object) => managed("Front Desk", { owner: "office", ...extra });
    const member = await call(A, "POST", o.people.mia.cookie, office({ profileId: keys.office }));
    expect(member.status).toBe(403);

    const ada = o.people.ada.cookie;
    const personal = await call(A, "POST", ada, office({ profileId: keys.mia }));
    expect(personal.status).toBe(400);
    expect(personal.body.error).toBe("office_key_required");
    const none = await call(A, "POST", ada, office({}));
    expect(none.status).toBe(400);

    const made = await call<OfficeAgentView>(A, "POST", ada, office({ profileId: keys.office }));
    expect(made.status).toBe(201);
    shared = made.body;
    expect(shared).toMatchObject({
      engine: "hermes-managed",
      owner: { kind: "office" },
      runsOn: { kind: "anthropic", officeKey: true },
    });
  });

  test("every member can talk to it; it runs on the office key and the office pays", async () => {
    const sent = await call(`${A}/${shared.id}/messages`, "POST", o.people.sam.cookie, {
      text: "who is on call?",
    });
    expect(sent.status).toBe(202);
    const c = await reply(o.people.sam.cookie, shared.id, 2);
    expect(c.messages.at(-1)?.text).toBe("Hermes heard: who is on call?");
    const { env } = started(shared.id);
    expect(env.ANTHROPIC_API_KEY).toBe(OFFICE_KEY);
    const usage = o.db.select().from(usageSamples).all();
    expect(usage.some((u) => u.userId === null && u.inputTokens === 10)).toBe(true);
  });

  test("its token sees no room until the office lets it into one", async () => {
    const token = started(shared.id).env.OFFICE_AGENT_TOKEN ?? "";
    const operations = JSON.stringify((await o.tool(token, "list_operations")).body);
    expect(operations).not.toContain(APOLLO);
    expect(operations).not.toContain(BOREALIS);
  });

  test("moving it to a person's key is refused", async () => {
    const patched = await call(`${A}/${shared.id}`, "PATCH", o.people.ada.cookie, {
      profileId: keys.mia,
    });
    expect(patched.status).toBe(400);
    expect(patched.body.error).toBe("office_key_required");
  });
});

test("no key and no token is in any response, log line, audit entry or stored row", () => {
  const audits = JSON.stringify(o.db.select().from(auditLog).all());
  const rows = JSON.stringify(o.db.select().from(officeAgents).all());
  const everything = [responses.join("\n"), o.log.text(), audits, rows].join("\n");
  expect(handedOver.size).toBeGreaterThanOrEqual(5);
  for (const secret of [...handedOver, MIA_KEY, SAM_KEY, OFFICE_KEY]) {
    expect(everything).not.toContain(secret);
  }
});
