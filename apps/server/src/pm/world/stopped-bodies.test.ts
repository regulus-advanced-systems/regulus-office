/**
 * A stopped office agent has no body in the world, and appears again when it
 * is started (#301; D37). Over a real office with sessions and the real
 * `AgentWorld`: personal and shared agents, started and stopped by people,
 * started by a first message, and stopped by an office restart.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OFFICE_AGENTS_API_PATH, type OfficeAgentView } from "@regulus/protocol";
import { type AgentsOffice, agentsOffice } from "../test-helpers.ts";
import { lairState, person, type TestState } from "./test-lair.ts";

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
const act = (id: string, verb: "start" | "stop", cookie: string) =>
  o.send(`${A}/${id}/${verb}`, "POST", cookie);

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
  state = lairState();
  person(state, o.people.mia.id, { x: 60, z: 120 });
});
afterAll(async () => {
  await o.stop();
});

describe("stopped agents have no body", () => {
  test("a new agent is stopped: neither a personal nor a shared one is in the world", () => {
    expect([mine.status, shared.status]).toEqual(["stopped", "stopped"]);
    pass();
    expect(bodies()).toEqual([]);
  });

  test("started, it appears; the others stay out", async () => {
    expect((await act(mine.id, "start", o.people.mia.cookie)).status).toBe(200);
    // Who may see what has changed: the room is told to bring its clients' views in line.
    expect(pass()).toBe(true);
    expect(bodies()).toEqual([mine.id]);
    expect(state.officeAgents.get(mine.id)).toMatchObject({ name: "Quillon", mode: "follow" });
    expect(state.officeAgents.get(mine.id)?.status).not.toBe("stopped");
  });

  test("stopped, it is gone, and nothing of it is left in the state", async () => {
    expect((await act(mine.id, "stop", o.people.mia.cookie)).status).toBe(200);
    expect(pass()).toBe(true);
    expect(bodies()).toEqual([]);
    expect(JSON.stringify(state.officeAgents.toJSON())).not.toContain("Quillon");
  });

  test("its first message starts it: it is back, and so is the office PM at its desk", async () => {
    const sent = await o.send(`${A}/${mine.id}/messages`, "POST", o.people.mia.cookie, {
      text: "hello",
    });
    expect(sent.status).toBe(202);
    await o.fake.idle();
    expect((await act(shared.id, "start", o.people.ada.cookie)).status).toBe(200);
    pass();
    expect(bodies()).toEqual([mine.id, shared.id].sort());
    expect(state.officeAgents.get(shared.id)).toMatchObject({ mode: "post", post: "reception" });
  });

  test("an emergency stop by an admin hides someone's personal agent too", async () => {
    expect((await act(mine.id, "stop", o.people.ada.cookie)).status).toBe(200);
    pass();
    expect(bodies()).toEqual([shared.id]);
  });

  test("after an office restart every agent is stopped, so none has a body until it is started", async () => {
    await o.send(`${A}/${mine.id}/start`, "POST", o.people.mia.cookie);
    pass();
    expect(bodies()).toHaveLength(2);
    o.officeAgents.boot();
    pass();
    expect(bodies()).toEqual([]);
    expect((await act(shared.id, "start", o.people.ada.cookie)).status).toBe(200);
    pass();
    expect(bodies()).toEqual([shared.id]);
  });
});
