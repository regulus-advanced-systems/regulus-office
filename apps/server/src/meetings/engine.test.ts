/**
 * The meeting orchestrator over fake henchmen (#50): turn order per pattern,
 * parallel steps, the output, adjourning, budgets, failed turns and resuming
 * after a restart.
 */
import { describe, expect, test } from "bun:test";
import {
  MEETING_PATTERNS,
  type MeetingPattern,
  planMeeting,
  StartMeetingRequest,
} from "@regulus/protocol";
import type { OperationActor } from "../operations/access.ts";
import { type Behaviour, diligent, meetingFixture, startInput, waitFor } from "./test-helpers.ts";

type Fixture = Awaited<ReturnType<typeof meetingFixture>>;

function start(f: Fixture, actor: OperationActor, extra: Record<string, unknown> = {}) {
  const input = StartMeetingRequest.parse(startInput(f.operationId, f.repoId, extra));
  return f.meetings.service.start(actor, input);
}

const finished = (f: Fixture, id: string) =>
  waitFor(() => {
    const row = f.meetings.store.get(id);
    return row?.finishedAt ? row : undefined;
  }, `meeting ${id} to finish`);

/** Member position of every prompt, in order. */
function promptedPositions(f: Fixture, id: string): number[] {
  const byAgent = new Map(f.meetings.store.members(id).map((m) => [m.agentId, m.position]));
  return f.fake.prompts.map((p) => byAgent.get(p.agentId) ?? -1);
}

describe("turn order", () => {
  test("debate: proposer and challenger in turns each round, then the judge closes", async () => {
    const f = await meetingFixture();
    const summary = start(f, f.owner);
    const row = await finished(f, summary.id);
    expect(promptedPositions(f, summary.id)).toEqual([0, 1, 0, 1, 2]);
    expect(row.status).toBe("done");
    const texts = f.fake.prompts.map((p) => p.text);
    expect(texts[0]).toContain("round 1 of 2");
    expect(texts[0]).toContain("You are Proposer");
    expect(texts[2]).toContain("round 2 of 2");
    expect(texts[4]).toContain("You are Judge");
    expect(texts[4]).toContain("Weigh the arguments");
    expect(texts[4]).toContain("commit the change");
    // Every turn's notes are read back into the transcript.
    const turns = f.meetings.store.turns(summary.id);
    expect(turns.map((t) => t.status)).toEqual(["done", "done", "done", "done", "done"]);
    expect(turns[4]?.text).toMatch(/^notes by agent-/);
  });

  for (const pattern of MEETING_PATTERNS) {
    test(`${pattern}: prompts follow the agenda, step by step`, async () => {
      const f = await meetingFixture();
      const extra: Record<string, unknown> = { pattern };
      if (pattern === "review_panel") Object.assign(extra, { output: "pr_review", prNumber: 7 });
      const summary = start(f, f.owner, extra);
      await finished(f, summary.id);
      const steps = planMeeting(pattern as MeetingPattern, 3, 2);
      const seen = promptedPositions(f, summary.id);
      let at = 0;
      for (const step of steps) {
        const chunk = seen.slice(at, at + step.turns.length).sort();
        expect(chunk).toEqual(step.turns.map((t) => t.position).sort());
        at += step.turns.length;
      }
      expect(at).toBe(seen.length);
    });
  }

  test("a review panel's turns of one step run at the same time", async () => {
    const f = await meetingFixture();
    const waiting: Array<() => void> = [];
    let concurrent = 0;
    f.fake.behave = (call, fake) => {
      fake.setStatus(call.agentId, "working");
      waiting.push(() => {
        fake.files.set(call.file, `review by ${call.agentId}`);
        fake.setStatus(call.agentId, "idle");
      });
      concurrent = Math.max(concurrent, waiting.length);
      if (waiting.length === 3) for (const release of waiting.splice(0)) setTimeout(release, 1);
      else if (
        call.text.includes("You are Chair") &&
        call.text.includes("Close the review panel")
      ) {
        for (const release of waiting.splice(0)) setTimeout(release, 1);
      }
    };
    f.fake.files.set("/w/meeting/.meeting/review.md", "LGTM with two nits");
    const summary = start(f, f.owner, {
      pattern: "review_panel",
      output: "pr_review",
      prNumber: 7,
    });
    const row = await finished(f, summary.id);
    expect(concurrent).toBe(3);
    expect(row.status).toBe("done");
    expect(f.outputs.reviews).toHaveLength(1);
    expect(f.outputs.reviews[0]?.prNumber).toBe(7);
    expect(f.outputs.reviews[0]?.body).toContain("LGTM with two nits");
    expect(f.workspaces.prepared[0]?.base).toBe("origin/feature");
  });
});

describe("output and adjourning", () => {
  test("a draft PR from the closer, as the starter; members go home; the worktree goes", async () => {
    const f = await meetingFixture();
    const summary = start(f, f.member);
    const row = await finished(f, summary.id);
    const judge = f.meetings.store.members(summary.id)[2]?.agentId;
    expect(f.outputs.pulls).toEqual([
      expect.objectContaining({ agentId: judge, starter: f.member.id }),
    ]);
    expect(f.outputs.pulls[0]?.title).toBe("Meeting: Pick a cache for the board sync");
    expect(row.outputUrl).toBe("https://github.test/octo/hello/pull/42");
    expect(row.reason).toContain("#42");
    await waitFor(() => f.workspaces.released.length === 1, "worktree release");
    expect(f.fake.sentHome.sort()).toEqual(["agent-1", "agent-2", "agent-3"]);
    expect(f.meetings.store.get(summary.id)?.workdir).toBeNull();
    // Every change went out to the room.
    expect(f.broadcasts.at(-1)?.status).toBe("done");
  });

  test("uncommitted work keeps the henchmen and the worktree; the sweep removes it once they left", async () => {
    const f = await meetingFixture();
    f.workspaces.dirty = ["src/cache.ts"];
    const summary = start(f, f.owner, { output: "notes" });
    const row = await finished(f, summary.id);
    await waitFor(() => f.meetings.store.get(summary.id)?.reason.includes("uncommitted"), "reason");
    expect(row.status).toBe("done");
    expect(f.fake.sentHome).toEqual([]);
    expect(await f.meetings.engine.sweep()).toBe(0);
    for (const m of f.meetings.store.members(summary.id)) {
      await f.fake.sendHome(f.owner, m.agentId ?? "");
    }
    expect(await f.meetings.engine.sweep()).toBe(1);
    expect(f.workspaces.released).toEqual(["/w/meeting"]);
  });

  test("nothing committed: done without a PR; a failing PR fails the meeting and keeps everyone", async () => {
    const f = await meetingFixture();
    f.outputs.failPull = new Error("office/meeting-x has no commits on top of origin/trunk");
    const quiet = await finished(f, start(f, f.owner).id);
    expect(quiet.status).toBe("done");
    expect(quiet.reason).toContain("nothing was committed");

    const g = await meetingFixture();
    g.outputs.failPull = new Error("GitHub: Validation Failed (422)");
    const failed = await finished(g, start(g, g.owner).id);
    expect(failed.status).toBe("failed");
    expect(failed.reason).toContain("Validation Failed");
    expect(g.fake.sentHome).toEqual([]);
  });
});

describe("budgets", () => {
  test("usage past the token budget stops the meeting mid-turn and interrupts the speaker", async () => {
    const f = await meetingFixture();
    const usage = f.meetings.usage;
    f.fake.behave = (call, fake) => {
      fake.setStatus(call.agentId, "working");
      setTimeout(() => {
        usage.agentEvent(call.agentId, {
          kind: "usage",
          ts: Date.now(),
          inputTokens: 60_000,
          outputTokens: 50_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          source: "inband",
        });
      }, 1);
    };
    const summary = start(f, f.owner, { tokenBudget: 100_000 });
    const row = await finished(f, summary.id);
    expect(row.status).toBe("stopped");
    expect(row.reason).toContain("token budget");
    expect(row.tokensUsed).toBe(110_000);
    expect(f.fake.prompts).toHaveLength(1);
    expect(f.fake.interrupts).toEqual([f.fake.prompts[0]?.agentId ?? ""]);
    const turns = f.meetings.store.turns(summary.id);
    expect(turns.map((t) => [t.status, t.tokens])).toEqual([["failed", 110_000]]);
  });

  test("no step starts once the budget is used up", async () => {
    const f = await meetingFixture();
    const usage = f.meetings.usage;
    f.fake.behave = (call, fake) => {
      diligent(call, fake);
      usage.agentEvent(call.agentId, {
        kind: "usage",
        ts: Date.now(),
        inputTokens: 5_000,
        outputTokens: 0,
        cacheReadTokens: 900_000,
        cacheWriteTokens: 0,
        source: "inband",
      });
    };
    const summary = start(f, f.owner, { tokenBudget: 10_000 });
    const row = await finished(f, summary.id);
    expect(row.status).toBe("stopped");
    // Cache reads do not count; the second turn crossed 10 000 and nothing started after it.
    expect(row.tokensUsed).toBe(10_000);
    expect(f.fake.prompts).toHaveLength(2);
  });

  test("the rounds bound the meeting: one round is one pass and the verdict", async () => {
    const f = await meetingFixture();
    await finished(f, start(f, f.owner, { rounds: 1 }).id);
    expect(f.fake.prompts).toHaveLength(3);
  });
});

describe("failures and resuming", () => {
  test("a henchman that errors pauses the meeting; resume asks the turn again", async () => {
    const f = await meetingFixture();
    let fail = true;
    f.fake.behave = (call, fake) => {
      if (fail && call.text.includes("You are Challenger")) {
        fail = false;
        setTimeout(() => fake.setStatus(call.agentId, "error"), 1);
        return;
      }
      diligent(call, fake);
    };
    const summary = start(f, f.owner);
    await waitFor(() => f.meetings.store.get(summary.id)?.status === "paused", "pause");
    const paused = f.meetings.store.get(summary.id);
    expect(paused?.reason).toContain("Challenger");
    expect(paused?.reason).toContain("resume");
    const agent = f.meetings.store.members(summary.id)[1]?.agentId ?? "";
    f.fake.setStatus(agent, "idle");
    f.meetings.service.resume(f.owner, summary.id);
    const row = await finished(f, summary.id);
    expect(row.status).toBe("done");
    expect(promptedPositions(f, summary.id)).toEqual([0, 1, 1, 0, 1, 2]);
  });

  test("after a restart: a turn finished meanwhile is read back, a lost one is asked again", async () => {
    const f = await meetingFixture();
    let held: { agentId: string; file: string } | undefined;
    f.fake.behave = (call, fake) => {
      if (call.text.includes("round 2 of 2") && call.text.includes("You are Proposer")) {
        fake.setStatus(call.agentId, "working");
        held = call;
        return;
      }
      diligent(call, fake);
    };
    const summary = start(f, f.owner);
    await waitFor(() => held, "the held turn");
    // The office stops; the henchman finishes its turn while nobody watches.
    f.meetings.close();
    f.fake.feed = () => {};
    const proposer = held as { agentId: string; file: string };
    f.fake.files.set(proposer.file, "rebuttal written while the office was down");
    f.fake.setStatus(proposer.agentId, "idle");
    expect(f.meetings.store.get(summary.id)?.status).toBe("running");

    const again = f.make();
    f.attach(again);
    f.fake.behave = diligent;
    const before = f.fake.prompts.length;
    again.boot();
    const row = await waitFor(() => {
      const r = again.store.get(summary.id);
      return r?.finishedAt ? r : undefined;
    }, "the meeting to finish after the restart");
    expect(row.status).toBe("done");
    // Not asked again: the challenger's rebuttal and the verdict are the only new prompts.
    expect(f.fake.prompts.slice(before).map((p) => p.text.match(/You are (\w+)/)?.[1])).toEqual([
      "Challenger",
      "Judge",
    ]);
    const turn = again.store.turns(summary.id).find((t) => t.step === 2);
    expect(turn?.text).toBe("rebuttal written while the office was down");
    again.close();
  });

  test("a turn lost in a restart (no notes, henchman resting) is asked again", async () => {
    const f = await meetingFixture();
    let held = false;
    f.fake.behave = (call, fake) => {
      if (!held && call.text.includes("You are Challenger")) {
        held = true;
        fake.setStatus(call.agentId, "working");
        return;
      }
      diligent(call, fake);
    };
    const summary = start(f, f.owner);
    await waitFor(() => held, "the held turn");
    f.meetings.close();
    const challenger = f.meetings.store.members(summary.id)[1]?.agentId ?? "";
    f.fake.feed = () => {};
    f.fake.setStatus(challenger, "idle");
    const again = f.make();
    f.attach(again);
    again.boot();
    const row = await waitFor(() => {
      const r = again.store.get(summary.id);
      return r?.finishedAt ? r : undefined;
    }, "finish");
    expect(row.status).toBe("done");
    expect(promptedPositions(f, summary.id)).toEqual([0, 1, 1, 0, 1, 2]);
    again.close();
  });

  test("a meeting that was starting when the office stopped convenes the missing members", async () => {
    const f = await meetingFixture();
    const input = StartMeetingRequest.parse(startInput(f.operationId, f.repoId));
    f.meetings.close();
    // Created but never launched (the office stopped right after the start was stored).
    const summary = f.meetings.service.start(f.owner, input);
    expect(summary.status).toBe("starting");
    const again = f.make();
    f.attach(again);
    again.boot();
    const row = await waitFor(() => {
      const r = again.store.get(summary.id);
      return r?.finishedAt ? r : undefined;
    }, "finish");
    expect(row.status).toBe("done");
    expect(f.fake.agents.size).toBe(3);
    again.close();
  });
});
