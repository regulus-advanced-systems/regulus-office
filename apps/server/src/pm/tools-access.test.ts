/**
 * Authorisation of the office tools (#271), over the REST transport with real
 * tokens and two people: a personal agent can never do or see more than its
 * owner can at that moment, and a shared agent has its grants and acts for a
 * person only while that person waits for its answer.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  OFFICE_AGENT_TOOLS_API_PATH,
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { githubIssues, operationMembers, operations, tasks } from "../db/schema/index.ts";
import {
  type AgentsOffice,
  APOLLO,
  APOLLO_REPO,
  agentsOffice,
  BOREALIS,
  BOREALIS_REPO,
} from "./test-helpers.ts";

let o: AgentsOffice;
const A = OFFICE_AGENTS_API_PATH;

async function makeAgent(cookie: string, body: Record<string, unknown>) {
  const made = await o.send(A, "POST", cookie, {
    engine: "cli-session",
    role: "assistant",
    provider: "claude-code",
    model: "sonnet",
    ...body,
  });
  if (made.status !== 201) throw new Error(`create failed: ${await made.text()}`);
  const agent = (await made.json()) as OfficeAgentView;
  const minted = await o.send(`${A}/${agent.id}/tokens`, "POST", cookie, { label: "test" });
  return { agent, token: ((await minted.json()) as OfficeAgentTokenCreated).token };
}

const task = {
  operationId: APOLLO,
  repoId: APOLLO_REPO,
  kind: "freeform",
  prompt: "Fix the flaky test",
  provider: "claude-code",
  model: "sonnet",
};
const errorOf = (r: { body: { ok: boolean; error?: string } }) => r.body.error;
const resultOf = <T>(r: { body: unknown }) => (r.body as { result: T }).result;

beforeAll(async () => {
  // Nobody answers on its own here, so a person's turn stays open until a test closes it.
  o = await agentsOffice({ fake: { reply: () => null } });
  o.addOfficeKey();
  o.db
    .insert(githubIssues)
    .values({
      repoId: BOREALIS_REPO,
      number: 12,
      title: "Crash on start",
      state: "open",
      ghUpdatedAt: new Date(),
    })
    .run();
});
afterAll(async () => {
  await o.stop();
});

describe("a personal agent has exactly its owner's rights", () => {
  let mias: { agent: OfficeAgentView; token: string };
  let sams: { agent: OfficeAgentView; token: string };

  beforeAll(async () => {
    mias = await makeAgent(o.people.mia.cookie, {
      name: "Mias helper",
      owner: "me",
      preset: "manager",
    });
    sams = await makeAgent(o.people.sam.cookie, {
      name: "Sams helper",
      owner: "me",
      preset: "manager",
    });
  });

  test("it sees its owner's operations only; a closed room looks like no room", async () => {
    const mine = resultOf<{ operations: Array<{ id: string }> }>(
      await o.tool(mias.token, "list_operations"),
    );
    expect(mine.operations.map((x) => x.id)).toEqual([APOLLO]);
    for (const name of ["list_henchmen", "read_board", "read_queue"]) {
      expect((await o.tool(mias.token, name, { operationId: APOLLO })).status).toBe(200);
      const closed = await o.tool(mias.token, name, { operationId: BOREALIS });
      expect(closed.status).toBe(404);
      expect(closed.body).toEqual({ ok: false, error: "not_found", message: "no such operation" });
      // The same answer as for an operation that does not exist.
      expect((await o.tool(mias.token, name, { operationId: "nope" })).body).toEqual(closed.body);
    }
    expect(
      resultOf<{ scope: string; usage: unknown }>(await o.tool(mias.token, "read_usage")),
    ).toEqual({
      scope: "owner",
      usage: { owner: o.people.mia.id },
    });
  });

  test("its writes are its owner's: the task is hers, on her own credential", async () => {
    const queued = await o.tool(mias.token, "enqueue_task", task);
    expect(queued.status).toBe(200);
    const row = o.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, resultOf<{ taskId: string }>(queued).taskId))
      .get();
    expect(row).toMatchObject({ createdBy: o.people.mia.id, profileId: null });
    // It cannot name anyone else, nor borrow another person's credential profile.
    expect(
      errorOf(await o.tool(mias.token, "enqueue_task", { ...task, onBehalfOf: o.people.sam.id })),
    ).toBe("forbidden");
    expect(
      errorOf(
        await o.tool(mias.token, "enqueue_task", { ...task, profileId: "someone-elses-profile" }),
      ),
    ).toBe("invalid_input");
    // Commenting needs `manage`, as on the board panel; Mia only has `spawn` on Apollo.
    const comment = {
      operationId: APOLLO,
      repoId: APOLLO_REPO,
      kind: "issue",
      number: 12,
      body: "hi",
    };
    expect(errorOf(await o.tool(mias.token, "comment_on_card", comment))).toBe("forbidden");
    expect(o.comments).toEqual([]);
  });

  test("it can only ask, and stop henchmen of, its own owner", async () => {
    expect(
      errorOf(await o.tool(mias.token, "ask_human", { question: "?", userId: o.people.sam.id })),
    ).toBe("forbidden");
    const asked = await o.tool(mias.token, "ask_human", {
      question: "Merge it?",
      options: ["Yes", "No"],
    });
    const { requestId } = resultOf<{ requestId: string }>(asked);
    expect(o.officeAgents.requests.pendingFor(o.people.mia.id).map((r) => r.id)).toEqual([
      requestId,
    ]);
    // A question about a room is hers only while she can see the room (#270).
    const aboutApollo = resultOf<{ requestId: string }>(
      await o.tool(mias.token, "ask_human", { question: "Ship Apollo?", operationId: APOLLO }),
    ).requestId;
    const pending = () =>
      o.officeAgents.service
        .pendingRequests({ id: o.people.mia.id, role: "member" })
        .map((r) => r.id);
    expect(pending().sort()).toEqual([requestId, aboutApollo].sort());
    o.setRoomAccess(APOLLO, o.people.mia.id, null);
    expect(pending()).toEqual([requestId]);
    o.setRoomAccess(APOLLO, o.people.mia.id, "spawn");
    expect(pending().sort()).toEqual([requestId, aboutApollo].sort());
    // Another agent cannot read the question or its answer.
    expect((await o.tool(sams.token, "read_human_request", { requestId })).status).toBe(404);
    expect(
      resultOf<{ status: string }>(await o.tool(mias.token, "read_human_request", { requestId }))
        .status,
    ).toBe("pending");

    const spawned = await o.tool(mias.token, "spawn_henchman", {
      ...task,
      kind: undefined,
      prompt: "go",
    });
    expect(spawned.status).toBe(200);
    const { henchmanId } = resultOf<{ henchmanId: string }>(spawned);
    expect(o.spawned.at(-1)).toMatchObject({ actor: { id: o.people.mia.id }, agentId: henchmanId });
    // Sam's agent: Mia's henchman is in a room it cannot see, so it does not exist for it.
    expect((await o.tool(sams.token, "stop_henchman", { henchmanId })).status).toBe(404);
    // Even with access to the room, only the henchman's owner may stop it.
    o.setRoomAccess(APOLLO, o.people.sam.id, "manage");
    expect(errorOf(await o.tool(sams.token, "stop_henchman", { henchmanId }))).toBe("forbidden");
    expect(o.stopped).toEqual([]);
    expect((await o.tool(mias.token, "stop_henchman", { henchmanId })).status).toBe(200);
    expect(o.stopped).toEqual([henchmanId]);
  });

  test("the daily spawn cap holds, also for calls made at the same moment", async () => {
    o.officeAgents.store.saveSettings({
      personalAgentCap: 3,
      managerDailySpawnCap: 3,
      sharedMessagesPerHour: 20,
    });
    const spawn = () =>
      o.tool(mias.token, "spawn_henchman", { ...task, kind: undefined, prompt: "go" });
    // One was spawned in the test above: two more fit, the rest are refused.
    const results = await Promise.all([spawn(), spawn(), spawn(), spawn()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 429, 429]);
    expect(errorOf(await spawn())).toBe("cap_reached");
    expect(
      o.audits("office_agent.henchman_spawn").filter((a) => a.targetId === mias.agent.id),
    ).toHaveLength(3);
  });

  test("when the owner loses access, so does the agent, at the very next call", async () => {
    // Demoted to viewer: reads stay, writes go.
    o.db.$client.run(
      `update user_profiles set role = 'viewer' where user_id = '${o.people.mia.id}'`,
    );
    expect((await o.tool(mias.token, "read_queue", { operationId: APOLLO })).status).toBe(200);
    expect(errorOf(await o.tool(mias.token, "enqueue_task", task))).toBe("forbidden");
    o.db.$client.run(
      `update user_profiles set role = 'member' where user_id = '${o.people.mia.id}'`,
    );
    // Her GitHub account lost the repo: the room is gone for the agent too.
    o.setRoomAccess(APOLLO, o.people.mia.id, null);
    expect(
      resultOf<{ operations: unknown[] }>(await o.tool(mias.token, "list_operations")).operations,
    ).toEqual([]);
    expect((await o.tool(mias.token, "read_queue", { operationId: APOLLO })).status).toBe(404);
    expect((await o.tool(mias.token, "enqueue_task", task)).status).toBe(404);
    // A member row opens nothing without GitHub access to the repo (#270).
    const row = { operationId: APOLLO, userId: o.people.mia.id };
    o.db
      .insert(operationMembers)
      .values({ ...row, access: "manage" })
      .run();
    expect((await o.tool(mias.token, "read_queue", { operationId: APOLLO })).status).toBe(404);
    o.db.delete(operationMembers).where(eq(operationMembers.userId, o.people.mia.id)).run();
    // Given access again: back at once.
    o.setAccess(APOLLO, o.people.mia.id, "manage");
    expect((await o.tool(mias.token, "enqueue_task", task)).status).toBe(200);
    // A member row can only narrow what GitHub gives: reads stay, writes go.
    o.db
      .insert(operationMembers)
      .values({ ...row, access: "view" })
      .run();
    expect((await o.tool(mias.token, "read_queue", { operationId: APOLLO })).status).toBe(200);
    expect(errorOf(await o.tool(mias.token, "enqueue_task", task))).toBe("forbidden");
    o.db.delete(operationMembers).where(eq(operationMembers.userId, o.people.mia.id)).run();
    // An archived room is closed to everyone.
    o.db.update(operations).set({ archivedAt: new Date() }).where(eq(operations.id, APOLLO)).run();
    expect((await o.tool(mias.token, "read_queue", { operationId: APOLLO })).status).toBe(404);
    o.db.update(operations).set({ archivedAt: null }).where(eq(operations.id, APOLLO)).run();
  });

  test("the REST list shows the preset's tools; the token is the only way in", async () => {
    const url = new URL(OFFICE_AGENT_TOOLS_API_PATH, o.office.server.url);
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { cookie: o.people.mia.cookie } })).status).toBe(401);
    const listed = (await (
      await fetch(url, { headers: { authorization: `Bearer ${mias.token}` } })
    ).json()) as { agent: { name: string }; tools: Array<{ name: string; inputSchema: unknown }> };
    expect(listed.tools.map((t) => t.name)).toContain("spawn_henchman");
    expect(listed.tools.every((t) => typeof t.inputSchema === "object")).toBe(true);
  });
});

describe("a shared agent has its grants and acts for people who asked", () => {
  let pm: { agent: OfficeAgentView; token: string };
  const ask = (cookie: string, text: string) =>
    o.send(`${A}/${pm.agent.id}/messages`, "POST", cookie, { text });
  const reply = (userId: string) =>
    o.fake.emit({ type: "message", agentId: pm.agent.id, userId, text: "Done." });

  beforeAll(async () => {
    pm = await makeAgent(o.people.ada.cookie, {
      name: "Number Two",
      owner: "office",
      role: "pm",
      profileId: "office:claude-code",
    });
    o.setAccess(APOLLO, o.people.mia.id, "spawn");
    o.setAccess(BOREALIS, o.people.sam.id, "manage");
  });

  test("without grants it reaches nothing; admins grant operations one by one", async () => {
    expect(
      resultOf<{ operations: unknown[] }>(await o.tool(pm.token, "list_operations")).operations,
    ).toEqual([]);
    expect((await o.tool(pm.token, "read_board", { operationId: APOLLO })).status).toBe(404);
    const grants = { grants: [{ operationId: APOLLO, access: "spawn" }] };
    expect(
      (await o.send(`${A}/${pm.agent.id}/grants`, "PUT", o.people.mia.cookie, grants)).status,
    ).toBe(403);
    expect(
      (await o.send(`${A}/${pm.agent.id}/grants`, "PUT", o.people.ada.cookie, grants)).status,
    ).toBe(200);
    expect((await o.tool(pm.token, "read_board", { operationId: APOLLO })).status).toBe(200);
    expect((await o.tool(pm.token, "read_board", { operationId: BOREALIS })).status).toBe(404);
    // Its usage view is the office totals, never a person's.
    expect(resultOf<{ scope: string }>(await o.tool(pm.token, "read_usage")).scope).toBe("office");
  });

  test("it queues work only for a person who is waiting for its answer, on the office key", async () => {
    expect(errorOf(await o.tool(pm.token, "enqueue_task", task))).toBe("on_behalf_required");
    const forMia = { ...task, onBehalfOf: o.people.mia.id, profileId: "mias-own-profile" };
    expect(errorOf(await o.tool(pm.token, "enqueue_task", forMia))).toBe("not_waiting");
    expect((await ask(o.people.mia.cookie, "Please queue the flaky test fix")).status).toBe(202);
    const queued = await o.tool(pm.token, "enqueue_task", forMia);
    expect(queued.status).toBe(200);
    const row = o.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, resultOf<{ taskId: string }>(queued).taskId))
      .get();
    // Mia's task in Mia's runner, but never on a person's credential: the office key.
    expect(row).toMatchObject({ createdBy: o.people.mia.id, profileId: "office:claude-code" });
    expect(o.audits("office_agent.tool_call").at(-1)).toMatchObject({
      userId: o.people.mia.id,
      meta: { tool: "enqueue_task", shared: true, onBehalfOf: o.people.mia.id },
    });
    // Once it has answered her, it can no longer act for her.
    reply(o.people.mia.id);
    expect(errorOf(await o.tool(pm.token, "enqueue_task", forMia))).toBe("not_waiting");
  });

  test("acting for someone never exceeds what that person may do, nor what the agent was granted", async () => {
    // Sam waits, but has no access to Apollo: for him it does not exist.
    await ask(o.people.sam.cookie, "Queue something on Apollo for me");
    expect(
      (await o.tool(pm.token, "enqueue_task", { ...task, onBehalfOf: o.people.sam.id })).status,
    ).toBe(404);
    // Sam manages Borealis, but the agent has no grant there.
    const onBorealis = {
      ...task,
      operationId: BOREALIS,
      repoId: BOREALIS_REPO,
      onBehalfOf: o.people.sam.id,
    };
    expect((await o.tool(pm.token, "enqueue_task", onBorealis)).status).toBe(404);
    // A view grant is not enough to queue, whatever Sam may do himself.
    await o.send(`${A}/${pm.agent.id}/grants`, "PUT", o.people.ada.cookie, {
      grants: [
        { operationId: APOLLO, access: "spawn" },
        { operationId: BOREALIS, access: "view" },
      ],
    });
    expect(errorOf(await o.tool(pm.token, "enqueue_task", onBorealis))).toBe("forbidden");
    // The coordinator preset has no spawn tool at all.
    expect(
      errorOf(await o.tool(pm.token, "spawn_henchman", { ...onBorealis, kind: undefined })),
    ).toBe("preset_forbids");
    reply(o.people.sam.id);
  });

  test("it comments with the office credential where it was granted manage, signed as the agent", async () => {
    const comment = {
      operationId: BOREALIS,
      repoId: BOREALIS_REPO,
      kind: "issue",
      number: 12,
      body: "Looking into it.",
    };
    expect(errorOf(await o.tool(pm.token, "comment_on_card", comment))).toBe("forbidden");
    await o.send(`${A}/${pm.agent.id}/grants`, "PUT", o.people.ada.cookie, {
      grants: [{ operationId: BOREALIS, access: "manage" }],
    });
    expect((await o.tool(pm.token, "comment_on_card", { ...comment, number: 999 })).status).toBe(
      404,
    );
    const posted = await o.tool(pm.token, "comment_on_card", comment);
    expect(posted.status).toBe(200);
    expect(o.comments).toHaveLength(1);
    expect(o.comments[0]).toMatchObject({ repo: "octo/other", number: 12 });
    expect(o.comments[0]?.body).toContain("Looking into it.");
    expect(o.comments[0]?.body).toContain("Number Two, office agent");
    // The grant on Apollo was replaced: it is closed again.
    expect((await o.tool(pm.token, "read_board", { operationId: APOLLO })).status).toBe(404);
  });

  test("it asks a named person and posts chat under its own name; nobody is shown a room they cannot see", async () => {
    expect(errorOf(await o.tool(pm.token, "ask_human", { question: "Who?" }))).toBe(
      "invalid_input",
    );
    const hidden = { question: "About Borealis", userId: o.people.mia.id, operationId: BOREALIS };
    expect(errorOf(await o.tool(pm.token, "ask_human", hidden))).toBe("forbidden");
    // The token is Ada's access code, and the calls above read Apollo's board with it: what the
    // agent asks from here on may be about Apollo, so Sam, who cannot see Apollo, is not asked
    // either (#301; the rule and its other paths are in asker-limits.test.ts).
    const toSam = { ...hidden, userId: o.people.sam.id };
    expect(errorOf(await o.tool(pm.token, "ask_human", toSam))).toBe("forbidden");
    expect(o.officeAgents.requests.pendingFor(o.people.sam.id)).toEqual([]);
    o.setRoomAccess(APOLLO, o.people.sam.id, "view");
    const asked = await o.tool(pm.token, "ask_human", toSam);
    expect(asked.status).toBe(200);
    expect(o.officeAgents.requests.pendingFor(o.people.sam.id)).toEqual([
      expect.objectContaining({ agentName: "Number Two", operationId: BOREALIS }),
    ]);
    o.setRoomAccess(APOLLO, o.people.sam.id, null);
    // The lobby's chat is read by everyone, and not everyone can see those rooms.
    const lines = o.chat.length;
    expect(errorOf(await o.tool(pm.token, "post_chat", { text: "Standup in five." }))).toBe(
      "forbidden",
    );
    expect(o.chat).toHaveLength(lines);
    expect((await o.tool(pm.token, "post_chat", { text: "x", operationId: APOLLO })).status).toBe(
      404,
    );
    // On its own, with no room granted, there is no room it could be talking about.
    await o.send(`${A}/${pm.agent.id}/grants`, "PUT", o.people.ada.cookie, { grants: [] });
    expect(
      (await o.engineTool(pm.agent.id, "post_chat", { text: "Standup in five." })).status,
    ).toBe(200);
    expect(o.chat.at(-1)).toEqual({
      userId: `office-agent:${pm.agent.id}`,
      displayName: "Number Two",
      operationId: "",
      text: "Standup in five.",
    });
  });
});
