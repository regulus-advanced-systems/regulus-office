/**
 * What an admin may hand a shared agent, and what the agent may then tell
 * (D27; #270): a person grants only rooms their own GitHub account can see,
 * at most at their own level; the office role alone gives nothing to grant;
 * grants set by someone else on rooms this admin cannot see stay as they are
 * and are not shown to them; and the usage leaderboard a shared agent reads
 * names only henchmen of rooms granted to it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentsResponse,
  type OfficeAgentView,
  type UsageSummary,
} from "@regulus/protocol";
import { type AgentsOffice, APOLLO, agentsOffice, BOREALIS } from "./test-helpers.ts";

let o: AgentsOffice;
let pm: OfficeAgentView;
const A = OFFICE_AGENTS_API_PATH;

type Grant = { operationId: string; access: "view" | "spawn" | "manage" };
const setGrants = async (cookie: string, grants: Grant[]) => {
  const res = await o.send(`${A}/${pm.id}/grants`, "PUT", cookie, { grants });
  return { status: res.status, body: (await res.json()) as OfficeAgentView & { error?: string } };
};
/** The grants of the shared agent as this person's agent list shows them. */
const grantsSeenBy = async (cookie: string) => {
  const list = (await (await o.send(A, "GET", cookie)).json()) as OfficeAgentsResponse;
  return list.agents.find((a) => a.id === pm.id)?.config?.grants;
};
/** The rooms the agent was granted, as the office keeps them. */
const openTo = async () => o.officeAgents.store.grants(pm.id).map((g) => [g.operationId, g.access]);
/**
 * What the grants let the agent read is asked in a turn of Sam's, whose own GitHub access
 * (set below) covers both rooms: a call is always answered for somebody (#301).
 */
const asSam = (name: string, input: unknown = {}) =>
  o.inTurn(pm.id, o.people.sam, (call) => call(name, input));

beforeAll(async () => {
  o = await agentsOffice({ fake: { reply: () => null } });
  o.addOfficeKey();
  const made = await o.send(A, "POST", o.people.ada.cookie, {
    name: "Number Two",
    owner: "office",
    engine: "cli-session",
    role: "pm",
    provider: "claude-code",
    model: "sonnet",
    profileId: "office:claude-code",
  });
  if (made.status !== 201) throw new Error(`create failed: ${await made.text()}`);
  pm = (await made.json()) as OfficeAgentView;
  // Ada's GitHub account may write to Apollo's repo and cannot see Borealis's.
  o.setAccess(APOLLO, o.people.ada.id, "spawn");
  o.setRoomAccess(APOLLO, o.people.sam.id, "manage");
  o.setRoomAccess(BOREALIS, o.people.sam.id, "manage");
});
afterAll(async () => {
  await o.stop();
});

describe("granting rooms to a shared agent", () => {
  test("the office role gives nothing to grant: an owner without GitHub access is refused", async () => {
    // Olga owns the office and may configure the agent, but has linked no GitHub account.
    const refused = await setGrants(o.people.olga.cookie, [
      { operationId: APOLLO, access: "view" },
    ]);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("unknown_operation");
    expect(await openTo()).toEqual([]);
  });

  test("a room the admin cannot see is refused like one that does not exist", async () => {
    const hidden = await setGrants(o.people.ada.cookie, [
      { operationId: BOREALIS, access: "view" },
    ]);
    expect(hidden.status).toBe(400);
    expect(hidden.body.error).toBe("unknown_operation");
    const missing = await setGrants(o.people.ada.cookie, [{ operationId: "nope", access: "view" }]);
    expect([missing.status, missing.body]).toEqual([hidden.status, hidden.body]);
    // One bad entry refuses the whole set.
    const mixed = await setGrants(o.people.ada.cookie, [
      { operationId: APOLLO, access: "view" },
      { operationId: BOREALIS, access: "view" },
    ]);
    expect(mixed.status).toBe(400);
    expect(await openTo()).toEqual([]);
  });

  test("no more than the admin's own access: above it 403, at or below it 200", async () => {
    const above = await setGrants(o.people.ada.cookie, [{ operationId: APOLLO, access: "manage" }]);
    expect(above.status).toBe(403);
    expect(above.body.error).toBe("grant_exceeds_your_access");
    expect(await openTo()).toEqual([]);
    const own = await setGrants(o.people.ada.cookie, [{ operationId: APOLLO, access: "spawn" }]);
    expect(own.status).toBe(200);
    expect(own.body.config?.grants).toEqual([{ operationId: APOLLO, access: "spawn" }]);
    expect(await openTo()).toEqual([[APOLLO, "spawn"]]);
  });

  test("another admin's grant on a room this admin cannot see is kept, and hidden from them", async () => {
    // Olga links GitHub and administers Borealis's repo only.
    o.setAccess(BOREALIS, o.people.olga.id, "manage");
    const olgas = await setGrants(o.people.olga.cookie, [
      { operationId: BOREALIS, access: "manage" },
    ]);
    expect(olgas.status).toBe(200);
    // Each sees the grants on the rooms they can see; the agent has both.
    expect(olgas.body.config?.grants).toEqual([{ operationId: BOREALIS, access: "manage" }]);
    expect(await grantsSeenBy(o.people.olga.cookie)).toEqual([
      { operationId: BOREALIS, access: "manage" },
    ]);
    expect(await grantsSeenBy(o.people.ada.cookie)).toEqual([
      { operationId: APOLLO, access: "spawn" },
    ]);
    expect((await openTo()).sort()).toEqual([
      [APOLLO, "spawn"],
      [BOREALIS, "manage"],
    ]);
    // Ada replaces "all" the grants: only those on rooms she can see change.
    const cleared = await setGrants(o.people.ada.cookie, []);
    expect(cleared.status).toBe(200);
    expect(cleared.body.config?.grants).toEqual([]);
    expect(JSON.stringify(cleared.body)).not.toContain(BOREALIS);
    expect(await openTo()).toEqual([[BOREALIS, "manage"]]);
    expect((await asSam("read_board", { operationId: BOREALIS })).status).toBe(200);
    expect((await asSam("read_board", { operationId: APOLLO })).status).toBe(404);
    // Once Ada's GitHub account loses Apollo too, she sees no grant and can set none.
    o.setRoomAccess(APOLLO, o.people.ada.id, null);
    expect(await grantsSeenBy(o.people.ada.cookie)).toEqual([]);
    expect(
      (await setGrants(o.people.ada.cookie, [{ operationId: APOLLO, access: "view" }])).status,
    ).toBe(400);
    expect(await openTo()).toEqual([[BOREALIS, "manage"]]);
  });
});

describe("the usage leaderboard a shared agent reads", () => {
  const row = (agentId: string, operationId: string, tokens: number) => ({
    agentId,
    operationId,
    name: `Henchman ${agentId}`,
    ownerName: "Mia",
    provider: "claude-code" as const,
    tokens,
  });
  const readUsage = async () => {
    const res = await asSam("read_usage");
    expect(res.status).toBe(200);
    const { result } = res.body as unknown as { result: { scope: string; usage: UsageSummary } };
    return { result, text: JSON.stringify(res.body) };
  };

  test("names only henchmen of rooms granted to it, and never says which room is whose", async () => {
    o.leaderboard.push(
      row("h-apollo", APOLLO, 900),
      row("h-borealis", BOREALIS, 500),
      row("h-elsewhere", "op-elsewhere", 100),
    );
    // The agent has Borealis only (the test above).
    const borealis = await readUsage();
    expect(borealis.result.scope).toBe("office");
    expect(borealis.result.usage.topHenchmen.map((h) => h.agentId)).toEqual(["h-borealis"]);
    expect(borealis.text).not.toContain("henchmanRooms");
    expect(borealis.text).not.toContain("h-apollo");
    expect(borealis.text).not.toContain(APOLLO);

    o.setAccess(APOLLO, o.people.ada.id, "view");
    expect(
      (await setGrants(o.people.ada.cookie, [{ operationId: APOLLO, access: "view" }])).status,
    ).toBe(200);
    const both = await readUsage();
    expect(both.result.usage.topHenchmen.map((h) => h.agentId)).toEqual(["h-apollo", "h-borealis"]);
    expect(both.text).not.toContain("henchmanRooms");
    expect(both.text).not.toContain("h-elsewhere");

    // With no grant left it names nobody; the office totals stay.
    expect((await setGrants(o.people.ada.cookie, [])).status).toBe(200);
    expect((await setGrants(o.people.olga.cookie, [])).status).toBe(200);
    const none = await readUsage();
    expect(none.result.usage.topHenchmen).toEqual([]);
    expect(none.result.usage).toMatchObject({ todayInputTokens: 0, activeHumans: 0 });
    expect(none.text).not.toContain("henchmanRooms");
  });
});
