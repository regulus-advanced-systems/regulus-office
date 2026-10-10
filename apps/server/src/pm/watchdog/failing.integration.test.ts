/**
 * Rounds that do not finish (#253): the model stops early, the turn times out,
 * the engine fails, the office restarts. Each is marked failed with why,
 * keeps nothing as read, and is tried again on the next tick; and a finding
 * that was recorded before the failure is still told to the people who may
 * see it.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  OFFICE_AGENTS_API_PATH,
  WATCHDOG_API_PATH,
  WATCHDOG_ROUNDS_API_PATH,
  WATCHDOG_SETTINGS_API_PATH,
  type WatchdogReport,
} from "@regulus/protocol";
import { watchdogApps, watchdogFindings } from "../../db/schema/index.ts";
import { APOLLO } from "../test-helpers.ts";
import { lairState, person } from "../world/test-lair.ts";
import {
  type CheckResult,
  judging,
  type Turn,
  type WatchdogOffice,
  watchdogOffice,
} from "./testing/kit.ts";

setDefaultTimeout(60_000);

let o: WatchdogOffice;

beforeAll(async () => {
  o = await watchdogOffice();
  await o.configure();
  await o.setApps([{ name: "api", log: ["Error: disk full on /var"] }, { name: "worker" }]);
}, 60_000);
afterAll(() => o.stopAll());

const report = async (cookie: string) =>
  (await (await o.send(WATCHDOG_API_PATH, "GET", cookie)).json()) as WatchdogReport;
const told = (userId: string) =>
  o.pushes.filter((p) => p.userId === userId).reduce((n, p) => n + p.payload.findings, 0);
const titles = () =>
  o.db
    .select()
    .from(watchdogFindings)
    .all()
    .map((f) => f.title)
    .sort();
const apiMark = () =>
  o.db
    .select()
    .from(watchdogApps)
    .all()
    .find((a) => a.name === "api")?.lastLogMark ?? null;

/** In Apollo's turn: record the first new signal as a finding a person should see, then `after`. */
function recordingThen(title: string, after: (turn: Turn) => Promise<string | null>) {
  return async (turn: Turn) => {
    const check = await turn.ok<CheckResult>("watchdog_check");
    const fresh = check.signals.find((s) => !s.known);
    if (!fresh) {
      await turn.ok("watchdog_finish_round", { summary: "quiet" });
      return "done";
    }
    await turn.ok("watchdog_record_finding", {
      title,
      sources: [{ key: fresh.key }],
      disposition: "notify",
      reason: "A person should look.",
    });
    return after(turn);
  };
}

describe("a part of a round that does not finish", () => {
  test("is failed with why and reads nothing as read; what it had found is told all the same", async () => {
    o.setScript(
      recordingThen("The disk is full", async () => "I looked around and forgot to finish."),
    );
    const { round, parts } = await o.round();
    expect(round).toMatchObject({ state: "failed", error: "1 of its 2 parts did not finish" });
    expect(parts.map((p) => [p.scope, p.state, p.error])).toEqual([
      ["office", "done", null],
      ["room", "failed", "the watchdog ended its turn without finishing"],
    ]);
    // The finding stands, and Mia (who sees Apollo) was told of it though the part failed.
    expect(titles()).toEqual(["The disk is full"]);
    expect([told(o.people.mia.id), told(o.people.ada.id), told(o.people.sam.id)]).toEqual([
      1, 1, 0,
    ]);
    // Nothing of what the failed part read counts as read.
    expect(apiMark()).toBeNull();
    // What everyone is shown of the failure names no target.
    const forSam = (await report(o.people.sam.cookie)).rounds[0];
    expect(forSam).toMatchObject({ state: "failed", error: "1 of its 2 parts did not finish" });
  });

  test("is tried again on the next tick, once; after a second failure the schedule waits its turn", async () => {
    // The round a moment ago failed: the next one is due now, not in an hour.
    expect((await report(o.people.ada.cookie)).nextRoundAt).toBeLessThanOrEqual(Date.now());
    const lines: number[] = [];
    o.setScript(async (turn) => {
      const check = await turn.ok<CheckResult>("watchdog_check");
      // The line the failed part had read is read again (and is the known finding now).
      lines.push(...check.signals.filter((s) => s.from === "PM2").map((s) => s.lines.length));
      throw new Error("the model is overloaded");
    });
    const before = o.watchdog.parts.rounds(10).length;
    await o.watchdog.rounds.tick();
    await o.settled();
    expect(o.watchdog.parts.rounds(10).length).toBe(before + 1);
    expect(lines).toEqual([1]);
    const [again] = o.watchdog.parts.rounds(1);
    expect(again).toMatchObject({
      trigger: "schedule",
      state: "failed",
      error: "2 of its 2 parts did not finish",
    });
    expect(o.watchdog.parts.parts(again?.id ?? "").map((p) => p.error)).toEqual([
      "the watchdog could not do it: the model is overloaded",
      "the watchdog could not do it: the model is overloaded",
    ]);
    // Two failures in a row: no third try on the next tick.
    await o.watchdog.rounds.tick();
    await o.settled();
    expect(o.watchdog.parts.rounds(10).length).toBe(before + 1);
    expect((await report(o.people.ada.cookie)).nextRoundAt).toBeGreaterThan(
      Date.now() + 50 * 60_000,
    );
  });

  test("a turn that runs out of time: the finding it recorded is told, and its token stops working", async () => {
    await o.setApps([{ name: "api", log: ["Error: redis connection lost"] }, { name: "worker" }]);
    let reached = () => {};
    const atGate = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let late: unknown;
    o.setScript(
      recordingThen("Redis is gone", async (turn) => {
        reached();
        await gate;
        // The turn is still going after the office gave up on it.
        late = await turn.call("watchdog_finish_round", { summary: "late" });
        return "done";
      }),
    );
    const row = await o.watchdog.rounds.request("schedule", null);
    await atGate;
    // The finding is recorded and its turn is still going: nobody was told yet.
    const pushed = told(o.people.mia.id);
    // Twelve minutes pass.
    o.db.$client.run(
      `update watchdog_round_parts set started_at = ${Date.now() - 13 * 60_000} where state = 'running'`,
    );
    await o.watchdog.rounds.tick();
    expect(o.watchdog.parts.round(row.id)?.state).toBe("failed");
    expect(o.watchdog.parts.parts(row.id).map((p) => [p.operationId, p.state, p.error])).toEqual([
      [null, "done", null],
      [APOLLO, "failed", "it did not finish in time"],
    ]);
    // Told although the turn never finished.
    expect(titles()).toContain("Redis is gone");
    expect(told(o.people.mia.id)).toBe(pushed + 1);
    release();
    await o.fake.idle();
    // The turn's own token was revoked when the office gave up: the late call is nobody's.
    expect(late).toEqual({ error: "unauthorized" });
    expect(apiMark()).toBeNull();
  });

  test("an office restart in the middle of a round ends it as failed, and tells what was found", async () => {
    await o.setApps([{ name: "api", log: ["Error: queue backed up"] }, { name: "worker" }]);
    const pushed = told(o.people.mia.id);
    let late: unknown;
    o.setScript(
      recordingThen("The queue is backed up", async (turn) => {
        // What the office does when it starts: every engine and turn token is revoked, open
        // conversations are closed, and the round that was under way is failed (pm/setup.ts).
        o.officeAgents.boot();
        late = await turn.call("watchdog_finish_round", { summary: "late" });
        return "done";
      }),
    );
    const { round } = await o.round();
    expect(round).toMatchObject({
      state: "failed",
      error: "the office restarted during the round",
    });
    // The turn that was open at the restart holds a token the office no longer knows.
    expect(late).toEqual({ error: "unauthorized" });
    expect(told(o.people.mia.id)).toBe(pushed + 1);
  });

  test("a round that finishes keeps what it read: the same lines are not handed out again", async () => {
    const seen: number[] = [];
    const script = judging(
      () => null,
      (check) => void seen.push(check.signals.filter((s) => s.from === "PM2").length),
    );
    o.setScript(script);
    expect((await o.round()).round?.state).toBe("done");
    expect(apiMark()).not.toBeNull();
    await o.round();
    // [office, Apollo] twice: the known line the first time, nothing the second.
    expect(seen).toEqual([0, 1, 0, 0]);
  });
});

describe("the schedule", () => {
  test("starts a round when one is due, and not while it is switched off or one was just done", async () => {
    const rounds = () => o.watchdog.parts.rounds(100).length;
    o.setScript(judging(() => null));
    await o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", o.people.ada.cookie, { enabled: true });
    const before = rounds();
    // One was started a moment ago: the next is an hour away.
    await o.watchdog.rounds.tick();
    await o.settled();
    expect(rounds()).toBe(before);
    expect((await report(o.people.ada.cookie)).nextRoundAt).toBeGreaterThan(
      Date.now() + 59 * 60_000,
    );
    // An hour later.
    o.db.$client.run(`update watchdog_settings set last_round_at = ${Date.now() - 61 * 60_000}`);
    await o.watchdog.rounds.tick();
    await o.settled();
    expect(rounds()).toBe(before + 1);
    expect(o.watchdog.parts.rounds(1)[0]).toMatchObject({ trigger: "schedule", state: "done" });
    // Switched off: due or not, nothing starts.
    await o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", o.people.ada.cookie, { enabled: false });
    o.db.$client.run(`update watchdog_settings set last_round_at = ${Date.now() - 61 * 60_000}`);
    await o.watchdog.rounds.tick();
    await o.settled();
    expect(rounds()).toBe(before + 1);
    expect((await report(o.people.ada.cookie)).nextRoundAt).toBeUndefined();
  });

  test("a watchdog a person stopped has no body and does no rounds by the clock; asking for one starts it", async () => {
    const ada = o.people.ada.cookie;
    const agentPath = `${OFFICE_AGENTS_API_PATH}/${o.agent.id}`;
    const state = lairState();
    person(state, o.people.ada.id, { x: 60, z: 120 });
    let clock = 1_000_000;
    const bodies = () => {
      for (let i = 0; i < 40; i++) o.officeAgents.world.tick(state, (clock += 100));
      return [...state.officeAgents.keys()];
    };
    await o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", ada, { enabled: true });
    expect(bodies()).toContain(o.agent.id);
    // Ada stops it (#301): it leaves the world, and the schedule leaves it alone.
    expect((await o.send(`${agentPath}/stop`, "POST", ada)).status).toBe(200);
    expect(o.officeAgents.store.get(o.agent.id)?.stoppedByPerson).toBe(true);
    expect(bodies()).not.toContain(o.agent.id);
    const rounds = () => o.watchdog.parts.rounds(100).length;
    const before = rounds();
    o.db.$client.run(`update watchdog_settings set last_round_at = ${Date.now() - 61 * 60_000}`);
    await o.watchdog.rounds.tick();
    await o.settled();
    expect(rounds()).toBe(before);
    expect(o.officeAgents.store.get(o.agent.id)?.status).toBe("stopped");
    const told = await report(ada);
    expect(told.agent?.stoppedByPerson).toBe(true);
    expect(told.nextRoundAt).toBeUndefined();
    // A person asking for a round is a person starting it: it runs, and it is back.
    o.setScript(judging(() => null));
    expect((await o.send(WATCHDOG_ROUNDS_API_PATH, "POST", ada)).status).toBe(202);
    await o.settled();
    expect(o.watchdog.parts.rounds(1)[0]).toMatchObject({ trigger: "manual", state: "done" });
    expect(o.officeAgents.store.get(o.agent.id)?.stoppedByPerson).toBe(false);
    expect(bodies()).toContain(o.agent.id);
    expect((await report(ada)).nextRoundAt).toBeGreaterThan(Date.now());
  });

  test("stopped by a person in the middle of a round: the office does not start it again for the parts left", async () => {
    const ada = o.people.ada.cookie;
    let turns = 0;
    let late: unknown;
    o.setScript(async (turn) => {
      turns++;
      await turn.ok<CheckResult>("watchdog_check");
      // Ada stops it while its first part's turn is going.
      const stopped = await o.send(`${OFFICE_AGENTS_API_PATH}/${o.agent.id}/stop`, "POST", ada);
      expect(stopped.status).toBe(200);
      late = await turn.call("watchdog_finish_round", { summary: "late" });
      return "done";
    });
    const { round, parts } = await o.round();
    expect(late).toEqual({ error: "unauthorized" });
    expect(round).toMatchObject({ state: "failed", error: "the watchdog was stopped by a person" });
    expect(parts.map((p) => p.state)).toEqual(["failed", "failed"]);
    // One turn only: the second part was never handed out, and it is still stopped.
    expect(turns).toBe(1);
    expect(o.officeAgents.store.get(o.agent.id)).toMatchObject({
      stoppedByPerson: true,
      status: "stopped",
    });
  });
});
