/** The workflow engine (#155): loop protection, dedupe, budgets, cooldown, concurrency, schedules. */
import { describe, expect, test } from "bun:test";
import { WorkflowInput as Schema, type WorkflowInput } from "@regulus/protocol";
import { operations } from "../db/schema/index.ts";
import type { RepoCheckout } from "../github/repo-access.ts";
import { createLogger } from "../logging.ts";
import { testDb } from "../operations/test-helpers.ts";
import { OFFICE_MARKER, type WorkflowContext } from "./context.ts";
import { cronMatches, dueSlot, parseCron } from "./cron.ts";
import { WorkflowEngine } from "./engine.ts";
import { EventLog } from "./event-log.ts";
import { RunStore } from "./runs.ts";
import { type StoredWorkflow, WorkflowStore } from "./store.ts";

const spec = (over: Partial<WorkflowInput> = {}) =>
  Schema.parse({
    name: "w",
    enabled: true,
    trigger: { kind: "pull_request", actions: ["opened", "synchronize"] },
    henchman: { provider: "claude-code", promptTemplate: "x" },
    limits: { cooldownMinutes: 0 },
    ...over,
  });

let seq = 0;
function ctx(over: Partial<WorkflowContext> = {}, number = 1): WorkflowContext {
  seq += 1;
  return {
    deliveryId: `d${seq}`,
    event: "pull_request.opened",
    name: "pull_request",
    action: "opened",
    source: "webhook",
    receivedAt: 0,
    repo: { owner: "octo", name: "hello", fullName: "octo/hello" },
    repoIds: ["r1"],
    operationIds: ["f1"],
    sender: { login: "alice", isBot: false },
    fromOfficeApp: false,
    stale: false,
    pr: {
      number,
      title: "T",
      body: "",
      author: "alice",
      authorIsBot: false,
      draft: false,
      state: "open",
      baseRef: "main",
      headRef: "x",
      headSha: "abc",
      headRepo: "octo/hello",
      fork: false,
      labels: [],
      url: "",
    },
    ...over,
  };
}

function setup(opts: { maxParallel?: number } = {}) {
  const { db } = testDb();
  db.insert(operations)
    .values({ id: "f1", name: "F", slug: "f", index: 1, paletteId: "p", layoutTemplateId: "t" })
    .run();
  const clock = { now: Date.parse("2026-09-30T10:00:00Z") };
  const store = new WorkflowStore(db);
  const runs = new RunStore(db);
  const started: string[] = [];
  const release = new Map<string, () => void>();
  const repo = { repoId: "r1", owner: "octo", name: "hello", isPrimary: true } as RepoCheckout;
  const engine = new WorkflowEngine({
    store,
    runs,
    events: new EventLog(db),
    repos: { listOperationRepos: () => [repo] },
    logger: createLogger({ level: "silent" }),
    now: () => clock.now,
    maxParallel: opts.maxParallel,
    execute: (row, _wf: StoredWorkflow) =>
      new Promise<void>((resolve) => {
        started.push(row.id);
        release.set(row.id, () => {
          runs.finish(row.id, {
            status: "succeeded",
            reason: null,
            now: clock.now,
            log: [],
            usage: {
              inputTokens: 600,
              outputTokens: 400,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd: 0,
            },
          });
          resolve();
        });
      }),
  });
  const finishAll = async () => {
    while (release.size > 0) {
      for (const [id, done] of [...release]) {
        release.delete(id);
        done();
      }
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    await engine.idle();
  };
  return { db, clock, store, runs, engine, started, release, finishAll };
}

describe("loop protection and dedupe", () => {
  test("the App's own events, office comments and stale replays never queue", () => {
    const s = setup();
    s.store.create("f1", spec(), null);
    expect(s.engine.consider(ctx({ fromOfficeApp: true }))).toEqual([]);
    expect(s.engine.consider(ctx({ stale: true }))).toEqual([]);
    const marked = ctx({
      comment: { author: "x", authorIsBot: false, body: OFFICE_MARKER, url: "", fromOffice: true },
    });
    expect(s.engine.consider(marked)).toEqual([]);
    expect(s.runs.list({ operationId: "f1" })).toEqual([]);
  });

  test("one run per workflow and delivery id", () => {
    const s = setup();
    s.store.create("f1", spec(), null);
    const c = ctx();
    expect(s.engine.consider(c)).toHaveLength(1);
    expect(s.engine.consider({ ...c })).toEqual([]);
    expect(s.runs.list({ operationId: "f1" })).toHaveLength(1);
  });

  test("disabled workflows and other operations are not considered", () => {
    const s = setup();
    s.store.create("f1", spec({ enabled: false }), null);
    expect(s.engine.consider(ctx())).toEqual([]);
    s.store.create("f1", spec(), null);
    expect(s.engine.consider(ctx({ operationIds: ["f2"] }))).toEqual([]);
  });
});

describe("limits", () => {
  test("per-target cooldown skips, but not for commands", async () => {
    const s = setup();
    s.store.create("f1", spec({ limits: { cooldownMinutes: 10 } } as never), null);
    expect(s.engine.consider(ctx())).toHaveLength(1);
    await s.finishAll();
    expect(s.engine.consider(ctx())).toEqual([]);
    const [skipped] = s.runs.list({ operationId: "f1" });
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.reason).toStartWith("cooldown");
    expect(s.engine.consider(ctx({}, 2))).toHaveLength(1);
    s.clock.now += 11 * 60_000;
    expect(s.engine.consider(ctx())).toHaveLength(1);
  });

  test("daily run limit and token budget", async () => {
    const s = setup();
    s.store.create("f1", spec({ limits: { dailyMaxRuns: 2, cooldownMinutes: 0 } } as never), null);
    expect(s.engine.consider(ctx({}, 1))).toHaveLength(1);
    expect(s.engine.consider(ctx({}, 2))).toHaveLength(1);
    expect(s.engine.consider(ctx({}, 3))).toEqual([]);
    expect(s.runs.list({ operationId: "f1" })[0]?.reason).toStartWith("daily_run_limit");
    await s.finishAll();
    // A new UTC day starts from zero.
    s.clock.now += 24 * 60 * 60_000;
    expect(s.engine.consider(ctx({}, 4))).toHaveLength(1);

    const t = setup();
    t.store.create(
      "f1",
      spec({ limits: { dailyTokenBudget: 10_000, cooldownMinutes: 0 } } as never),
      null,
    );
    for (let i = 1; i <= 10; i += 1) {
      t.engine.consider(ctx({}, i));
      await t.finishAll();
    }
    // 1000 tokens per run: the 11th finds the budget used up.
    expect(t.engine.consider(ctx({}, 11))).toEqual([]);
    expect(t.runs.list({ operationId: "f1" })[0]?.reason).toStartWith("daily_token_budget");
  });

  test("concurrency per workflow and in the office", async () => {
    const s = setup({ maxParallel: 3 });
    const one = s.store.create("f1", spec(), null);
    const two = s.store.create(
      "f1",
      spec({ limits: { concurrency: 2, cooldownMinutes: 0 } } as never),
      null,
    );
    for (let i = 1; i <= 4; i += 1) s.engine.consider(ctx({}, i));
    // `one` runs 1 at a time, `two` 2: three henchmen, the rest wait.
    expect(s.started).toHaveLength(3);
    const byWf = (id: string) => s.runs.list({ operationId: "f1", workflowId: id });
    expect(byWf(one.id).filter((r) => r.status === "running")).toHaveLength(1);
    expect(byWf(two.id).filter((r) => r.status === "running")).toHaveLength(2);
    await s.finishAll();
    expect(s.started).toHaveLength(8);
    expect(s.runs.list({ operationId: "f1" }).every((r) => r.status === "succeeded")).toBe(true);
  });

  test("cancel and disable", async () => {
    const s = setup();
    const wf = s.store.create("f1", spec(), null);
    const [a] = s.engine.consider(ctx({}, 1));
    const [b] = s.engine.consider(ctx({}, 2));
    expect(s.started).toEqual([a as string]);
    expect(s.engine.cancel(b as string)).toBe(true);
    expect(s.runs.get(b as string)?.status).toBe("cancelled");
    const [c] = s.engine.consider(ctx({}, 3));
    s.store.update(wf.id, { ...wf.spec, enabled: false });
    await s.finishAll();
    expect(s.runs.get(c as string)?.status).toBe("cancelled");
    expect(s.runs.get(c as string)?.reason).toStartWith("workflow_disabled");
  });

  test("runs left running by a stopped office fail at boot", () => {
    const s = setup();
    s.store.create("f1", spec(), null);
    const [id] = s.engine.consider(ctx());
    const fresh = new WorkflowEngine({
      store: s.store,
      runs: s.runs,
      events: new EventLog(s.db),
      repos: { listOperationRepos: () => [] },
      logger: createLogger({ level: "silent" }),
      execute: async () => {},
    });
    fresh.start();
    void fresh.stop();
    expect(s.runs.get(id as string)?.status).toBe("failed");
  });
});

describe("schedules", () => {
  test("cron parsing and matching (UTC)", () => {
    const c = parseCron("*/15 9-17 * * 1-5");
    expect(cronMatches(c, new Date("2026-09-30T09:15:00Z"))).toBe(true);
    expect(cronMatches(c, new Date("2026-09-30T09:16:00Z"))).toBe(false);
    expect(cronMatches(c, new Date("2026-10-04T09:15:00Z"))).toBe(false);
    expect(cronMatches(parseCron("0 0 1 * 0"), new Date("2026-10-04T00:00:00Z"))).toBe(true);
    expect(() => parseCron("61 * * * *")).toThrow();
    expect(() => parseCron("* * *")).toThrow();
    const now = Date.parse("2026-09-30T10:07:30Z");
    expect(dueSlot(parseCron("5 * * * *"), now - 10 * 60_000, now)).toBe(
      Date.parse("2026-09-30T10:05:00Z"),
    );
    expect(dueSlot(parseCron("5 * * * *"), Date.parse("2026-09-30T10:05:00Z"), now)).toBeNull();
  });

  test("a schedule fires once per slot on the operation's primary repo", async () => {
    const s = setup();
    s.store.create("f1", spec({ trigger: { kind: "schedule", cron: "*/5 * * * *" } }), null);
    s.engine.tick();
    expect(s.runs.list({ operationId: "f1" })).toEqual([]);
    s.clock.now += 5 * 60_000;
    s.engine.tick();
    s.engine.tick();
    const runs = s.runs.list({ operationId: "f1" });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.trigger).toBe("schedule");
    expect(runs[0]?.deliveryId).toStartWith("schedule:2026-09-30T10:05:00.000Z:r1");
    await s.finishAll();
  });
});
