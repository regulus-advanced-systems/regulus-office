/**
 * Stopping and starting an office agent do not cross (#301): a stop takes
 * time (the engine waits for the turn it kills), and a start or a message can
 * arrive meanwhile. The start waits for the stop, so the stop never takes the
 * new run's token or writes "stopped" over it; and what the person who
 * stopped it meant (no body in the world) is overruled by the later start,
 * not left behind on an agent that runs.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OFFICE_AGENTS_API_PATH, type OfficeAgentView } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { officeAgentTokens } from "../db/schema/index.ts";
import { type AgentsOffice, agentsOffice } from "./test-helpers.ts";

const A = OFFICE_AGENTS_API_PATH;
/** How long the fake engine's stop takes: long enough for a start to arrive in the middle. */
const STOP_MS = 120;

let o: AgentsOffice;
let agent: OfficeAgentView;

beforeAll(async () => {
  o = await agentsOffice({ fake: { stopMs: STOP_MS } });
  const res = await o.send(A, "POST", o.people.mia.cookie, {
    name: "Quillon",
    owner: "me",
    engine: "cli-session",
    role: "assistant",
    provider: "claude-code",
    model: "sonnet",
  });
  agent = (await res.json()) as OfficeAgentView;
});
afterAll(async () => {
  await o.stop();
});

const row = () => {
  const found = o.officeAgents.store.get(agent.id);
  if (!found) throw new Error("gone");
  return found;
};
const runTokens = () =>
  o.db
    .select()
    .from(officeAgentTokens)
    .where(eq(officeAgentTokens.agentId, agent.id))
    .all()
    .filter((t) => t.kind === "session");

describe("a start that arrives while the agent is being stopped", () => {
  test("waits for the stop: the new run keeps its token, and is not marked stopped", async () => {
    const rt = o.officeAgents.runtime;
    await rt.start(row());
    expect(rt.isRunning(agent.id)).toBe(true);
    const stopping = rt.stop(agent.id, "cli-session");
    // In the middle of the stop.
    await Bun.sleep(STOP_MS / 4);
    const starting = rt.start(row());
    await Promise.all([stopping, starting]);
    // Whatever the stop still had to do, it did before the start: none of it hit the new run.
    await Bun.sleep(STOP_MS * 2);
    expect(rt.isRunning(agent.id)).toBe(true);
    expect(row().status).toBe("ready");
    expect(o.fake.started.has(agent.id)).toBe(true);
    expect(runTokens()).toHaveLength(1);
    // And the engine saw them in order: stopped, then started.
    expect(o.fake.stopped.at(-1)).toBe(agent.id);
  });

  test("two stops and a start in a row end as started", async () => {
    const rt = o.officeAgents.runtime;
    const first = rt.stop(agent.id, "cli-session");
    const second = rt.stop(agent.id, "cli-session");
    const starting = rt.start(row());
    await Promise.all([first, second, starting]);
    await Bun.sleep(STOP_MS * 2);
    expect([rt.isRunning(agent.id), row().status]).toEqual([true, "ready"]);
  });
});

describe("what the person who stopped it meant", () => {
  test("stopped by its owner: not running, and marked as stopped by a person", async () => {
    const res = await o.send(`${A}/${agent.id}/stop`, "POST", o.people.mia.cookie);
    expect(res.status).toBe(200);
    expect(row()).toMatchObject({ status: "stopped", stoppedByPerson: true });
    expect(o.officeAgents.runtime.isRunning(agent.id)).toBe(false);
  });

  test("a message that arrives while it is being stopped starts it again: it runs, and is not left marked as stopped", async () => {
    await o.officeAgents.runtime.start(row());
    const stopping = o.send(`${A}/${agent.id}/stop`, "POST", o.people.mia.cookie);
    await Bun.sleep(STOP_MS / 4);
    const sent = await o.send(`${A}/${agent.id}/messages`, "POST", o.people.mia.cookie, {
      text: "one more thing",
    });
    expect(sent.status).toBe(202);
    expect((await stopping).status).toBe(200);
    await o.fake.idle();
    await Bun.sleep(STOP_MS * 2);
    // The message was the later word: it runs, answered her, and has its body.
    expect(o.officeAgents.runtime.isRunning(agent.id)).toBe(true);
    expect(row().status).not.toBe("stopped");
    expect(row().stoppedByPerson).toBe(false);
    expect(o.officeAgents.conversations.waiting(agent.id, o.people.mia.id)).toBe(false);
    expect(o.officeAgents.conversations.recent(agent.id, o.people.mia.id).at(-1)).toMatchObject({
      author: "agent",
      text: "Quillon heard: one more thing",
    });
  });

  test("also when the message was already on its way before the stop: the agent as it was read then is not trusted", async () => {
    const rt = o.officeAgents.runtime;
    await rt.start(row());
    // The message's handler has read the agent (running, not stopped by anyone)...
    const asRead = row();
    expect(asRead.stoppedByPerson).toBe(false);
    // ...then its owner stops it, and the message is delivered while it stops.
    const stopping = o.send(`${A}/${agent.id}/stop`, "POST", o.people.mia.cookie);
    await Bun.sleep(STOP_MS / 4);
    await rt.deliver(asRead, { id: o.people.mia.id, displayName: "Mia" }, "already sent");
    expect((await stopping).status).toBe(200);
    await o.fake.idle();
    await Bun.sleep(STOP_MS * 2);
    expect(rt.isRunning(agent.id)).toBe(true);
    expect(row()).toMatchObject({ stoppedByPerson: false });
    expect(row().status).not.toBe("stopped");
  });
});
