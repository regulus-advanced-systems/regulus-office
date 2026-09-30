/** Merge gong (#43): which merges ring, where, once; manual bangs; the queue's triple ring. */
import { describe, expect, test } from "bun:test";
import { GongRing, PrMerged } from "@regulus/protocol";
import { floorRepos, githubPulls } from "../db/schema/index.ts";
import { type AnyGitHubEvent, GitHubEventBus } from "../github/events.ts";
import { createLogger } from "../logging.ts";
import { seededDb } from "../notifications/testing.ts";
import { GONG_REST, GONG_STILL_RINGING } from "./bang-limit.ts";
import { gongMark } from "./merges.ts";
import { createCelebrations, QUEUE_EMPTY_REPEAT_MS } from "./service.ts";

interface Sent {
  floorId: string;
  type: string;
  payload: unknown;
}

function setup(opts: { live?: string[] } = {}) {
  const seed = seededDb();
  const live = new Set(opts.live ?? ["floor-1", "floor-2"]);
  const sent: Sent[] = [];
  let clock = 1_000_000;
  const bus = new GitHubEventBus();
  const make = () =>
    createCelebrations({
      db: seed.db,
      floors: {
        broadcast(floorId, type, payload) {
          if (!live.has(floorId)) return false;
          sent.push({ floorId, type, payload });
          return true;
        },
      },
      logger: createLogger({ level: "silent" }),
      now: () => clock,
    });
  const gong = make();
  gong.followGitHub(bus);
  return {
    ...seed,
    bus,
    sent,
    gong,
    make,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

function closed(
  repoIds: string[],
  number: number,
  over: {
    merged?: boolean;
    source?: "webhook" | "poll";
    stale?: boolean;
    action?: string;
    title?: string;
  } = {},
): AnyGitHubEvent {
  const merged = over.merged ?? true;
  return {
    name: "pull_request",
    action: over.action ?? "closed",
    deliveryId: `d-${number}-${over.source ?? "webhook"}`,
    source: over.source ?? "webhook",
    receivedAt: Date.now(),
    repo: { owner: "octo", name: "web", fullName: "octo/web" },
    repoIds,
    floorIds: [],
    installationId: null,
    sender: null,
    fromOfficeApp: false,
    stale: over.stale ?? false,
    payload: {
      action: over.action ?? "closed",
      pull_request: {
        number,
        state: "closed",
        ...(over.title !== undefined ? { title: over.title } : {}),
        // REST objects (polling) carry merged_at only; webhooks carry both.
        ...(over.source === "poll" ? {} : { merged }),
        merged_at: merged ? "2026-09-30T10:00:00Z" : null,
      },
    },
  };
}

describe("merged PRs", () => {
  test("a merge broadcasts pr.merged to its floor only, with the PR link", () => {
    const s = setup();
    s.bus.emit(closed(["repo-1"], 12, { title: "Ship the gong" }));
    expect(s.sent).toHaveLength(1);
    const [msg] = s.sent;
    expect(msg?.floorId).toBe("floor-1");
    expect(msg?.type).toBe("pr.merged");
    expect(PrMerged.parse(msg?.payload)).toMatchObject({
      floorId: "floor-1",
      repoId: "repo-1",
      number: 12,
      title: "Ship the gong",
      url: "https://github.com/octo/web/pull/12",
    });
  });

  test("one merge rings once: webhook and poll, replays, board merges and restarts", () => {
    const s = setup();
    s.bus.emit(closed(["repo-1"], 12));
    s.bus.emit(closed(["repo-1"], 12, { source: "poll" }));
    s.bus.emit(closed(["repo-1"], 12));
    expect(s.gong.boardMerged({ repoIds: ["repo-1"], number: 12 })).toEqual([]);
    // A fresh process on the same database: the mark is still there.
    s.gong.close();
    const again = s.make();
    again.followGitHub(s.bus);
    s.bus.emit(closed(["repo-1"], 12));
    expect(s.sent.map((m) => m.type)).toEqual(["pr.merged"]);
    // The mark is the gong's own, not #42's notification mark.
    expect(gongMark("repo-1", 12)).toBe("gong:pr_merged:repo-1#12");
    // A different PR still rings.
    s.bus.emit(closed(["repo-1"], 13));
    expect(s.sent).toHaveLength(2);
  });

  test("closed without merging, other actions, stale replays and no floor repo do not ring", () => {
    const s = setup();
    s.bus.emit(closed(["repo-1"], 20, { merged: false }));
    s.bus.emit(closed(["repo-1"], 21, { action: "opened" }));
    s.bus.emit(closed(["repo-1"], 22, { stale: true }));
    s.bus.emit(closed([], 23));
    s.bus.emit(closed(["repo-unknown"], 24));
    expect(s.sent).toEqual([]);
    // A stale replay did not claim the mark: the real event still rings.
    s.bus.emit(closed(["repo-1"], 22));
    expect(s.sent).toHaveLength(1);
  });

  test("a repo that backs two floors rings on both, each once", () => {
    const s = setup();
    s.db
      .insert(floorRepos)
      .values({
        id: "repo-3",
        floorId: "floor-2",
        owner: "octo",
        name: "web",
        url: "file:///dev/null",
        defaultBranch: "main",
        workdir: "/nonexistent",
        isPrimary: false,
        cloneStatus: "ready",
      })
      .run();
    s.bus.emit(closed(["repo-1", "repo-3"], 30));
    s.bus.emit(closed(["repo-1", "repo-3"], 30, { source: "poll" }));
    expect(s.sent.map((m) => m.floorId).sort()).toEqual(["floor-1", "floor-2"]);
  });

  test("a board merge rings at once, titled from the board cache", () => {
    const s = setup();
    s.db
      .insert(githubPulls)
      .values({
        repoId: "repo-2",
        number: 5,
        title: "Oil the doors",
        state: "open",
        ghUpdatedAt: new Date(1),
      })
      .run();
    expect(s.gong.boardMerged({ repoIds: ["repo-2"], number: 5 })).toEqual(["floor-2"]);
    expect(PrMerged.parse(s.sent[0]?.payload).title).toBe("Oil the doors");
    // The webhook that follows is a no-op.
    s.bus.emit(closed(["repo-2"], 5));
    expect(s.sent).toHaveLength(1);
  });

  test("a merge while nobody is on the floor is not replayed later", () => {
    const s = setup({ live: [] });
    s.bus.emit(closed(["repo-1"], 40));
    expect(s.sent).toEqual([]);
  });
});

describe("manual bang", () => {
  const mia = { userId: "u-mia", displayName: "Mia" };
  const sam = { userId: "u-sam", displayName: "Sam" };

  test("a bang rings once on that floor, naming who banged it", () => {
    const s = setup();
    expect(s.gong.bang("floor-2", mia)).toEqual({ ok: true });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.floorId).toBe("floor-2");
    expect(s.sent[0]?.type).toBe("gong.ring");
    expect(GongRing.parse(s.sent[0]?.payload)).toMatchObject({
      cause: "bang",
      strikes: 1,
      by: "Mia",
    });
  });

  test("the floor waits for the ring to finish; other floors do not", () => {
    const s = setup();
    expect(s.gong.bang("floor-1", mia).ok).toBe(true);
    expect(s.gong.bang("floor-1", sam)).toEqual({ ok: false, reason: GONG_STILL_RINGING });
    expect(s.gong.bang("floor-2", sam).ok).toBe(true);
    s.tick(4_000);
    expect(s.gong.bang("floor-1", sam).ok).toBe(true);
    expect(s.sent).toHaveLength(3);
  });

  test("a merge also holds off bangs for the length of its ring", () => {
    const s = setup();
    s.bus.emit(closed(["repo-1"], 50));
    expect(s.gong.bang("floor-1", mia).ok).toBe(false);
    s.tick(4_000);
    expect(s.gong.bang("floor-1", mia).ok).toBe(true);
  });

  test("one human gets three bangs, then one every 20 s", () => {
    const s = setup();
    for (let i = 0; i < 3; i++) {
      expect(s.gong.bang("floor-1", mia).ok).toBe(true);
      s.tick(4_000);
    }
    expect(s.gong.bang("floor-1", mia)).toEqual({ ok: false, reason: GONG_REST });
    // Someone else may still bang it.
    expect(s.gong.bang("floor-1", sam).ok).toBe(true);
    s.tick(20_000);
    expect(s.gong.bang("floor-1", mia).ok).toBe(true);
    s.tick(4_000);
    expect(s.gong.bang("floor-1", mia).ok).toBe(false);
    expect(s.sent.filter((m) => m.type === "gong.ring")).toHaveLength(5);
  });
});

describe("queue emptied (#37 hook)", () => {
  test("a triple ring, once per burst of empties", () => {
    const s = setup();
    expect(s.gong.queueEmptied("floor-1")).toBe(true);
    expect(GongRing.parse(s.sent[0]?.payload)).toMatchObject({
      floorId: "floor-1",
      cause: "queue_empty",
      strikes: 3,
    });
    expect(s.gong.queueEmptied("floor-1")).toBe(false);
    expect(s.gong.queueEmptied("floor-2")).toBe(true);
    s.tick(QUEUE_EMPTY_REPEAT_MS);
    expect(s.gong.queueEmptied("floor-1")).toBe(true);
    expect(s.sent.map((m) => m.floorId)).toEqual(["floor-1", "floor-2", "floor-1"]);
  });
});
