/**
 * An office agent a person stopped has no body in the world, and appears
 * again when it is started (#301; D37). An agent that merely is not running
 * keeps its body: a new one, every one after an office restart, and one the
 * office stopped to pick up a new document at its next message. Over a real
 * office with sessions and the real `AgentWorld`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentsResponse,
  type OfficeAgentView,
  officeAgentMindPaths,
} from "@regulus/protocol";
import { type AgentsOffice, agentsOffice } from "../test-helpers.ts";
import { ACME, APOLLO, lairState, person, type TestState } from "./test-lair.ts";

let o: AgentsOffice;
let mine: OfficeAgentView;
let shared: OfficeAgentView;
let state: TestState;
let clock = 1_000_000;
const A = OFFICE_AGENTS_API_PATH;

/** A few seconds of the world: longer than it takes to re-read the agent list. True when a body came or went. */
function pass(): boolean {
  let placed = false;
  for (let i = 0; i < 40; i++) {
    clock += 100;
    placed = o.officeAgents.world.tick(state, clock) || placed;
  }
  return placed;
}
const bodies = () => [...state.officeAgents.keys()].sort();
const both = () => [mine.id, shared.id].sort();
const act = (id: string, verb: "start" | "stop", cookie: string) =>
  o.send(`${A}/${id}/${verb}`, "POST", cookie);
const card = async (id: string, cookie: string) =>
  ((await (await o.send(A, "GET", cookie)).json()) as OfficeAgentsResponse).agents.find(
    (a) => a.id === id,
  );
const stored = (id: string) => o.officeAgents.store.get(id);

beforeAll(async () => {
  o = await agentsOffice();
  const base = { engine: "cli-session", provider: "claude-code", model: "sonnet" };
  const a = await o.send(A, "POST", o.people.mia.cookie, {
    ...base,
    name: "Quillon",
    owner: "me",
    role: "assistant",
  });
  mine = (await a.json()) as OfficeAgentView;
  const b = await o.send(A, "POST", o.people.ada.cookie, {
    ...base,
    name: "Ledger",
    owner: "office",
    role: "pm",
    profileId: o.addOfficeKey(),
  });
  shared = (await b.json()) as OfficeAgentView;
  expect(o.officeAgents.store.setGrants(shared.id, [{ operationId: APOLLO, access: "view" }])).toBe(
    true,
  );
  state = lairState();
  person(state, o.people.mia.id, { x: 60, z: 120 });
});
afterAll(async () => {
  await o.stop();
});

describe("only an agent a person stopped has no body", () => {
  test("a new agent is not running yet and has its body: yours beside you, the PM at reception", () => {
    expect([mine.status, shared.status]).toEqual(["stopped", "stopped"]);
    pass();
    expect(bodies()).toEqual(both());
    expect(state.officeAgents.get(mine.id)).toMatchObject({ name: "Quillon", mode: "follow" });
    expect(state.officeAgents.get(shared.id)).toMatchObject({ mode: "post", post: "reception" });
  });

  test("its owner stops it: it is gone, and nothing of it is left in the state", async () => {
    const res = await act(mine.id, "stop", o.people.mia.cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as OfficeAgentView).stoppedByPerson).toBe(true);
    // Who may see what has changed: the room is told to bring its clients' views in line.
    expect(pass()).toBe(true);
    expect(bodies()).toEqual([shared.id]);
    expect(JSON.stringify(state.officeAgents.toJSON())).not.toContain("Quillon");
  });

  test("started again, it is back", async () => {
    const res = await act(mine.id, "start", o.people.mia.cookie);
    expect(((await res.json()) as OfficeAgentView).stoppedByPerson).toBeUndefined();
    expect(pass()).toBe(true);
    expect(bodies()).toEqual(both());
  });

  test("a message to an agent that was stopped starts it, and brings its body back", async () => {
    await act(mine.id, "stop", o.people.mia.cookie);
    pass();
    expect(bodies()).toEqual([shared.id]);
    const sent = await o.send(`${A}/${mine.id}/messages`, "POST", o.people.mia.cookie, {
      text: "hello",
    });
    expect(sent.status).toBe(202);
    await o.fake.idle();
    pass();
    expect(bodies()).toEqual(both());
    expect(stored(mine.id)?.stoppedByPerson).toBe(false);
  });

  test("an admin's emergency stop hides someone's personal agent, and says so on its card", async () => {
    const res = await act(mine.id, "stop", o.people.ada.cookie);
    expect(res.status).toBe(200);
    expect(o.audits("office_agent.emergency_stop")).toHaveLength(1);
    pass();
    expect(bodies()).toEqual([shared.id]);
    expect(await card(mine.id, o.people.mia.cookie)).toMatchObject({
      status: "stopped",
      stoppedByPerson: true,
    });
    // It stays hidden across an office restart: it was stopped, not interrupted.
    o.officeAgents.boot();
    pass();
    expect(bodies()).toEqual([shared.id]);
    await act(mine.id, "start", o.people.mia.cookie);
    pass();
    expect(bodies()).toEqual(both());
  });

  test("saving a new document stops a running agent for its next message; its body stays", async () => {
    expect(o.officeAgents.runtime.isRunning(mine.id)).toBe(true);
    const saved = await o.send(officeAgentMindPaths(mine.id).soul, "PUT", o.people.mia.cookie, {
      content: "You are Quillon. Answer briefly.",
    });
    expect(saved.status).toBe(200);
    // The office stopped it (it starts with the new document at the next message)...
    expect(o.officeAgents.runtime.isRunning(mine.id)).toBe(false);
    expect(stored(mine.id)).toMatchObject({ status: "stopped", stoppedByPerson: false });
    // ...and nobody sees it go.
    expect(pass()).toBe(false);
    expect(bodies()).toEqual(both());
    // The same for a change of its configuration.
    await act(mine.id, "start", o.people.mia.cookie);
    const patched = await o.send(`${A}/${mine.id}`, "PATCH", o.people.mia.cookie, {
      model: "opus",
    });
    expect(patched.status).toBe(200);
    expect(stored(mine.id)).toMatchObject({ status: "stopped", stoppedByPerson: false });
    expect(pass()).toBe(false);
    expect(bodies()).toEqual(both());
  });

  test("after an office restart the lair is as it was: the PM at reception walking its rounds, yours beside you", async () => {
    await act(shared.id, "start", o.people.ada.cookie);
    await act(mine.id, "start", o.people.mia.cookie);
    o.officeAgents.boot();
    // No engine run survives a restart: every agent is stopped until its next message.
    expect([stored(mine.id)?.status, stored(shared.id)?.status]).toEqual(["stopped", "stopped"]);
    expect(pass()).toBe(false);
    expect(bodies()).toEqual(both());
    expect(state.officeAgents.get(mine.id)?.mode).toBe("follow");
    expect(state.officeAgents.get(shared.id)).toMatchObject({ mode: "post", post: "reception" });

    // Someone is on Apollo's level; over the next quarter of an hour the PM sets off on its round
    // into the room it was granted, though it has not been started since the restart.
    person(state, o.people.sam.id, { x: 60, z: 120, levelId: ACME });
    const quarter = 15 * 60_000;
    const from = (Math.floor(clock / quarter) + 1) * quarter;
    const modes = new Set<string>();
    const rooms = new Set<string>();
    for (clock = from - 4_000; clock < from + quarter; clock += 100) {
      o.officeAgents.world.tick(state, clock);
      const body = state.officeAgents.get(shared.id);
      modes.add(body?.mode ?? "");
      rooms.add(body?.operationId ?? "");
    }
    expect([...modes].sort()).toEqual(["post", "route"]);
    expect(rooms.has(APOLLO)).toBe(true);
    expect(stored(shared.id)?.status).toBe("stopped");
  });
});
