import { describe, expect, test } from "bun:test";
import { usageLimits, usageSamples } from "../db/schema/index.ts";
import { usage, usageDb } from "./testing.ts";
import { UsageTracker } from "./tracker.ts";

const T = Date.parse("2026-09-30T10:00:00Z");

function setup() {
  const f = usageDb();
  let stored = 0;
  const tracker = new UsageTracker(f.db, () => stored++);
  const rows = () => f.db.select().from(usageSamples).all();
  const limits = () => f.db.select().from(usageLimits).all();
  return { ...f, tracker, rows, limits, stored: () => stored };
}

describe("UsageTracker", () => {
  test("henchman usage goes to its owner, priced from the henchman's model", () => {
    const { tracker, rows, addAgent, ada } = setup();
    addAgent("a1", ada.id, { provider: "codex", model: "gpt-6-sol" });
    tracker.agentEvent("a1", { kind: "usage", ...usage(T, { input: 1_000_000, output: 100_000 }) });
    const [row] = rows();
    expect(row).toMatchObject({
      userId: ada.id,
      agentId: "a1",
      provider: "codex",
      model: "gpt-6-sol",
    });
    expect(row?.costUsdEstimate).toBeCloseTo(3, 6);
  });

  test("office-key henchmen are attributed to office and their limits are not stored (D2)", () => {
    const { tracker, rows, limits, addAgent, bob } = setup();
    addAgent("a2", bob.id, { provider: "claude-code", profileId: "office:claude-code" });
    tracker.agentEvent("a2", {
      kind: "usage",
      ...usage(T, { output: 10 }, { costUsdEstimate: 0.5 }),
    });
    tracker.agentEvent("a2", {
      kind: "limit",
      ts: T,
      windowKind: "five_hour",
      usedPct: 40,
      observedAt: T,
      source: "statusline",
    });
    expect(rows()[0]).toMatchObject({ userId: null, agentId: "a2", costUsdEstimate: 0.5 });
    expect(limits()).toEqual([]);
  });

  test("dedupe: the same Codex thread total or transcript message counts once", () => {
    const { tracker, rows, addAgent, ada, stored } = setup();
    addAgent("a1", ada.id, { provider: "codex" });
    const e = {
      kind: "usage" as const,
      ...usage(T, { input: 5 }, { dedupeKey: "thread-total:5" }),
    };
    tracker.agentEvent("a1", e);
    tracker.agentEvent("a1", e);
    const t = usage(
      T,
      { input: 7 },
      { source: "transcript", dedupeKey: "msg_1:req_1", sessionId: "s1" },
    );
    expect(tracker.transcriptSamples(ada.id, "claude-code", [t, t])).toBe(1);
    expect(tracker.transcriptSamples(ada.id, "claude-code", [t])).toBe(0);
    expect(rows()).toHaveLength(2);
    expect(stored()).toBe(2);
  });

  test("transcripts: henchman sessions go to the henchman, office-key henchmen to office, the rest to the human", () => {
    const { tracker, rows, addAgent, ada, bob } = setup();
    addAgent("mine", ada.id, { session: "s-mine" });
    addAgent("office-henchman", ada.id, { session: "s-office", profileId: "office:claude-code" });
    addAgent("bobs", bob.id, { session: "s-bob" });
    const at = (session: string, key: string) =>
      usage(
        T,
        { input: 1 },
        { source: "transcript", sessionId: session, dedupeKey: key, model: "claude-sonnet-5-5" },
      );
    tracker.transcriptSamples(ada.id, "claude-code", [
      at("s-mine", "k1"),
      at("s-office", "k2"),
      at("s-terminal", "k3"),
      // A session id of Bob's henchman found in Ada's runner is not Bob's henchman.
      at("s-bob", "k4"),
    ]);
    const by = Object.fromEntries(rows().map((r) => [r.dedupeKey?.split(":").at(-1), r]));
    expect(by.k1).toMatchObject({ userId: ada.id, agentId: "mine" });
    expect(by.k2).toMatchObject({ userId: null, agentId: "office-henchman" });
    expect(by.k3).toMatchObject({ userId: ada.id, agentId: null });
    expect(by.k4).toMatchObject({ userId: ada.id, agentId: null });
  });

  test("limits keep the newest reading per window", () => {
    const { tracker, limits, ada } = setup();
    const limit = (usedPct: number, observedAt: number) => ({
      windowKind: "seven_day" as const,
      usedPct,
      observedAt,
      source: "inband" as const,
    });
    tracker.limit(ada.id, "codex", limit(30, T));
    tracker.limit(ada.id, "codex", limit(10, T - 1000));
    tracker.limit(ada.id, "codex", limit(35, T + 1000));
    expect(limits().map((l) => l.usedPct)).toEqual([35]);
  });

  test("statusline samples are replaced by the transcript for the sessions it read", () => {
    const { tracker, rows, addAgent, ada } = setup();
    addAgent("a1", ada.id, { session: "s1" });
    const line = (ts: number, session: string) => ({
      kind: "usage" as const,
      ...usage(
        ts,
        { input: 1 },
        { source: "statusline", sessionId: session, costUsdEstimate: 0.1 },
      ),
    });
    tracker.agentEvent("a1", line(T, "s1"));
    tracker.agentEvent("a1", line(T, "s2"));
    tracker.agentEvent("a1", line(T + 10_000, "s1"));
    expect(tracker.store.supersedeStatusline(["s1"], T + 5_000)).toBe(1);
    expect(
      rows()
        .map((r) => `${r.sessionId}@${r.ts.getTime() - T}`)
        .sort(),
    ).toEqual(["s1@10000", "s2@0"]);
  });

  test("recordUsage: other modules attribute usage to office or a human, deduped", () => {
    const { tracker, rows, ada } = setup();
    const sample = usage(T, { input: 1_000_000 }, { dedupeKey: "wf-run-1:step-2" });
    expect(
      tracker.recordUsage({
        attributedTo: "office",
        provider: "codex",
        sample,
        model: "gpt-6-luna",
      }),
    ).toBe(true);
    expect(tracker.recordUsage({ attributedTo: "office", provider: "codex", sample })).toBe(false);
    expect(
      tracker.recordUsage({
        attributedTo: { userId: ada.id },
        provider: "codex",
        sample: usage(T),
      }),
    ).toBe(true);
    const [office, human] = rows();
    expect(office).toMatchObject({ userId: null, model: "gpt-6-luna" });
    expect(office?.costUsdEstimate).toBeCloseTo(0.1, 6);
    expect(human?.userId).toBe(ada.id);
  });

  test("unknown henchmen are ignored", () => {
    const { tracker, rows } = setup();
    tracker.agentEvent("nope", { kind: "usage", ...usage(T, { input: 1 }) });
    expect(rows()).toEqual([]);
  });
});
