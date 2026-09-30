/**
 * The periodic transcript scan in each human's runner (#40), over the test
 * runner with fake transcripts in per-human temp HOMEs and the real Claude
 * Code adapter. Never touches a real ~/.claude.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ClaudeCodeAdapter, type SpawnPlan } from "@regulus/agent-adapters";
import { eq } from "drizzle-orm";
import { agents, usageSamples } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { LocalTmuxRunner } from "../runners/testing/local-tmux-runner.ts";
import type { RunnerUser } from "../runners/types.ts";
import { TranscriptScanLoop } from "./scanner.ts";
import { usage, usageDb } from "./testing.ts";
import { UsageTracker } from "./tracker.ts";

const NOW = Date.parse("2026-09-30T12:00:00Z");

function line(session: string, id: string, at: string, input: number, model = "claude-opus-5-5") {
  return `${JSON.stringify({
    type: "assistant",
    sessionId: session,
    requestId: `req-${id}`,
    timestamp: at,
    message: {
      id,
      model,
      usage: { input_tokens: input, output_tokens: 10, cache_read_input_tokens: 1000 },
    },
  })}\n`;
}

let runner: LocalTmuxRunner;
const scans: { user: string; plan: SpawnPlan }[] = [];

beforeEach(async () => {
  runner = await LocalTmuxRunner.create();
  const spawn = runner.spawnPiped.bind(runner);
  scans.length = 0;
  runner.spawnPiped = (user: RunnerUser, plan: SpawnPlan) => {
    scans.push({ user: user.userId, plan });
    return spawn(user, plan);
  };
});
afterEach(async () => {
  await runner.dispose();
});

async function transcript(userId: string, name: string, text: string) {
  const { home } = await runner.provision({ userId });
  const dir = join(home, ".claude", "projects", "-srv-office-worktrees-web");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), text);
  return home;
}

function setup() {
  const f = usageDb();
  const tracker = new UsageTracker(f.db);
  const loop = new TranscriptScanLoop({
    db: f.db,
    runner,
    adapter: new ClaudeCodeAdapter(),
    tracker,
    officeUrl: "http://office.test",
    logger: createLogger({ level: "silent" }),
    now: () => NOW,
  });
  const rows = () => f.db.select().from(usageSamples).all();
  return { ...f, tracker, loop, rows };
}

describe("TranscriptScanLoop", () => {
  test("scans each human with a live Claude robot in their own runner, attributing by session", async () => {
    const { loop, rows, addAgent, ada, bob, cy, db } = setup();
    addAgent("ada-robot", ada.id, { session: "s-ada" });
    addAgent("bob-robot", bob.id, { session: "s-bob", profileId: "office:claude-code" });
    addAgent("cy-codex", cy.id, { provider: "codex" });
    addAgent("cy-old", cy.id, { status: "exited" });
    db.update(agents)
      .set({ lastActivityAt: new Date(NOW - 2 * 3_600_000) })
      .where(eq(agents.id, "cy-old"))
      .run();
    await transcript(
      ada.id,
      "s-ada.jsonl",
      line("s-ada", "m1", "2026-09-30T11:00:00Z", 100) +
        line("s-ada", "m1", "2026-09-30T11:00:00Z", 100),
    );
    await transcript(
      ada.id,
      "own-terminal.jsonl",
      line("own-terminal", "m2", "2026-09-30T11:30:00Z", 5),
    );
    await transcript(bob.id, "s-bob.jsonl", line("s-bob", "m3", "2026-09-30T11:10:00Z", 50));
    await transcript(cy.id, "s-cy.jsonl", line("s-cy", "m4", "2026-09-30T11:10:00Z", 50));

    expect(loop.targets()).toEqual([ada.id, bob.id].sort());
    await loop.scanOnce();

    // Each scan ran as that human's runner, with that human's HOME only.
    expect(scans.map((s) => s.user).sort()).toEqual([ada.id, bob.id].sort());
    for (const s of scans) {
      const { home } = await runner.provision({ userId: s.user });
      expect(s.plan.env.reveal().HOME).toBe(home);
      expect(s.plan.argv[4]).toBe(`${home}/.claude/projects`);
    }
    const byAgent = rows().map((r) => [r.agentId, r.userId, r.inputTokens, r.model]);
    expect(byAgent).toContainEqual(["ada-robot", ada.id, 100, "claude-opus-5-5"]);
    expect(byAgent).toContainEqual([null, ada.id, 5, "claude-opus-5-5"]);
    expect(byAgent).toContainEqual(["bob-robot", null, 50, "claude-opus-5-5"]);
    expect(rows()).toHaveLength(3);
    // Opus 5.5: 100 in @ $4, 10 out @ $20, 1000 cache reads @ $0.20 per million.
    const ada1 = rows().find((r) => r.agentId === "ada-robot");
    expect(ada1?.costUsdEstimate).toBeCloseTo((100 * 4 + 10 * 20 + 1000 * 0.2) / 1e6, 9);

    // Scanning again adds nothing: offsets moved on, and the office dedupes anyway.
    await loop.scanOnce();
    expect(rows()).toHaveLength(3);
  });

  test("after a restart (new adapter, no offsets) re-read lines are deduped", async () => {
    const first = setup();
    first.addAgent("a", first.ada.id, { session: "s1" });
    await transcript(first.ada.id, "s1.jsonl", line("s1", "m1", "2026-09-30T11:00:00Z", 7));
    await first.loop.scanOnce();
    const again = new TranscriptScanLoop({
      db: first.db,
      runner,
      adapter: new ClaudeCodeAdapter(),
      tracker: first.tracker,
      officeUrl: "http://office.test",
      logger: createLogger({ level: "silent" }),
      now: () => NOW,
    });
    await again.scanOnce();
    expect(first.rows()).toHaveLength(1);
  });

  test("the transcript replaces the session's provisional statusline samples", async () => {
    const { loop, tracker, rows, addAgent, ada } = setup();
    addAgent("a", ada.id, { session: "s1" });
    tracker.agentEvent("a", {
      kind: "usage",
      ...usage(
        NOW - 60_000,
        { input: 3 },
        { source: "statusline", sessionId: "s1", costUsdEstimate: 0.01 },
      ),
    });
    tracker.agentEvent("a", {
      kind: "usage",
      ...usage(
        NOW - 60_000,
        { input: 3 },
        { source: "statusline", sessionId: "s-other", costUsdEstimate: 0.01 },
      ),
    });
    await transcript(ada.id, "s1.jsonl", line("s1", "m1", "2026-09-30T11:59:00Z", 3));
    const result = await loop.scanUser(ada.id);
    expect(result).toEqual({ stored: 1, superseded: 1 });
    expect(
      rows()
        .map((r) => `${r.source}:${r.sessionId}`)
        .sort(),
    ).toEqual(["statusline:s-other", "transcript:s1"]);
  });

  test("a human without transcripts is a quiet no-op", async () => {
    const { loop, rows, addAgent, ada } = setup();
    addAgent("a", ada.id);
    expect(await loop.scanUser(ada.id)).toEqual({ stored: 0, superseded: 0 });
    expect(rows()).toEqual([]);
  });
});
