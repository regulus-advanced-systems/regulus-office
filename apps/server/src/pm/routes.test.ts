/** Office agents over a real server with sessions (#271): who may create, see, configure, talk to and stop them. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type HumanRequest,
  OFFICE_AGENT_REQUESTS_API_PATH,
  OFFICE_AGENT_SETTINGS_API_PATH,
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentConversation,
  type OfficeAgentsResponse,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
} from "@regulus/protocol";
import { officeAgentTokens } from "../db/schema/index.ts";
import { type AgentsOffice, agentsOffice } from "./test-helpers.ts";
import { hashToken } from "./tokens.ts";

let o: AgentsOffice;
let officeKey: string;
const personal = {
  name: "Hermes",
  owner: "me",
  engine: "cli-session",
  role: "pm",
  provider: "claude-code",
  model: "sonnet",
  instructions: "Mia's private notes: the launch date is a secret.",
};

beforeAll(async () => {
  o = await agentsOffice();
  officeKey = o.addOfficeKey();
});
afterAll(async () => {
  await o.stop();
});

const A = OFFICE_AGENTS_API_PATH;
const list = async (cookie: string) =>
  (await (await o.send(A, "GET", cookie)).json()) as OfficeAgentsResponse;
const create = async (cookie: string, body: unknown) => {
  const res = await o.send(A, "POST", cookie, body);
  return { status: res.status, body: (await res.json()) as OfficeAgentView & { error?: string } };
};

describe("office agents: people", () => {
  let hermes: OfficeAgentView;
  let pm: OfficeAgentView;

  test("signed-out callers get nothing; cross-origin writes are refused", async () => {
    expect((await o.office.request(A)).status).toBe(401);
    const evil = await o.send(A, "POST", o.people.mia.cookie, personal, "https://evil.example");
    expect(evil.status).toBe(403);
  });

  test("a person creates their own agent; it defaults to coordinator and starts stopped", async () => {
    const made = await create(o.people.mia.cookie, personal);
    expect(made.status).toBe(201);
    hermes = made.body;
    expect(hermes).toMatchObject({
      name: "Hermes",
      owner: { kind: "user", userId: o.people.mia.id, displayName: "Mia" },
      role: "pm",
      preset: "coordinator",
      status: "stopped",
      canTalk: true,
      canConfigure: true,
    });
    expect(hermes.config?.instructions).toContain("launch date");
    // The name is permanent and unique, whatever the case; a person has one PM.
    expect((await create(o.people.sam.cookie, { ...personal, name: "hermes" })).body.error).toBe(
      "name_taken",
    );
    expect((await create(o.people.mia.cookie, { ...personal, name: "Second PM" })).body.error).toBe(
      "pm_exists",
    );
    expect(
      (await o.send(`${A}/${hermes.id}`, "PATCH", o.people.mia.cookie, { name: "Other" })).status,
    ).toBe(400);
  });

  test("only owners and admins create shared agents, and only on an office key (D2)", async () => {
    const shared = { ...personal, name: "Number Two", owner: "office", instructions: "" };
    expect((await create(o.people.mia.cookie, shared)).status).toBe(403);
    // No credential, the owner's own login, or a person's profile: all refused for a shared agent.
    const noKey = await create(o.people.ada.cookie, shared);
    expect(noKey.status).toBe(400);
    expect(noKey.body.error).toBe("office_key_required");
    expect(
      (await create(o.people.ada.cookie, { ...shared, profileId: "login:claude-code" })).body.error,
    ).toBe("office_key_required");
    const made = await create(o.people.ada.cookie, { ...shared, profileId: officeKey });
    expect(made.status).toBe(201);
    pm = made.body;
    expect(pm.owner).toEqual({ kind: "office" });
    // The office has one PM too; a watchdog beside it is fine, on `office:<provider>`.
    expect(
      (await create(o.people.olga.cookie, { ...shared, name: "PM 2", profileId: officeKey })).body
        .error,
    ).toBe("pm_exists");
    const dog = await create(o.people.olga.cookie, {
      ...shared,
      name: "Watchdog",
      role: "watchdog",
      preset: "observer",
      model: "deepseek-chat",
      profileId: "office:claude-code",
    });
    expect(dog.status).toBe(201);
  });

  test("who sees what: others never see a personal agent; admins see its card only", async () => {
    const sam = await list(o.people.sam.cookie);
    expect(sam.agents.map((a) => a.name).sort()).toEqual(["Number Two", "Watchdog"]);
    // Everyone may talk to a shared agent; only admins configure it.
    expect(sam.agents.every((a) => a.canTalk && !a.canConfigure && a.config === undefined)).toBe(
      true,
    );
    const ada = await list(o.people.ada.cookie);
    const card = ada.agents.find((a) => a.id === hermes.id);
    expect(card).toMatchObject({ name: "Hermes", canTalk: false, canConfigure: false });
    expect(card?.config).toBeUndefined();
    expect(JSON.stringify(ada)).not.toContain("launch date");
    expect(ada.agents.find((a) => a.id === pm.id)?.config?.profileId).toBe(officeKey);
  });

  test("only its owner configures a personal agent: not another member, not an admin, not the office owner", async () => {
    const path = `${A}/${hermes.id}`;
    // To Sam it does not exist; to admins it exists but is not theirs.
    for (const [who, status] of [
      [o.people.sam, 404],
      [o.people.ada, 403],
      [o.people.olga, 403],
    ] as const) {
      expect((await o.send(path, "PATCH", who.cookie, { preset: "manager" })).status).toBe(status);
      expect((await o.send(path, "DELETE", who.cookie)).status).toBe(status);
      expect((await o.send(`${path}/tokens`, "POST", who.cookie, { label: "x" })).status).toBe(
        status,
      );
      expect((await o.send(`${path}/start`, "POST", who.cookie)).status).toBe(status);
      expect((await o.send(`${path}/conversation`, "GET", who.cookie)).status).toBe(status);
      expect((await o.send(`${path}/messages`, "POST", who.cookie, { text: "hi" })).status).toBe(
        status,
      );
      expect((await o.send(`${path}/grants`, "PUT", who.cookie, { grants: [] })).status).toBe(
        status,
      );
    }
    const mine = await o.send(path, "PATCH", o.people.mia.cookie, { preset: "observer" });
    expect(((await mine.json()) as OfficeAgentView).preset).toBe("observer");
    // A personal agent has its owner's access; nothing can be granted on top.
    const grants = await o.send(`${path}/grants`, "PUT", o.people.mia.cookie, { grants: [] });
    expect(grants.status).toBe(400);
  });

  test("a token is shown once, stored hashed, and never listed or logged", async () => {
    const res = await o.send(`${A}/${hermes.id}/tokens`, "POST", o.people.mia.cookie, {
      label: "Hermes gateway",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { token, id } = (await res.json()) as OfficeAgentTokenCreated;
    expect(token).toMatch(/^roa_[A-Za-z0-9_-]{43}$/);
    const rows = o.db.select().from(officeAgentTokens).all();
    expect(rows.find((r) => r.id === id)?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    const mine = await list(o.people.mia.cookie);
    expect(mine.agents.find((a) => a.id === hermes.id)?.config?.tokens).toEqual([
      expect.objectContaining({ id, label: "Hermes gateway" }),
    ]);
    expect(JSON.stringify(mine)).not.toContain(token);
    expect(JSON.stringify(o.audits())).not.toContain(token);
    expect(o.log.text()).not.toContain(token);
    // It works until its owner revokes it.
    expect((await o.tool(token, "list_operations")).status).toBe(200);
    expect(
      (await o.send(`${A}/${hermes.id}/tokens/${id}`, "DELETE", o.people.sam.cookie)).status,
    ).toBe(404);
    expect(
      (await o.send(`${A}/${hermes.id}/tokens/${id}`, "DELETE", o.people.mia.cookie)).status,
    ).toBe(204);
    expect((await o.tool(token, "list_operations")).status).toBe(401);
  });

  test("talking: the owner gets replies and the office keeps the history; each person has their own conversation with a shared agent", async () => {
    const sent = await o.send(`${A}/${hermes.id}/messages`, "POST", o.people.mia.cookie, {
      text: "What is on my plate?",
    });
    expect(sent.status).toBe(202);
    await o.fake.idle();
    const convo = (await (
      await o.send(`${A}/${hermes.id}/conversation`, "GET", o.people.mia.cookie)
    ).json()) as OfficeAgentConversation;
    expect(convo.messages.map((m) => [m.author, m.text])).toEqual([
      ["person", "What is on my plate?"],
      ["agent", "Hermes heard: What is on my plate?"],
    ]);
    expect(convo.waiting).toBe(false);
    // The message started the agent; the engine got the owner's identity with it.
    expect(o.fake.sent.at(-1)?.message).toMatchObject({ userId: o.people.mia.id, fromName: "Mia" });
    expect((await list(o.people.mia.cookie)).agents.find((a) => a.id === hermes.id)?.status).toBe(
      "ready",
    );

    await o.send(`${A}/${pm.id}/messages`, "POST", o.people.mia.cookie, { text: "from Mia" });
    await o.send(`${A}/${pm.id}/messages`, "POST", o.people.sam.cookie, { text: "from Sam" });
    await o.fake.idle();
    const sams = (await (
      await o.send(`${A}/${pm.id}/conversation`, "GET", o.people.sam.cookie)
    ).json()) as OfficeAgentConversation;
    expect(sams.messages.map((m) => m.text)).toEqual(["from Sam", "Number Two heard: from Sam"]);
  });

  test("an office viewer sees a shared agent's card and nothing more: no chat, no history", async () => {
    o.db.$client.run(
      `update user_profiles set role = 'viewer' where user_id = '${o.people.sam.id}'`,
    );
    const card = (await list(o.people.sam.cookie)).agents.find((a) => a.id === pm.id);
    expect(card).toMatchObject({ name: "Number Two", canTalk: false, canConfigure: false });
    const before = o.fake.sent.length;
    const sent = await o.send(`${A}/${pm.id}/messages`, "POST", o.people.sam.cookie, {
      text: "spend the office key",
    });
    expect(sent.status).toBe(403);
    expect(((await sent.json()) as { error: string }).error).toBe("viewers_cannot");
    // Not even what he said while he was a member.
    expect((await o.send(`${A}/${pm.id}/conversation`, "GET", o.people.sam.cookie)).status).toBe(
      403,
    );
    expect(o.fake.sent.length).toBe(before);
    expect(o.officeAgents.conversations.recent(pm.id, o.people.sam.id)).toHaveLength(2);
    o.db.$client.run(
      `update user_profiles set role = 'member' where user_id = '${o.people.sam.id}'`,
    );
    expect((await o.send(`${A}/${pm.id}/conversation`, "GET", o.people.sam.cookie)).status).toBe(
      200,
    );
  });

  test("each person may send a shared agent only so many messages an hour; admins set the number", async () => {
    const S = OFFICE_AGENT_SETTINGS_API_PATH;
    const limits = { personalAgentCap: 3, managerDailySpawnCap: 10, sharedMessagesPerHour: 3 };
    expect((await o.send(S, "PUT", o.people.mia.cookie, limits)).status).toBe(403);
    expect(
      (await o.send(S, "PUT", o.people.ada.cookie, { ...limits, sharedMessagesPerHour: 0 })).status,
    ).toBe(400);
    expect((await o.send(S, "PUT", o.people.ada.cookie, limits)).status).toBe(200);
    expect((await list(o.people.mia.cookie)).settings.sharedMessagesPerHour).toBe(3);
    const say = (cookie: string, id: string) =>
      o.send(`${A}/${id}/messages`, "POST", cookie, { text: "again" });
    // Mia already sent one in the last hour: two more fit, the fourth is refused.
    expect((await say(o.people.mia.cookie, pm.id)).status).toBe(202);
    expect((await say(o.people.mia.cookie, pm.id)).status).toBe(202);
    const delivered = o.fake.sent.length;
    const refused = await say(o.people.mia.cookie, pm.id);
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as {
      error: string;
      limit: number;
      retryAfterSeconds: number;
    };
    expect(body).toMatchObject({ error: "message_rate_limited", limit: 3 });
    expect(body.retryAfterSeconds).toBeGreaterThan(3500);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(3600);
    // Nothing was stored or handed to the engine.
    expect(o.fake.sent.length).toBe(delivered);
    expect(o.officeAgents.conversations.sentSince(pm.id, o.people.mia.id, 0)).toHaveLength(3);
    // The limit is per person and per agent, and personal agents are not limited.
    expect((await say(o.people.sam.cookie, pm.id)).status).toBe(202);
    const dog = (await list(o.people.mia.cookie)).agents.find((a) => a.name === "Watchdog");
    expect((await say(o.people.mia.cookie, dog?.id ?? "")).status).toBe(202);
    for (let i = 0; i < 4; i++)
      expect((await say(o.people.mia.cookie, hermes.id)).status).toBe(202);
    // An hour later she may write again.
    o.db.$client.run(
      `update office_agent_messages set ts = ts - 3660000 where agent_id = '${pm.id}' and user_id = '${o.people.mia.id}'`,
    );
    expect((await say(o.people.mia.cookie, pm.id)).status).toBe(202);
    await o.fake.idle();
    await o.send(S, "PUT", o.people.ada.cookie, { ...limits, sharedMessagesPerHour: 20 });
  });

  test("an engine cannot put words into another person's conversation with a personal agent", async () => {
    o.fake.emit({ type: "message", agentId: hermes.id, userId: o.people.sam.id, text: "psst" });
    expect(o.officeAgents.conversations.recent(hermes.id, o.people.sam.id)).toEqual([]);
  });

  test("an admin may emergency-stop someone's personal agent (audited), and nothing else", async () => {
    const res = await o.send(`${A}/${hermes.id}/stop`, "POST", o.people.ada.cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as OfficeAgentView).status).toBe("stopped");
    expect(o.fake.stopped).toContain(hermes.id);
    expect(o.audits("office_agent.emergency_stop").at(-1)).toMatchObject({
      userId: o.people.ada.id,
      targetId: hermes.id,
      meta: { ownerUserId: o.people.mia.id },
    });
    expect((await o.send(`${A}/${hermes.id}/stop`, "POST", o.people.sam.cookie)).status).toBe(404);
  });

  test("questions an agent asks reach only the person asked, who alone can answer", async () => {
    const request = o.officeAgents.requests.create({
      agentId: hermes.id,
      forUserId: o.people.mia.id,
      question: "Ship on Friday?",
      options: ["Yes", "No"],
    }) as HumanRequest;
    const R = OFFICE_AGENT_REQUESTS_API_PATH;
    const pending = async (cookie: string) =>
      ((await (await o.send(R, "GET", cookie)).json()) as { requests: HumanRequest[] }).requests;
    expect(await pending(o.people.ada.cookie)).toEqual([]);
    expect(await pending(o.people.mia.cookie)).toEqual([
      expect.objectContaining({ id: request.id, agentName: "Hermes", options: ["Yes", "No"] }),
    ]);
    const answer = (cookie: string) =>
      o.send(`${R}/${request.id}/answer`, "POST", cookie, { answer: "Yes" });
    expect((await answer(o.people.ada.cookie)).status).toBe(404);
    expect((await answer(o.people.mia.cookie)).status).toBe(200);
    expect((await answer(o.people.mia.cookie)).status).toBe(409);
    await o.fake.idle();
    // The answer reached the agent as its owner's next message.
    expect(o.fake.sent.at(-1)?.message.text).toContain("Yes");
    expect(await pending(o.people.mia.cookie)).toEqual([]);
  });

  test("admins set the cap on personal agents; members cannot", async () => {
    const S = OFFICE_AGENT_SETTINGS_API_PATH;
    const caps = { personalAgentCap: 1, managerDailySpawnCap: 2, sharedMessagesPerHour: 20 };
    expect((await o.send(S, "PUT", o.people.mia.cookie, caps)).status).toBe(403);
    expect((await o.send(S, "PUT", o.people.ada.cookie, caps)).status).toBe(200);
    const over = await create(o.people.mia.cookie, {
      ...personal,
      name: "Notes",
      role: "assistant",
    });
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("personal_agent_cap");
    const sams = await create(o.people.sam.cookie, {
      ...personal,
      name: "Sams notes",
      role: "assistant",
    });
    expect(sams.status).toBe(201);
  });

  test("deleting an agent ends its tokens and conversations; every change is in the audit log", async () => {
    const minted = (await (
      await o.send(`${A}/${hermes.id}/tokens`, "POST", o.people.mia.cookie, { label: "t" })
    ).json()) as OfficeAgentTokenCreated;
    expect((await o.send(`${A}/${hermes.id}`, "DELETE", o.people.mia.cookie)).status).toBe(204);
    expect((await o.tool(minted.token, "list_operations")).status).toBe(401);
    expect(o.officeAgents.conversations.recent(hermes.id, o.people.mia.id)).toEqual([]);
    const actions = new Set(o.audits().map((a) => a.action));
    for (const action of [
      "office_agent.create",
      "office_agent.update",
      "office_agent.token_create",
      "office_agent.token_revoke",
      "office_agent.settings",
      "office_agent.request_answer",
      "office_agent.delete",
    ])
      expect(actions.has(action)).toBe(true);
    // No audit entry carries a message or the instructions.
    expect(JSON.stringify(o.audits())).not.toContain("launch date");
    expect(JSON.stringify(o.audits())).not.toContain("on my plate");
  });
});
