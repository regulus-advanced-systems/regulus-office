import { describe, expect, test } from "bun:test";
import { BuildingStateSchema, MyUsage, UsageSummary } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { agents } from "../db/schema/index.ts";
import { applyUsageSummary, sameUsage } from "./room-state.ts";
import { localDayStart, UsageSummaries } from "./summary.ts";
import { usage, usageDb } from "./testing.ts";
import { UsageTracker } from "./tracker.ts";

const NOW = Date.parse("2026-09-30T15:00:00Z");
const HOUR = 3_600_000;

function office() {
  const f = usageDb();
  const tracker = new UsageTracker(f.db);
  const summaries = new UsageSummaries(
    f.db,
    () => NOW,
    () => 0,
  );
  f.addAgent("ada-1", f.ada.id, { provider: "codex", taskTitle: "Top secret merger" });
  f.addAgent("bob-1", f.bob.id, { provider: "claude-code" });
  f.addAgent("bob-office", f.bob.id, { provider: "claude-code", profileId: "office:claude-code" });
  const spend = (agentId: string, ts: number, input: number, cost: number) =>
    tracker.agentEvent(agentId, {
      kind: "usage",
      ...usage(ts, { input }, { costUsdEstimate: cost }),
    });
  spend("ada-1", NOW - HOUR, 1_000, 1);
  spend("ada-1", NOW - 30 * HOUR, 5_000, 5); // yesterday, within 7 days
  spend("bob-1", NOW - 2 * HOUR, 9_000, 2);
  spend("bob-office", NOW - HOUR, 500, 0.5);
  const limit = (
    userId: string,
    provider: "codex" | "claude-code",
    usedPct: number,
    resetsAt: number,
  ) =>
    tracker.limit(userId, provider, {
      windowKind: "five_hour",
      usedPct,
      resetsAt,
      observedAt: NOW - HOUR,
      source: "inband",
    });
  limit(f.ada.id, "codex", 42, NOW + HOUR);
  limit(f.bob.id, "claude-code", 97, NOW + HOUR);
  return { ...f, tracker, summaries, limit };
}

describe("per-viewer privacy", () => {
  test("a viewer sees only their own limits and spend", () => {
    const { summaries, ada, bob, cy } = office();
    const a = MyUsage.parse(summaries.mine(ada.id));
    expect(a.limits.map((l) => [l.provider, l.usedPct])).toEqual([["codex", 42]]);
    expect(a.today).toMatchObject({ inputTokens: 1_000, costUsd: 1 });
    expect(a.last7Days).toMatchObject({ inputTokens: 6_000, costUsd: 6 });
    expect(a.byProvider.map((p) => p.provider)).toEqual(["codex"]);
    const text = JSON.stringify(a);
    expect(text).not.toContain("97");
    expect(text).not.toContain(bob.id);

    const b = summaries.mine(bob.id);
    // Office-key usage of Bob's henchman is the office's, not Bob's.
    expect(b.today).toMatchObject({ inputTokens: 9_000, costUsd: 2 });
    expect(b.limits.map((l) => l.usedPct)).toEqual([97]);

    const c = summaries.mine(cy.id);
    expect(c.limits).toEqual([]);
    expect(c.today.costUsd).toBe(0);
  });

  test("shared office state: totals, office keys, and henchmen by name and owner only", () => {
    const { summaries } = office();
    const s = UsageSummary.parse(summaries.office());
    expect(s.todayInputTokens).toBe(10_500);
    expect(s.todayCostUsdEstimate).toBeCloseTo(3.5, 6);
    expect(s.officeKeysCostUsdEstimate).toBeCloseTo(0.5, 6);
    expect(s.activeHumans).toBe(2);
    expect(s.topHenchmen.map((r) => [r.name, r.ownerName, r.tokens])).toEqual([
      ["Bob's Claude Code henchman", "Bob", 9_000],
      ["Ada's Codex henchman", "Ada", 1_000],
      ["Bob's Claude Code henchman", "Bob", 500],
    ]);
    // A named henchman shows its own name first, still with whose it is (#256).
    const f = office();
    f.db.update(agents).set({ name: "Gasket" }).where(eq(agents.id, "ada-1")).run();
    expect(f.summaries.office().topHenchmen.map((r) => r.name)).toContain(
      "Gasket, Ada's Codex henchman",
    );
    for (const r of s.topHenchmen) {
      expect(Object.keys(r).sort()).toEqual(["agentId", "name", "ownerName", "provider", "tokens"]);
    }
    const text = JSON.stringify(s);
    expect(text).not.toContain("Top secret");
    expect(text).not.toContain("usedPct");
  });

  test("a window whose reset time has passed reads 0 %", () => {
    const { summaries, limit, cy } = office();
    limit(cy.id, "codex", 80, NOW - 1);
    expect(summaries.mine(cy.id).limits[0]).toMatchObject({ usedPct: 0, reset: true });
  });

  test("the BuildingRoom state gets the office summary and nothing else", () => {
    const { summaries } = office();
    const state = new BuildingStateSchema();
    const s = summaries.office();
    applyUsageSummary(state.usage, s);
    expect(state.usage.topHenchmen.length).toBe(3);
    expect(state.usage.topHenchmen[0]?.ownerName).toBe("Bob");
    expect(state.usage.todayCostUsdEstimate).toBeCloseTo(3.5, 6);
    expect(sameUsage(s, { ...s, observedAt: s.observedAt + 1 })).toBe(true);
    expect(sameUsage(s, { ...s, activeHumans: 9 })).toBe(false);
  });
});

describe("localDayStart", () => {
  test("UTC and offsets", () => {
    expect(localDayStart(NOW, 0)).toBe(Date.parse("2026-09-30T00:00:00Z"));
    // UTC+2 (offset -120): local midnight is 22:00 UTC the day before.
    expect(localDayStart(NOW, -120)).toBe(Date.parse("2026-09-29T22:00:00Z"));
    // UTC-10 at 03:00 UTC is still the previous local day.
    expect(localDayStart(Date.parse("2026-09-30T03:00:00Z"), 600)).toBe(
      Date.parse("2026-09-29T10:00:00Z"),
    );
    expect(localDayStart(NOW, 99_999)).toBe(Date.parse("2026-09-30T00:00:00Z"));
  });
});
