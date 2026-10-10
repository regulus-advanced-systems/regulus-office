/**
 * Board helpers end to end (#56), on a real office server with four people:
 * Ada (admin, sees both rooms), Mia (may spawn in Apollo), Sam (manages
 * Borealis) and Olga (the office owner, no GitHub account: sees no room).
 *
 * What is pinned: who may place a helper and where, that it exists only for
 * people who see its room (D26, D27, D34), its short tool list whatever its
 * preset, that it queues work only for the person waiting, in its own room,
 * and the brief it gives.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  KIOSK_TOOLS,
  type KioskBrief,
  OFFICE_AGENT_ATTENTION_API_PATH,
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentsResponse,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
  officeAgentBriefPath,
  officeAgentProposalPath,
  officeAgentProposalsPath,
  officeAgentStartOverPath,
  type TaskProposal,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import {
  githubIssues,
  githubPulls,
  officeAgentKiosks,
  officeAgentTaskProposals,
  operations,
  tasks,
} from "../../db/schema/index.ts";
import { RoomScopes } from "../scope.ts";
import {
  type AgentsOffice,
  APOLLO,
  APOLLO_REPO,
  agentsOffice,
  BOREALIS,
  BOREALIS_REPO,
} from "../test-helpers.ts";
import { TOOL_REACH } from "../tools/call.ts";

let o: AgentsOffice;
const A = OFFICE_AGENTS_API_PATH;

const helper = (over: Record<string, unknown> = {}) => ({
  name: "Apollo issues",
  owner: "office",
  engine: "cli-session",
  role: "kiosk",
  provider: "claude-code",
  model: "haiku",
  profileId: "office:claude-code",
  kiosk: { operationId: APOLLO, board: "issues" },
  ...over,
});
const create = (cookie: string, body: Record<string, unknown>) => o.send(A, "POST", cookie, body);
const errorCode = async (res: Response) => ((await res.json()) as { error: string }).error;
const names = async (cookie: string) =>
  ((await (await o.send(A, "GET", cookie)).json()) as OfficeAgentsResponse).agents.map(
    (a) => a.name,
  );
const tokenOf = async (agentId: string) =>
  (
    (await (
      await o.send(`${A}/${agentId}/tokens`, "POST", o.people.ada.cookie, { label: "test" })
    ).json()) as OfficeAgentTokenCreated
  ).token;
const errorOf = (r: { body: { ok: boolean; error?: string } }) => r.body.error;
const resultOf = <T>(r: { body: unknown }) => (r.body as { result: T }).result;

let apollo: OfficeAgentView;
let borealis: OfficeAgentView;
let apolloToken: string;

beforeAll(async () => {
  // Nobody answers on its own, so a person's turn stays open until a test closes it.
  o = await agentsOffice({ fake: { reply: () => null } });
  o.addOfficeKey();
  const now = new Date();
  o.db
    .insert(githubIssues)
    .values([
      { repoId: APOLLO_REPO, number: 7, title: "Login loops", state: "open", ghUpdatedAt: now },
      { repoId: APOLLO_REPO, number: 8, title: "Dark mode", state: "open", ghUpdatedAt: now },
      { repoId: BOREALIS_REPO, number: 12, title: "Secret plan", state: "open", ghUpdatedAt: now },
    ])
    .run();
  o.db
    .insert(githubPulls)
    .values({
      repoId: BOREALIS_REPO,
      number: 30,
      title: "Hidden feature",
      state: "open",
      ghUpdatedAt: now,
    })
    .run();
});
afterAll(async () => {
  await o.stop();
});

describe("placing a board helper", () => {
  test("an office admin who sees the room places one; it gets the room and nothing more", async () => {
    const made = await create(o.people.ada.cookie, helper());
    expect(made.status).toBe(201);
    apollo = (await made.json()) as OfficeAgentView;
    expect(apollo.kiosk).toEqual({
      operationId: APOLLO,
      operationName: "Apollo",
      board: "issues",
      viaPm: true,
      runsLikePm: false,
    });
    // Let in to look and to queue, never to manage, though Ada manages the room.
    expect(apollo.config?.grants).toEqual([{ operationId: APOLLO, access: "spawn" }]);
    // No soul was written: it starts with the one for its board.
    expect(apollo.config?.instructions).toContain("issue board");
    apolloToken = await tokenOf(apollo.id);

    const other = await create(
      o.people.ada.cookie,
      helper({ name: "Borealis pulls", kiosk: { operationId: BOREALIS, board: "pulls" } }),
    );
    expect(other.status).toBe(201);
    borealis = (await other.json()) as OfficeAgentView;
  });

  test("the rules of a placement", async () => {
    const ada = o.people.ada.cookie;
    // One helper per board.
    const again = await create(ada, helper({ name: "Second" }));
    expect([again.status, await errorCode(again)]).toEqual([409, "kiosk_board_taken"]);
    // The job and the placement come together.
    const bare = await create(ada, helper({ name: "Bare", kiosk: undefined }));
    expect([bare.status, await errorCode(bare)]).toEqual([400, "kiosk_placement_required"]);
    const stray = await create(ada, helper({ name: "Stray", role: "assistant" }));
    expect(await errorCode(stray)).toBe("kiosk_placement_unexpected");
    // Never one person's agent, and only on the engine that has no tools of its own.
    const personal = await create(o.people.mia.cookie, helper({ name: "Mine", owner: "me" }));
    expect(await errorCode(personal)).toBe("kiosk_shared_only");
    const hermes = await create(
      ada,
      helper({
        name: "Hermes",
        engine: "hermes-managed",
        kiosk: { operationId: APOLLO, board: "queue" },
      }),
    );
    expect(await errorCode(hermes)).toBe("kiosk_engine");
    // Members do not create shared agents.
    expect((await create(o.people.mia.cookie, helper({ name: "Mias" }))).status).toBe(403);
  });

  test("a room the placer cannot see is unknown, also to the office owner (D27)", async () => {
    const closed = await create(
      o.people.olga.cookie,
      helper({ name: "Olgas", kiosk: { operationId: APOLLO, board: "queue" } }),
    );
    expect([closed.status, await errorCode(closed)]).toEqual([400, "unknown_operation"]);
    const missing = await create(
      o.people.olga.cookie,
      helper({ name: "Olgas", kiosk: { operationId: "nope", board: "queue" } }),
    );
    expect([missing.status, await errorCode(missing)]).toEqual([400, "unknown_operation"]);
  });

  test("its job and its room never change", async () => {
    const ada = o.people.ada.cookie;
    const job = await o.send(`${A}/${apollo.id}`, "PATCH", ada, { role: "assistant" });
    expect([job.status, await errorCode(job)]).toEqual([400, "kiosk_job_fixed"]);
    const grants = (list: unknown[]) =>
      o.send(`${A}/${apollo.id}/grants`, "PUT", ada, { grants: list });
    const elsewhere = await grants([{ operationId: BOREALIS, access: "view" }]);
    expect([elsewhere.status, await errorCode(elsewhere)]).toEqual([400, "kiosk_one_room"]);
    const more = await grants([{ operationId: APOLLO, access: "manage" }]);
    expect(await errorCode(more)).toBe("kiosk_one_room");
    expect((await grants([{ operationId: APOLLO, access: "spawn" }])).status).toBe(200);
  });
});

describe("a board helper exists only for people who see its room", () => {
  test("the list, the card, the chat, the soul and the brief", async () => {
    const { ada, mia, sam, olga } = o.people;
    expect(await names(ada.cookie)).toEqual(["Apollo issues", "Borealis pulls"]);
    expect(await names(mia.cookie)).toEqual(["Apollo issues"]);
    expect(await names(sam.cookie)).toEqual(["Borealis pulls"]);
    // The office owner has no GitHub access to either repo: no helper at all.
    expect(await names(olga.cookie)).toEqual([]);

    for (const [cookie, hidden] of [
      [mia.cookie, borealis.id],
      [sam.cookie, apollo.id],
      [olga.cookie, apollo.id],
      [olga.cookie, borealis.id],
    ] as const) {
      const missing = await o.send(`${A}/nope/conversation`, "GET", cookie);
      for (const [method, path, body] of [
        ["GET", `${A}/${hidden}/conversation`, undefined],
        ["POST", `${A}/${hidden}/messages`, { text: "What is on the board?" }],
        ["GET", officeAgentBriefPath(hidden), undefined],
        ["GET", `${A}/${hidden}/soul`, undefined],
        ["POST", `${A}/${hidden}/seen`, {}],
        ["POST", `${A}/${hidden}/stop`, {}],
        ["DELETE", `${A}/${hidden}`, undefined],
      ] as const) {
        const res = await o.send(path, method, cookie, body);
        // The same answer as for an agent that does not exist.
        expect([method, path, res.status]).toEqual([method, path, 404]);
      }
      expect(missing.status).toBe(404);
    }
    // Nothing was said to the hidden helpers, and they are still there.
    expect(o.fake.sent).toEqual([]);
    expect(await names(ada.cookie)).toEqual(["Apollo issues", "Borealis pulls"]);
  });

  test("losing the room takes the helper away, with what it was asked", async () => {
    const { mia } = o.people;
    expect((await o.send(officeAgentBriefPath(apollo.id), "GET", mia.cookie)).status).toBe(200);
    o.setRoomAccess(APOLLO, mia.id, null);
    expect(await names(mia.cookie)).toEqual([]);
    expect((await o.send(officeAgentBriefPath(apollo.id), "GET", mia.cookie)).status).toBe(404);
    expect((await o.send(`${A}/${apollo.id}/conversation`, "GET", mia.cookie)).status).toBe(404);
    const attention = (await (
      await o.send(OFFICE_AGENT_ATTENTION_API_PATH, "GET", mia.cookie)
    ).json()) as { agents: Array<{ agentId: string }> };
    expect(attention.agents.map((a) => a.agentId)).not.toContain(apollo.id);
    o.setRoomAccess(APOLLO, mia.id, "spawn");
    expect(await names(mia.cookie)).toEqual(["Apollo issues"]);
  });
});

describe("a board helper's tools", () => {
  test("only the short list, whatever its preset", async () => {
    const listed = (await (
      await fetch(new URL("/api/agent-tools", o.office.server.url), {
        headers: { authorization: `Bearer ${apolloToken}` },
      })
    ).json()) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((t) => t.name).sort()).toEqual([...KIOSK_TOOLS].sort());

    // Even as a `manager` it gains nothing.
    const up = await o.send(`${A}/${apollo.id}`, "PATCH", o.people.ada.cookie, {
      preset: "manager",
    });
    expect(up.status).toBe(200);
    for (const [name, input] of [
      [
        "comment_on_card",
        { operationId: APOLLO, repoId: APOLLO_REPO, kind: "issue", number: 7, body: "x" },
      ],
      ["post_chat", { text: "hello" }],
      [
        "spawn_henchman",
        { operationId: APOLLO, repoId: APOLLO_REPO, provider: "claude-code", model: "sonnet" },
      ],
      ["stop_henchman", { henchmanId: "h1" }],
      ["ask_human", { question: "Why?", userId: o.people.mia.id }],
      ["memory_save", { text: "Mia likes tests" }],
      ["note_write", { title: "Log", text: "x" }],
      ["read_usage", {}],
    ] as const) {
      const refused = await o.tool(apolloToken, name, input);
      expect([name, refused.status, errorOf(refused)]).toEqual([name, 403, "role_forbids"]);
    }
    expect(o.chat).toEqual([]);
    expect(o.comments).toEqual([]);
    expect(o.spawned).toEqual([]);
    // Each refusal is on record.
    expect(
      o.audits("office_agent.tool_denied").filter((a) => a.meta.error === "role_forbids").length,
    ).toBe(8);
    await o.send(`${A}/${apollo.id}`, "PATCH", o.people.ada.cookie, { preset: "coordinator" });
  });

  test("it reads its own room and no other", async () => {
    const mine = resultOf<{ operations: Array<{ id: string }> }>(
      await o.tool(apolloToken, "list_operations"),
    );
    expect(mine.operations.map((x) => x.id)).toEqual([APOLLO]);
    for (const name of ["read_board", "read_queue", "list_henchmen"]) {
      expect((await o.tool(apolloToken, name, { operationId: APOLLO })).status).toBe(200);
      const closed = await o.tool(apolloToken, name, { operationId: BOREALIS });
      expect([closed.status, errorOf(closed)]).toEqual([404, "not_found"]);
    }
  });

  const task = {
    operationId: APOLLO,
    repoId: APOLLO_REPO,
    kind: "issue",
    refNumber: 7,
    prompt: "Fix the login loop and add a test",
    provider: "claude-code",
    model: "sonnet",
  };
  const proposalsOf = async (cookie: string, id = apollo.id) =>
    (
      (await (await o.send(officeAgentProposalsPath(id), "GET", cookie)).json()) as {
        proposals: TaskProposal[];
      }
    ).proposals;
  const tasksIn = (operationId: string) =>
    o.db.select().from(tasks).where(eq(tasks.operationId, operationId)).all();
  const ask = (cookie: string, text = "Please queue issue 7") =>
    o.send(`${A}/${apollo.id}/messages`, "POST", cookie, { text });
  const answer = (userId: string) =>
    o.fake.emit({ type: "message", agentId: apollo.id, userId, text: "Have a look." });

  test("enqueue_task queues nothing: it proposes, and only for the person it is answering", async () => {
    const { mia, sam } = o.people;
    const forMia = { ...task, onBehalfOf: mia.id };
    // Outside a turn a shared agent does nothing at all (#301).
    expect(errorOf(await o.engineTool(apollo.id, "enqueue_task", forMia))).toBe("forbidden");
    // With an access code it is answered for whoever minted the code (Ada), never for Mia.
    expect(errorOf(await o.tool(apolloToken, "enqueue_task", forMia))).toBe("not_waiting");

    await o.inTurn(apollo.id, mia, async (call) => {
      expect(errorOf(await call("enqueue_task", task))).toBe("on_behalf_required");
      // Sam cannot see Apollo; and whoever is named, it acts only for the person it is answering.
      expect(errorOf(await call("enqueue_task", { ...task, onBehalfOf: sam.id }))).toBe(
        "not_waiting",
      );
      const proposed = await call("enqueue_task", forMia);
      expect(proposed.status).toBe(200);
      expect(resultOf<{ status: string }>(proposed)).toMatchObject({
        status: "awaiting_confirmation",
        proposedFor: mia.id,
      });
      expect(resultOf<{ taskId?: string }>(proposed).taskId).toBeUndefined();
      // Nothing reached the queue, and no henchman was started.
      expect(tasksIn(APOLLO)).toEqual([]);
      expect(o.spawned).toEqual([]);

      // Not in another room, whoever asks; and nothing for a person who may only look.
      const elsewhere = await call("enqueue_task", {
        ...forMia,
        operationId: BOREALIS,
        repoId: BOREALIS_REPO,
      });
      expect(errorOf(elsewhere)).toBe("not_found");
      o.setRoomAccess(APOLLO, mia.id, "view");
      expect(errorOf(await call("enqueue_task", forMia))).toBe("forbidden");
      o.setRoomAccess(APOLLO, mia.id, "spawn");
    });
    answer(mia.id);
  });

  test("the person sees exactly what would be queued, and queues it from their own browser", async () => {
    const { mia, ada, sam } = o.people;
    const [proposal] = await proposalsOf(mia.cookie);
    expect(proposal).toMatchObject({
      agentId: apollo.id,
      agentName: "Apollo issues",
      operationName: "Apollo",
      repo: "octo/hello",
      cardTitle: "Login loops",
      status: "pending",
      task: {
        operationId: APOLLO,
        repoId: APOLLO_REPO,
        kind: "issue",
        refNumber: 7,
        prompt: "Fix the login loop and add a test",
        provider: "claude-code",
        model: "sonnet",
      },
    });
    if (!proposal) throw new Error("no proposal");
    const confirm = officeAgentProposalPath(apollo.id, proposal.id, "confirm");

    // It is Mia's alone: nobody else sees it or can confirm it, admin or not.
    expect(await proposalsOf(ada.cookie)).toEqual([]);
    expect((await o.send(confirm, "POST", ada.cookie, {})).status).toBe(404);
    expect((await o.send(officeAgentProposalsPath(apollo.id), "GET", sam.cookie)).status).toBe(404);
    expect((await o.send(confirm, "POST", sam.cookie, {})).status).toBe(404);
    // The agent cannot confirm what it proposed: its token opens no such route.
    const byAgent = await fetch(new URL(confirm, o.office.server.url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apolloToken}`,
        origin: o.office.origin,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(byAgent.status).toBe(401);
    // Nor a page on another site with Mia's cookie.
    expect((await o.send(confirm, "POST", mia.cookie, {}, "https://evil.example")).status).toBe(
      403,
    );
    expect(tasksIn(APOLLO)).toEqual([]);

    const done = await o.send(confirm, "POST", mia.cookie, {});
    expect(done.status).toBe(200);
    const { taskId } = (await done.json()) as { taskId: string };
    expect(tasksIn(APOLLO)).toHaveLength(1);
    expect(o.db.select().from(tasks).where(eq(tasks.id, taskId)).get()).toMatchObject({
      operationId: APOLLO,
      createdBy: mia.id,
      kind: "issue",
      refNumber: 7,
      prompt: "Fix the login loop and add a test",
      provider: "claude-code",
      model: "sonnet",
      profileId: "office:claude-code",
    });
    // Once only.
    expect((await o.send(confirm, "POST", mia.cookie, {})).status).toBe(409);
    expect(tasksIn(APOLLO)).toHaveLength(1);
    expect(await proposalsOf(mia.cookie)).toEqual([]);
    expect(o.audits("office_agent.proposal_confirm").at(-1)?.meta).toEqual({
      proposalId: proposal.id,
      operationId: APOLLO,
      taskId,
    });
  });

  test("a proposal can be dropped, expires, and dies with the right to queue", async () => {
    const { mia } = o.people;
    const propose = async () => {
      const made = await o.inTurn(apollo.id, mia, (call) =>
        call("enqueue_task", { ...task, refNumber: 8, onBehalfOf: mia.id }),
      );
      answer(mia.id);
      return resultOf<{ proposalId: string }>(made).proposalId;
    };
    const before = tasksIn(APOLLO).length;
    const path = (id: string, action: "confirm" | "dismiss") =>
      officeAgentProposalPath(apollo.id, id, action);

    const dropped = await propose();
    expect((await o.send(path(dropped, "dismiss"), "POST", mia.cookie, {})).status).toBe(204);
    expect((await o.send(path(dropped, "confirm"), "POST", mia.cookie, {})).status).toBe(409);

    const late = await propose();
    o.db
      .update(officeAgentTaskProposals)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(officeAgentTaskProposals.id, late))
      .run();
    expect(await proposalsOf(mia.cookie)).toEqual([]);
    expect((await o.send(path(late, "confirm"), "POST", mia.cookie, {})).status).toBe(410);

    // Between the proposal and the click, Mia lost the right to queue here.
    const stale = await propose();
    o.setRoomAccess(APOLLO, mia.id, "view");
    const refused = await o.send(path(stale, "confirm"), "POST", mia.cookie, {});
    expect([refused.status, await errorCode(refused)]).toEqual([409, "proposal_no_longer_allowed"]);
    o.setRoomAccess(APOLLO, mia.id, "spawn");
    expect((await o.send(path(stale, "confirm"), "POST", mia.cookie, {})).status).toBe(409);

    // The helper may no longer queue (its preset was lowered).
    const lowered = await propose();
    await o.send(`${A}/${apollo.id}`, "PATCH", o.people.ada.cookie, { preset: "observer" });
    expect((await o.send(path(lowered, "confirm"), "POST", mia.cookie, {})).status).toBe(409);
    await o.send(`${A}/${apollo.id}`, "PATCH", o.people.ada.cookie, { preset: "coordinator" });

    // A helper holds only a few open proposals for one person: the oldest go.
    const ids = [await propose(), await propose(), await propose(), await propose()];
    expect((await proposalsOf(mia.cookie)).map((p) => p.id)).toEqual(ids.slice(1));
    for (const id of ids.slice(1)) await o.send(path(id, "dismiss"), "POST", mia.cookie, {});
    expect(tasksIn(APOLLO)).toHaveLength(before);
  });

  test("every tool it has is classified by where its text ends up; only the proposal writes anywhere", () => {
    const reach = Object.fromEntries(KIOSK_TOOLS.map((name) => [name, TOOL_REACH[name]]));
    expect(reach).toEqual({
      list_operations: "nothing",
      list_henchmen: "nothing",
      read_board: "nothing",
      read_queue: "nothing",
      soul_read: "nothing",
      enqueue_task: "room",
    });
  });

  test("its conversation reads its own room only, so what it proposes is for people who see that room", async () => {
    const { mia } = o.people;
    const scopes = new RoomScopes(o.db);
    await o.inTurn(apollo.id, mia, async (call) => {
      expect((await call("read_board", { operationId: APOLLO })).status).toBe(200);
      expect((await call("read_queue", { operationId: APOLLO })).status).toBe(200);
      // Another room does not exist for it, and leaves nothing in the conversation.
      expect((await call("read_board", { operationId: BOREALIS })).status).toBe(404);
    });
    answer(mia.id);
    expect(scopes.seen(apollo.id, mia.id)).toEqual([APOLLO]);

    // Were the conversation ever to hold a room the people of Apollo cannot all see, neither
    // the proposal nor a confirmation of an earlier one would go through (the dispatcher's
    // `room` check, and the same check on confirm).
    let earlier = "";
    await o.inTurn(apollo.id, mia, async (call) => {
      const forMia = { ...task, refNumber: 8, onBehalfOf: mia.id };
      earlier = resultOf<{ proposalId: string }>(await call("enqueue_task", forMia)).proposalId;
      // (Put there by hand: no tool of a helper can. A message would also start such a
      // conversation over before the helper saw it, which is #301's own protection.)
      scopes.sawRooms(apollo.id, mia.id, [BOREALIS]);
      const refused = await call("enqueue_task", forMia);
      expect([refused.status, errorOf(refused)]).toEqual([403, "forbidden"]);
    });
    const before = tasksIn(APOLLO).length;
    const confirm = await o.send(
      officeAgentProposalPath(apollo.id, earlier, "confirm"),
      "POST",
      mia.cookie,
      {},
    );
    expect([confirm.status, await errorCode(confirm)]).toEqual([409, "proposal_no_longer_allowed"]);
    expect(tasksIn(APOLLO)).toHaveLength(before);
    answer(mia.id);

    // "Start this conversation over" clears what it has read, and drops what it proposed.
    const open = resultOf<{ proposalId: string }>(
      await (async () => {
        scopes.forget(apollo.id, mia.id);
        return o.inTurn(apollo.id, mia, (call) =>
          call("enqueue_task", { ...task, refNumber: 8, onBehalfOf: mia.id }),
        );
      })(),
    ).proposalId;
    answer(mia.id);
    expect((await proposalsOf(mia.cookie)).map((p) => p.id)).toEqual([open]);
    const over = await o.send(officeAgentStartOverPath(apollo.id), "POST", mia.cookie, {});
    expect(over.status).toBe(200);
    expect(await proposalsOf(mia.cookie)).toEqual([]);
    expect(
      (await o.send(officeAgentProposalPath(apollo.id, open, "confirm"), "POST", mia.cookie, {}))
        .status,
    ).toBe(409);
    expect(scopes.seen(apollo.id, mia.id)).toEqual([]);
  });

  // Review fix 1. The mechanism is #301's (pm/tools/asking.ts): each turn has its own token,
  // bound to the person whose message it is, and a call is answered for that person only.
  test("a helper answering one person cannot act for another whose turn failed earlier", async () => {
    const { mia, sam } = o.people;
    // Mia asked, and her turn failed: the office told her so with a `system` line.
    expect((await ask(mia.cookie, "What is open?")).status).toBe(202);
    expect(o.officeAgents.conversations.waiting(apollo.id, mia.id)).toBe(true);
    o.fake.emit({
      type: "error",
      agentId: apollo.id,
      userId: mia.id,
      message: "the agent could not answer (engine error)",
    });
    // A failed turn is over.
    expect(o.officeAgents.conversations.waiting(apollo.id, mia.id)).toBe(false);
    // Sam, who may only look in Apollo, is the one the helper is answering now.
    o.setRoomAccess(APOLLO, sam.id, "view");
    try {
      const before = (await proposalsOf(mia.cookie)).length;
      await o.inTurn(apollo.id, sam, async (call) => {
        const asMia = await call("enqueue_task", { ...task, refNumber: 8, onBehalfOf: mia.id });
        // This turn is Sam's: nothing is done in Mia's name.
        expect([asMia.status, errorOf(asMia)]).toEqual([403, "not_waiting"]);
        // Nor for Sam himself, who may only look here.
        const asSam = await call("enqueue_task", { ...task, refNumber: 8, onBehalfOf: sam.id });
        expect(errorOf(asSam)).toBe("forbidden");
      });
      expect(await proposalsOf(mia.cookie)).toHaveLength(before);
      expect(await proposalsOf(sam.cookie)).toEqual([]);
      expect(tasksIn(APOLLO).filter((t) => t.refNumber === 8)).toEqual([]);
    } finally {
      answer(sam.id);
      o.setRoomAccess(APOLLO, sam.id, null);
    }
  });
});

describe("the brief", () => {
  const briefFor = async (cookie: string, id: string) =>
    (await (await o.send(officeAgentBriefPath(id), "GET", cookie)).json()) as KioskBrief;

  test("says what is on its board, to someone who sees the room", async () => {
    const brief = await briefFor(o.people.mia.cookie, apollo.id);
    expect(brief).toMatchObject({
      agentId: apollo.id,
      operationId: APOLLO,
      operationName: "Apollo",
      board: "issues",
      headline: "2 open issues.",
      canEnqueue: true,
    });
    const text = brief.lines.join("\n");
    expect(text).toContain("#7 Login loops");
    expect(text).toContain("#8 Dark mode");
    // Nothing of the other room.
    expect(JSON.stringify(brief)).not.toContain("Secret plan");

    const pulls = await briefFor(o.people.sam.cookie, borealis.id);
    expect(pulls.headline).toBe("1 open pull request.");
    expect(JSON.stringify(pulls)).not.toContain("Login loops");
  });

  test("says whether it can queue for this person", async () => {
    const { mia, ada } = o.people;
    o.setRoomAccess(APOLLO, mia.id, "view");
    expect((await briefFor(mia.cookie, apollo.id)).canEnqueue).toBe(false);
    o.setRoomAccess(APOLLO, mia.id, "spawn");
    await o.send(`${A}/${apollo.id}`, "PATCH", ada.cookie, { preset: "observer" });
    expect((await briefFor(mia.cookie, apollo.id)).canEnqueue).toBe(false);
    await o.send(`${A}/${apollo.id}`, "PATCH", ada.cookie, { preset: "coordinator" });
    expect((await briefFor(mia.cookie, apollo.id)).canEnqueue).toBe(true);
  });

  test("an agent that is not a placed helper has none", async () => {
    const made = await create(o.people.ada.cookie, {
      ...helper({ name: "Number Two", role: "pm", model: "opus" }),
      kiosk: undefined,
    });
    expect(made.status).toBe(201);
    const pm = (await made.json()) as OfficeAgentView;
    expect((await o.send(officeAgentBriefPath(pm.id), "GET", o.people.ada.cookie)).status).toBe(
      404,
    );
  });
});

describe("how a helper runs", () => {
  test("on the office PM's model while there is one, with its own tools and room", async () => {
    // "Number Two" (the test above) is the office PM, on opus; the helper was made on haiku.
    const card = (
      (await (await o.send(A, "GET", o.people.ada.cookie)).json()) as OfficeAgentsResponse
    ).agents.find((a) => a.id === apollo.id);
    expect(card?.kiosk?.runsLikePm).toBe(true);
    await o.send(`${A}/${apollo.id}/stop`, "POST", o.people.ada.cookie, {});
    await o.send(`${A}/${apollo.id}/start`, "POST", o.people.ada.cookie, {});
    const run = o.fake.started.get(apollo.id)?.agent;
    expect(run).toMatchObject({
      role: "kiosk",
      model: "opus",
      profileId: "office:claude-code",
      kiosk: { operationId: APOLLO, board: "issues" },
    });
    // The PM's model, not the PM's reach.
    const tools = o.officeAgents.tools.list({ role: "kiosk", preset: "coordinator" });
    expect(tools.map((t) => t.name).sort()).toEqual([...KIOSK_TOOLS].sort());
  });

  test("a helper placed to run on its own keeps its own model", async () => {
    const made = await create(
      o.people.ada.cookie,
      helper({
        name: "Apollo queue",
        kiosk: { operationId: APOLLO, board: "queue", viaPm: false },
      }),
    );
    const own = (await made.json()) as OfficeAgentView;
    expect(own.kiosk).toMatchObject({ viaPm: false, runsLikePm: false });
    await o.send(`${A}/${own.id}/start`, "POST", o.people.ada.cookie, {});
    expect(o.fake.started.get(own.id)?.agent.model).toBe("haiku");
  });
});

describe("a helper's name", () => {
  test("is unique in its room only: a name somebody cannot see is never 'taken' for them", async () => {
    const { ada, sam } = o.people;
    // Sam, made an admin for this, sees Borealis and not Apollo, where "Apollo issues" stands.
    o.db.$client.run(`update user_profiles set role = 'admin' where user_id = '${sam.id}'`);
    try {
      const same = await create(
        sam.cookie,
        helper({ name: "Apollo issues", kiosk: { operationId: BOREALIS, board: "queue" } }),
      );
      // Not "name_taken", which would tell him a helper of that name exists somewhere.
      expect(same.status).toBe(201);
      const made = (await same.json()) as OfficeAgentView;
      expect((await o.send(`${A}/${made.id}`, "DELETE", sam.cookie)).status).toBe(204);
      // Nor does an ordinary agent of that name give it away.
      const plain = await create(sam.cookie, {
        ...helper({ name: "Apollo issues", role: "custom" }),
        kiosk: undefined,
      });
      expect(plain.status).toBe(201);
      await o.send(`${A}/${((await plain.json()) as OfficeAgentView).id}`, "DELETE", sam.cookie);
    } finally {
      o.db.$client.run(`update user_profiles set role = 'member' where user_id = '${sam.id}'`);
    }
    // In its own room a second helper of that name is refused, to someone who sees the room.
    const again = await create(
      ada.cookie,
      helper({ name: "apollo  ISSUES", kiosk: { operationId: APOLLO, board: "pulls" } }),
    );
    expect([again.status, await errorCode(again)]).toEqual([409, "name_taken"]);
  });
});

describe("when the office PM changes", () => {
  test("a running helper that runs like it is stopped, and starts again on what is current", async () => {
    const ada = o.people.ada.cookie;
    const agents = async () =>
      ((await (await o.send(A, "GET", ada)).json()) as OfficeAgentsResponse).agents;
    const pm = (await agents()).find((a) => a.role === "pm");
    if (!pm) throw new Error("no office PM");
    const own = (await agents()).find((a) => a.name === "Apollo queue");
    if (!own) throw new Error("no helper that runs on its own");
    const start = async (id: string) => {
      await o.send(`${A}/${id}/start`, "POST", ada, {});
      return o.fake.started.get(id)?.agent.model;
    };
    expect(await start(apollo.id)).toBe("opus");
    expect(await start(own.id)).toBe("haiku");

    // Another model for the PM: its helper must not keep the old one.
    expect((await o.send(`${A}/${pm.id}`, "PATCH", ada, { model: "sonnet" })).status).toBe(200);
    expect(o.fake.started.has(apollo.id)).toBe(false);
    // One that runs on its own is left alone.
    expect(o.fake.started.has(own.id)).toBe(true);
    expect(await start(apollo.id)).toBe("sonnet");

    // The PM is removed: the helper is stopped, and next runs on its own choice.
    expect((await o.send(`${A}/${pm.id}`, "DELETE", ada)).status).toBe(204);
    expect(o.fake.started.has(apollo.id)).toBe(false);
    expect(await start(apollo.id)).toBe("haiku");
    await o.send(`${A}/${own.id}/stop`, "POST", ada, {});
  });
});

describe("when its room goes", () => {
  const archived = (at: Date | null) =>
    o.db.update(operations).set({ archivedAt: at }).where(eq(operations.id, BOREALIS)).run();

  test("archived: the helper is stopped and hidden; restored, it is there again", async () => {
    const { ada, sam } = o.people;
    const token = await tokenOf(borealis.id);
    await o.send(`${A}/${borealis.id}/start`, "POST", ada.cookie, {});
    expect(o.fake.started.has(borealis.id)).toBe(true);

    // What operations/service.ts does when a room is archived (wired in index.ts).
    archived(new Date());
    await o.officeAgents.kioskRooms.roomArchived(BOREALIS);
    expect(o.fake.started.has(borealis.id)).toBe(false);
    expect(o.officeAgents.store.get(borealis.id)?.status).toBe("stopped");
    // Not a person's stop (#301): restored, it stands at its board again without being started.
    expect(o.officeAgents.store.get(borealis.id)?.stoppedByPerson).toBe(false);
    expect(o.officeAgents.store.get(borealis.id)?.statusReason).toBe("its room was archived");
    expect(await names(sam.cookie)).not.toContain("Borealis pulls");
    expect(await names(ada.cookie)).not.toContain("Borealis pulls");
    expect((await o.send(officeAgentBriefPath(borealis.id), "GET", sam.cookie)).status).toBe(404);
    // Nobody can start it or talk to it while its room is archived.
    for (const [path, body] of [
      ["start", {}],
      ["messages", { text: "hello" }],
    ] as const) {
      expect((await o.send(`${A}/${borealis.id}/${path}`, "POST", ada.cookie, body)).status).toBe(
        404,
      );
    }
    expect(o.fake.started.has(borealis.id)).toBe(false);
    expect((await o.tool(token, "read_board", { operationId: BOREALIS })).status).toBe(404);

    archived(null);
    expect(await names(sam.cookie)).toContain("Borealis pulls");
    expect((await o.send(officeAgentBriefPath(borealis.id), "GET", sam.cookie)).status).toBe(200);
  });

  test("deleted: the helper is stopped and removed with it; nobody is left a card", async () => {
    const { ada, mia, sam, olga } = o.people;
    const token = await tokenOf(borealis.id);
    await o.send(`${A}/${borealis.id}/start`, "POST", ada.cookie, {});
    expect(o.fake.started.has(borealis.id)).toBe(true);

    // What operations/lifecycle.ts does when a room is deleted: the helpers first, then the room.
    await o.officeAgents.kioskRooms.roomDeleted(BOREALIS);
    o.db.delete(operations).where(eq(operations.id, BOREALIS)).run();

    expect(o.fake.started.has(borealis.id)).toBe(false);
    expect(o.officeAgents.store.get(borealis.id)).toBeUndefined();
    for (const person of [ada, mia, sam, olga]) {
      expect(await names(person.cookie)).not.toContain("Borealis pulls");
      for (const path of ["conversation", "brief", "soul"]) {
        expect((await o.send(`${A}/${borealis.id}/${path}`, "GET", person.cookie)).status).toBe(
          404,
        );
      }
      const said = await o.send(`${A}/${borealis.id}/messages`, "POST", person.cookie, {
        text: "Are you still there?",
      });
      expect(said.status).toBe(404);
    }
    // Its token died with it.
    expect((await o.tool(token, "list_operations")).status).toBe(401);
    // The record of its removal does not carry its name (a helper is named after its room).
    const removal = o.audits("office_agent.delete").find((a) => a.targetId === borealis.id);
    expect(removal?.meta).toEqual({
      shared: true,
      role: "kiosk",
      reason: "room_removed",
      operationId: BOREALIS,
    });
  });

  test("a helper left without a placement is office business only, and goes at the next boot", async () => {
    const { ada, mia, olga } = o.people;
    // A room that went another way than the office's own delete: only the cascade ran.
    o.db.delete(officeAgentKiosks).where(eq(officeAgentKiosks.agentId, apollo.id)).run();
    // No member sees a card with the room's name on it, or can talk to it on the office key.
    expect(await names(mia.cookie)).not.toContain("Apollo issues");
    expect((await o.send(`${A}/${apollo.id}/conversation`, "GET", mia.cookie)).status).toBe(404);
    const said = await o.send(`${A}/${apollo.id}/messages`, "POST", mia.cookie, { text: "hello" });
    expect(said.status).toBe(404);
    // Office owners and admins do, to see what is left.
    expect(await names(olga.cookie)).toContain("Apollo issues");
    expect(await names(ada.cookie)).toContain("Apollo issues");
    expect(errorOf(await o.tool(apolloToken, "post_chat", { text: "hello" }))).toBe("role_forbids");
    expect(
      resultOf<{ operations: unknown[] }>(await o.tool(apolloToken, "list_operations")).operations,
    ).toEqual([]);

    expect(o.officeAgents.kioskRooms.sweep()).toBe(1);
    expect(o.officeAgents.store.get(apollo.id)).toBeUndefined();
    expect(await names(olga.cookie)).not.toContain("Apollo issues");
    expect(o.officeAgents.kioskRooms.sweep()).toBe(0);
  });
});

describe("the Hermes routes", () => {
  test("answer for a hidden helper as for an agent that does not exist", async () => {
    const made = await create(
      o.people.ada.cookie,
      helper({ name: "Apollo pulls", kiosk: { operationId: APOLLO, board: "pulls" } }),
    );
    expect(made.status).toBe(201);
    const hidden = (await made.json()) as OfficeAgentView;
    // Sam sees no Apollo; Olga, the office owner, has no GitHub access at all.
    for (const cookie of [o.people.sam.cookie, o.people.olga.cookie]) {
      const body = { url: "http://127.0.0.1:9", token: "x".repeat(24) };
      const there = await o.send(`${A}/${hidden.id}/hermes`, "PUT", cookie, body);
      const missing = await o.send(`${A}/nope/hermes`, "PUT", cookie, body);
      expect([there.status, await there.text()]).toEqual([missing.status, await missing.text()]);
      expect(there.status).toBe(404);
    }
  });
});
