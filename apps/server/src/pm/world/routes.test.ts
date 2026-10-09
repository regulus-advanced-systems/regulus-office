/**
 * Office agents in the world over a real server with sessions (#252): who may
 * dismiss and recall, what each person learns about what an agent wants, and
 * where a body goes when the office's own access gate decides.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  OFFICE_AGENT_ATTENTION_API_PATH,
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentAttention,
  type OfficeAgentsResponse,
  type OfficeAgentView,
  officeAgentDismissPath,
  officeAgentRecallPath,
  officeAgentSeenPath,
} from "@regulus/protocol";
import { type AgentsOffice, agentsOffice, BOREALIS } from "../test-helpers.ts";
import { centreOf, inRect, readLair } from "./geometry.ts";
import { ACME, APOLLO, lairState, person } from "./test-lair.ts";

let o: AgentsOffice;
let hermes: OfficeAgentView;
let shared: OfficeAgentView;
const nudged: string[] = [];
const SECRET = "the launch code is 0451";

beforeAll(async () => {
  o = await agentsOffice({
    fake: { reply: (_agent, message) => `About "${message.text}": ${SECRET}` },
  });
  o.officeAgents.onAttention((userId) => nudged.push(userId));
  const base = { engine: "cli-session", provider: "claude-code", model: "sonnet" };
  const mine = await o.send(OFFICE_AGENTS_API_PATH, "POST", o.people.mia.cookie, {
    ...base,
    name: "Quillon",
    owner: "me",
    role: "assistant",
    appearance: "secretary",
  });
  hermes = (await mine.json()) as OfficeAgentView;
  const office = await o.send(OFFICE_AGENTS_API_PATH, "POST", o.people.olga.cookie, {
    ...base,
    name: "Number Two",
    owner: "office",
    role: "pm",
    profileId: o.addOfficeKey(),
  });
  shared = (await office.json()) as OfficeAgentView;
  // Granted by someone who has the room themselves (the rule for that is in routes.test.ts).
  expect(o.officeAgents.store.setGrants(shared.id, [{ operationId: APOLLO, access: "view" }])).toBe(
    true,
  );
});
afterAll(async () => {
  await o.stop();
});

const post = (path: string, cookie: string, origin?: string) =>
  o.send(path, "POST", cookie, undefined, origin);
const attention = async (cookie: string) =>
  (await (
    await o.send(OFFICE_AGENT_ATTENTION_API_PATH, "GET", cookie)
  ).json()) as OfficeAgentAttention;
const error = async (res: Response) => ((await res.json()) as { error?: string }).error;

describe("dismiss and recall", () => {
  test("a new agent is not dismissed", () => {
    expect(hermes.dismissed).toBe(false);
    expect(shared.dismissed).toBe(false);
  });

  test("only the person it belongs to may dismiss a personal agent", async () => {
    const { mia, sam, ada, olga } = o.people;
    expect(
      (await o.office.request(officeAgentDismissPath(hermes.id), { method: "POST" })).status,
    ).toBe(401);
    // Someone who cannot see it: it does not exist. An admin who sees its card: not theirs.
    expect((await post(officeAgentDismissPath(hermes.id), sam.cookie)).status).toBe(404);
    for (const admin of [ada, olga]) {
      const res = await post(officeAgentDismissPath(hermes.id), admin.cookie);
      expect(res.status).toBe(403);
      expect(await error(res)).toBe("not_your_agent");
    }
    expect(
      (await post(officeAgentDismissPath(hermes.id), mia.cookie, "https://evil.example")).status,
    ).toBe(403);
    expect(o.officeAgents.store.get(hermes.id)?.dismissed).toBe(false);

    const res = await post(officeAgentDismissPath(hermes.id), mia.cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as OfficeAgentView).dismissed).toBe(true);
    expect(o.audits("office_agent.dismiss").map((a) => a.userId)).toEqual([mia.id]);
  });

  test("the flag is stored: it survives a restart and shows on the card", async () => {
    o.officeAgents.boot();
    expect(o.officeAgents.store.get(hermes.id)?.dismissed).toBe(true);
    const list = (await (
      await o.send(OFFICE_AGENTS_API_PATH, "GET", o.people.mia.cookie)
    ).json()) as OfficeAgentsResponse;
    expect(list.agents.find((a) => a.id === hermes.id)?.dismissed).toBe(true);
  });

  test("only its owner may recall it", async () => {
    const { mia, sam, ada } = o.people;
    expect((await post(officeAgentRecallPath(hermes.id), sam.cookie)).status).toBe(404);
    expect((await post(officeAgentRecallPath(hermes.id), ada.cookie)).status).toBe(403);
    expect(o.officeAgents.store.get(hermes.id)?.dismissed).toBe(true);
    const res = await post(officeAgentRecallPath(hermes.id), mia.cookie);
    expect(((await res.json()) as OfficeAgentView).dismissed).toBe(false);
    expect(o.audits("office_agent.recall")).toHaveLength(1);
    // Recalling one that is already beside you changes nothing and is not audited again.
    await post(officeAgentRecallPath(hermes.id), mia.cookie);
    expect(o.audits("office_agent.recall")).toHaveLength(1);
  });

  test("a shared agent wanders anyway: nobody dismisses it", async () => {
    for (const person of [o.people.olga, o.people.mia]) {
      const res = await post(officeAgentDismissPath(shared.id), person.cookie);
      expect(res.status).toBe(400);
      expect(await error(res)).toBe("shared_agents_wander");
    }
  });
});

describe("what an agent wants from a person", () => {
  test("nobody but its owner talks to a personal agent or reads its conversation", async () => {
    const { sam, ada } = o.people;
    const messages = `${OFFICE_AGENTS_API_PATH}/${hermes.id}/messages`;
    const conversation = `${OFFICE_AGENTS_API_PATH}/${hermes.id}/conversation`;
    expect((await o.send(messages, "POST", sam.cookie, { text: "hi" })).status).toBe(404);
    expect((await o.send(messages, "POST", ada.cookie, { text: "hi" })).status).toBe(403);
    expect((await o.send(conversation, "GET", ada.cookie)).status).toBe(403);
    expect((await post(officeAgentSeenPath(hermes.id), sam.cookie)).status).toBe(404);
    expect((await post(officeAgentSeenPath(hermes.id), ada.cookie)).status).toBe(403);
    expect(o.fake.sent).toHaveLength(0);
  });

  test("an unread reply shows for its reader only, until they have seen it", async () => {
    const { mia, sam, ada } = o.people;
    expect((await attention(mia.cookie)).agents).toEqual([]);
    nudged.length = 0;
    await o.send(`${OFFICE_AGENTS_API_PATH}/${hermes.id}/messages`, "POST", mia.cookie, {
      text: "status?",
    });
    await o.fake.idle();
    expect((await attention(mia.cookie)).agents).toEqual([
      { agentId: hermes.id, unread: true, waiting: false },
    ]);
    // Her clients were told to look; nobody else's were, and nobody else learns of it.
    expect(new Set(nudged)).toEqual(new Set([mia.id]));
    expect((await attention(sam.cookie)).agents).toEqual([]);
    expect((await attention(ada.cookie)).agents).toEqual([]);

    expect((await post(officeAgentSeenPath(hermes.id), mia.cookie)).status).toBe(204);
    expect((await attention(mia.cookie)).agents).toEqual([]);
  });

  test("a question it asks shows for the person asked only", async () => {
    const { mia, sam } = o.people;
    o.officeAgents.requests.create({
      agentId: shared.id,
      forUserId: sam.id,
      question: "Ship Borealis tonight?",
      options: ["Yes", "No"],
    });
    expect((await attention(sam.cookie)).agents).toEqual([
      { agentId: shared.id, question: "Ship Borealis tonight?", unread: false, waiting: false },
    ]);
    expect((await attention(mia.cookie)).agents).toEqual([]);
    expect(nudged.at(-1)).toBe(sam.id);
  });
});

describe("bodies and the office's access gate", () => {
  const step = (state: ReturnType<typeof lairState>, from: number) => {
    for (let t = from; t < from + 4_000; t += 100) o.officeAgents.world.tick(state, t);
  };
  const start = (id: string, cookie: string) =>
    post(`${OFFICE_AGENTS_API_PATH}/${id}/start`, cookie);

  // Only a started agent has a body (#301; stopped-bodies.test.ts).
  beforeAll(async () => {
    expect((await start(hermes.id, o.people.mia.cookie)).status).toBe(200);
    expect((await start(shared.id, o.people.olga.cookie)).status).toBe(200);
  });

  test("a personal agent goes where its owner may and waits at the door elsewhere", () => {
    const state = lairState();
    const lair = readLair(state);
    const rect = (id: string) => lair.levels.get(ACME)?.rooms.find((r) => r.id === id)?.rect;
    const apollo = rect(APOLLO);
    const borealis = rect(BOREALIS);
    if (!apollo || !borealis) throw new Error("no rooms");
    // Mia may spawn in Apollo and has nothing in Borealis.
    person(state, o.people.mia.id, { ...centreOf(apollo), levelId: ACME });
    step(state, 10_000);
    const body = state.officeAgents.get(hermes.id);
    expect(body?.mode).toBe("follow");
    expect(body?.operationId).toBe(APOLLO);
    expect(body?.appearance).toBe("secretary");
    expect(body?.ownerName).toBe("Mia");

    person(state, o.people.mia.id, { ...centreOf(borealis), levelId: ACME });
    step(state, 20_000);
    expect(body?.mode).toBe("wait");
    expect(body?.operationId).toBe(LOBBY_OPERATION_ID);
    expect(inRect(borealis, body?.target ?? { x: 0, z: 0 })).toBe(false);

    // Access granted to her is access for her agent, with no change to the agent.
    o.setAccess(BOREALIS, o.people.mia.id, "view");
    step(state, 30_000);
    expect(body?.mode).toBe("follow");
    expect(body?.operationId).toBe(BOREALIS);
    o.setAccess(APOLLO, o.people.mia.id, "spawn");
  });

  test("the office PM keeps the reception desk and its round enters only the rooms it was granted", () => {
    const state = lairState();
    person(state, o.people.sam.id, { x: 60, z: 120, levelId: ACME });
    // From just before a quarter of an hour to the next one (the default rhythm).
    const quarter = 15 * 60_000;
    const rooms = new Set<string>();
    const modes = new Set<string>();
    const lines = new Set<string>();
    for (let t = 40 * quarter - 4_000; t < 41 * quarter; t += 4_000) {
      step(state, t);
      const body = state.officeAgents.get(shared.id);
      rooms.add(body?.operationId ?? "");
      modes.add(body?.mode ?? "");
      // (Between levels it steps out of the lift, #269.)
      if (body?.doing !== "stepping out of the lift") lines.add(body?.doing ?? "");
    }
    // Apollo was granted; Borealis, on the same level, was not.
    expect([...rooms].sort()).toEqual([LOBBY_OPERATION_ID, APOLLO].sort());
    expect([...modes].sort()).toEqual(["post", "route"]);
    expect([...lines].sort()).toEqual([
      "at reception",
      "checking the PR board",
      "checking the issue board",
    ]);
    const body = state.officeAgents.get(shared.id);
    expect(body).toMatchObject({ mode: "post", post: "reception", levelId: LOBBY_LEVEL_ID });
    // No look was chosen for it: a project manager wears the PM suit.
    expect(shared.appearance).toBe("number_two");
    expect(body?.appearance).toBe("number_two");
    const published = JSON.stringify(state.officeAgents.toJSON());
    expect(published).not.toContain(SECRET);
    expect(published).not.toContain("Ship Borealis");
    expect(published).not.toContain("status?");
  });

  test("a personal agent with the job project manager is a companion: no post, no rounds", async () => {
    const { sam } = o.people;
    const res = await o.send(OFFICE_AGENTS_API_PATH, "POST", sam.cookie, {
      engine: "cli-session",
      provider: "claude-code",
      model: "sonnet",
      name: "Docket",
      owner: "me",
      role: "pm",
    });
    expect(res.status).toBe(201);
    const mine = (await res.json()) as OfficeAgentView;
    expect(mine.appearance).toBe("number_two");
    expect((await start(mine.id, sam.cookie)).status).toBe(200);
    const state = lairState();
    person(state, sam.id, { x: 60, z: 120 });
    const quarter = 15 * 60_000;
    const modes = new Set<string>();
    for (let t = 80 * quarter - 4_000; t < 80 * quarter + 120_000; t += 4_000) {
      step(state, t);
      modes.add(state.officeAgents.get(mine.id)?.mode ?? "");
    }
    expect([...modes]).toEqual(["follow"]);
    expect(state.officeAgents.get(mine.id)?.post).toBe("none");
    // A look that was chosen is kept, whatever the job.
    const chosen = await o.send(OFFICE_AGENTS_API_PATH, "POST", o.people.mia.cookie, {
      engine: "cli-session",
      provider: "claude-code",
      model: "sonnet",
      name: "Abacus",
      owner: "me",
      role: "pm",
      appearance: "secretary",
    });
    expect(((await chosen.json()) as OfficeAgentView).appearance).toBe("secretary");
  });
});
