/**
 * Second review of the watchdog (#253), over a real office server: who is told
 * of a finding and when, what a conversation that read the report has seen,
 * and the round's guards (one reading per part, no round left open, a Sentry
 * that has too much or does not answer).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  OFFICE_AGENTS_API_PATH,
  WATCHDOG_API_PATH,
  WATCHDOG_NEWS_API_PATH,
  type WatchdogNews,
  type WatchdogReport,
  type WatchdogReportPush,
} from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import { officeAgentRoomReads, watchdogSentryProjects } from "../../db/schema/index.ts";
import { APOLLO } from "../test-helpers.ts";
import {
  type CheckResult,
  issue,
  judging,
  type WatchdogOffice,
  watchdogOffice,
} from "./testing/kit.ts";

setDefaultTimeout(60_000);

let o: WatchdogOffice;
const online = new Set<string>();
const pushes: Array<{ userId: string; findings: number }> = [];
const notRead: string[][] = [];
const signals: string[][] = [];
const notify = judging(
  () => ({ disposition: "notify" }),
  (check: CheckResult) => {
    notRead.push(check.notRead);
    signals.push(check.signals.map((s) => JSON.stringify(s)));
  },
);

beforeAll(async () => {
  o = await watchdogOffice();
  await o.configure();
  // Like the office itself: only people who are connected can be pushed to.
  o.watchdog.setSink({
    sendToUser: (userId, type, payload) => {
      if (type === "watchdog.report") {
        pushes.push({ userId, findings: (payload as WatchdogReportPush).findings });
      }
    },
    connected: (userId) => online.has(userId),
  });
  o.setScript(notify);
}, 60_000);
afterAll(() => o.stopAll());

const news = async (cookie: string) =>
  (await (await o.send(WATCHDOG_NEWS_API_PATH, "POST", cookie)).json()) as WatchdogNews;
const logged = (...lines: string[]) =>
  o.setApps([{ name: "api", log: lines.map((l) => `Error: ${l}`) }, { name: "worker" }]);
const web = () => o.db.select().from(watchdogSentryProjects).get();

describe("who is told of a finding", () => {
  test("a person who is not connected is told when they next are, each person once", async () => {
    await logged("disk full on /var");
    expect((await o.round()).round?.state).toBe("done");
    // Nobody was there: nothing was pushed, and nothing is lost.
    expect(pushes).toEqual([]);
    expect(await news(o.people.mia.cookie)).toEqual({ findings: 1, agentName: "Cerberus" });
    expect((await news(o.people.mia.cookie)).findings).toBe(0);
    // Sam cannot see Apollo: there is nothing for him, then or later.
    expect((await news(o.people.sam.cookie)).findings).toBe(0);

    // Ada is connected when the next one is found: she is pushed it, with the one she missed.
    online.add(o.people.ada.id);
    await logged("disk full on /var", "redis connection lost");
    await o.round();
    expect(pushes).toEqual([{ userId: o.people.ada.id, findings: 2 }]);
    expect((await news(o.people.ada.cookie)).findings).toBe(0);
    expect((await news(o.people.mia.cookie)).findings).toBe(1);
  });

  test("findings the office announces as it starts, with nobody connected yet, are not lost", async () => {
    online.clear();
    pushes.length = 0;
    // A part had recorded these and the office restarted before telling anyone.
    o.db.$client.run("update watchdog_findings set announced_at = null");
    o.watchdog.rounds.boot();
    await Bun.sleep(20);
    expect(pushes).toEqual([]);
    expect((await news(o.people.mia.cookie)).findings).toBe(2);
    expect((await news(o.people.ada.cookie)).findings).toBe(2);
    expect((await news(o.people.mia.cookie)).findings).toBe(0);
  });
});

describe("a conversation that read the report", () => {
  const say = async (cookie: string, text: string) => {
    const res = await o.send(`${OFFICE_AGENTS_API_PATH}/${o.agent.id}/messages`, "POST", cookie, {
      text,
    });
    expect(res.status).toBeLessThan(300);
    await o.fake.idle();
  };
  const read = (userId: string) =>
    o.db
      .select()
      .from(officeAgentRoomReads)
      .where(
        and(eq(officeAgentRoomReads.agentId, o.agent.id), eq(officeAgentRoomReads.userId, userId)),
      )
      .all()
      .map((r) => r.operationId);

  test("has read the rooms of what it was shown, so it starts over when the person loses one", async () => {
    const { mia, olga } = o.people;
    let got: { findings: Array<{ operationId: string | null }> } = { findings: [] };
    o.setScript(async (turn) => {
      got = await turn.ok("watchdog_read_report");
      return "Here is your report.";
    });
    await say(mia.cookie, "how is production?");
    expect(got.findings.map((f) => f.operationId)).toEqual([APOLLO, APOLLO]);
    expect(read(mia.id)).toEqual([APOLLO]);
    // Olga sees no room: her conversation has read none.
    await say(olga.cookie, "how is production?");
    expect(read(olga.id)).toEqual([]);
    expect(o.fake.forgotten).toEqual([]);
    // Mia loses Apollo. Her next message: the session that holds Apollo's findings is dropped
    // before the agent gets it, and she is read nothing of Apollo.
    o.setRoomAccess(APOLLO, mia.id, null);
    await say(mia.cookie, "and now?");
    expect(o.fake.forgotten).toEqual([{ agentId: o.agent.id, userId: mia.id }]);
    expect(got.findings).toEqual([]);
    expect(read(mia.id)).toEqual([]);
    o.setRoomAccess(APOLLO, mia.id, "spawn");
    o.setScript(notify);
  });
});

describe("a round's guards", () => {
  const jlists = async (from: number) =>
    (await o.sshCalls()).slice(from).filter((c) => c.remote.join(" ") === "pm2 jlist").length;

  test("two checks at once in one turn are one reading, and both are handed the same", async () => {
    await logged("queue backed up");
    const before = (await o.sshCalls()).length;
    const pairs: string[][] = [];
    o.setScript(async (turn) => {
      const [a, b] = await Promise.all([
        turn.ok<CheckResult>("watchdog_check"),
        turn.ok<CheckResult>("watchdog_check"),
      ]);
      pairs.push([JSON.stringify(a.signals), JSON.stringify(b.signals)]);
      await turn.ok("watchdog_finish_round", { summary: "read twice" });
      return "done";
    });
    expect((await o.round()).round?.state).toBe("done");
    // Two parts (no room, Apollo): each read its host once, not twice.
    expect(await jlists(before)).toBe(2);
    expect(pairs.length).toBe(2);
    for (const [a, b] of pairs) expect(a).toBe(b);
    expect(pairs[1]?.[0]).toContain("queue backed up");
    expect(await o.keyFolderExists()).toBe(false);
    o.setScript(notify);
  });

  test("an open round in which nothing runs is taken up or closed by the next tick", async () => {
    // Every part ended, and the office lost the moment in which it closes the round.
    const ended = o.watchdog.parts.create("schedule", null, [
      { scope: "office", operationId: null },
    ]);
    o.db.$client.run(
      `update watchdog_round_parts set state = 'done' where round_id = '${ended.id}'`,
    );
    expect(o.watchdog.parts.openRound()?.id).toBe(ended.id);
    await o.watchdog.rounds.tick();
    expect(o.watchdog.parts.round(ended.id)?.state).toBe("done");
    // A part was never handed out: it is now.
    const waiting = o.watchdog.parts.create("schedule", null, [
      { scope: "office", operationId: null },
    ]);
    await o.watchdog.rounds.tick();
    await o.settled();
    expect(o.watchdog.parts.round(waiting.id)?.state).toBe("done");
    expect(o.watchdog.parts.parts(waiting.id).map((p) => p.state)).toEqual(["done"]);
  });
});

describe("reading Sentry in a part", () => {
  const windows = () =>
    o.sentry.asked
      .map((a) => /firstSeen:-(\d+)h/.exec(a.query)?.[1])
      .filter((h) => h !== undefined)
      .map(Number);

  test("more new issues than a round reads: it says so, and the window does not move past them", async () => {
    o.sentry.projects.web = [issue({ shortId: "WEB-1" })];
    o.sentry.more.add("web");
    notRead.length = 0;
    expect((await o.round()).round?.state).toBe("done");
    const line = "Sentry project web: more than 100 new issues; only the 100 most recent were read";
    expect(notRead.flat()).toEqual([line]);
    // In the part's result, and in what people who see that room read of the round.
    const report = (await (
      await o.send(WATCHDOG_API_PATH, "GET", o.people.ada.cookie)
    ).json()) as WatchdogReport;
    expect(report.rounds[0]?.summaries).toContain(`Not read: ${line}`);
    // The start of the window that was not read whole is kept, though the round finished.
    const since = web()?.unreadSince?.getTime() ?? 0;
    expect(since).toBeGreaterThan(Date.now() - 3 * 3_600_000);
    // Say that was two days ago, and rounds went on since: the next one still reads from there.
    o.db.$client.run(
      `update watchdog_sentry_projects set unread_since = ${Date.now() - 50 * 3_600_000}`,
    );
    await o.round();
    expect(windows().at(-1)).toBe(52);
    expect(web()?.unreadSince).not.toBeNull();
    // Sentry has no more than was read: the window moves on.
    o.sentry.more.clear();
    await o.round();
    expect(windows().at(-1)).toBe(52);
    expect(web()?.unreadSince).toBeNull();
    await o.round();
    expect(windows().at(-1)).toBe(2);
  });

  test("a Sentry that does not answer is given up on, and the part's hosts are read all the same", async () => {
    await logged("payments timed out");
    o.sentry.hang = new Promise(() => {});
    notRead.length = 0;
    signals.length = 0;
    const { round, parts } = await o.round();
    o.sentry.hang = null;
    expect(round?.state).toBe("done");
    expect(parts.map((p) => p.state)).toEqual(["done", "done"]);
    expect(notRead.flat()).toEqual(["Sentry project web: timed_out"]);
    expect(signals.flat().join("\n")).toContain("payments timed out");
  });
});
