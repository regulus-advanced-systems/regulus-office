/** The AgentManager hands robots' usage and limit events to the tracker (#40). */
import { describe, expect, test } from "bun:test";
import { AgentManager } from "../agents/manager/manager.ts";
import { makeManager } from "../agents/manager/test-helpers.ts";
import { usageLimits, usageSamples } from "../db/schema/index.ts";
import { LocalTmuxRunner } from "../runners/testing/local-tmux-runner.ts";
import { usage, usageDb } from "./testing.ts";
import { UsageTracker } from "./tracker.ts";

describe("AgentManager → UsageTracker", () => {
  test("usage and limit events are stored; other events are not", async () => {
    const f = usageDb();
    f.addAgent("a1", f.ada.id, { provider: "codex" });
    const runner = await LocalTmuxRunner.create();
    try {
      const tracker = new UsageTracker(f.db);
      const { manager } = makeManager(f.db, runner, [], { usage: tracker });
      expect(manager).toBeInstanceOf(AgentManager);
      const row = manager.store.get("a1");
      if (!row) throw new Error("agent row missing");
      manager.track(row);
      const ts = Date.now();
      manager.publish("a1", { kind: "usage", ...usage(ts, { input: 42 }) });
      manager.publish("a1", {
        kind: "limit",
        ts,
        windowKind: "five_hour",
        usedPct: 12,
        observedAt: ts,
        source: "inband",
      });
      manager.publish("a1", { kind: "action", ts, action: "typing" });
      expect(
        f.db
          .select()
          .from(usageSamples)
          .all()
          .map((r) => r.inputTokens),
      ).toEqual([42]);
      expect(
        f.db
          .select()
          .from(usageLimits)
          .all()
          .map((r) => r.usedPct),
      ).toEqual([12]);
      await manager.close();
    } finally {
      await runner.dispose();
    }
  });
});
