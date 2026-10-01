/** Merged henchman PRs notify from the GitHub event bus (#35 → #42), once per merge. */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { agents } from "../db/schema/index.ts";
import { type AnyGitHubEvent, GitHubEventBus } from "../github/events.ts";
import { NotificationDirectory } from "./directory.ts";
import type { HenchmanSnapshot } from "./events.ts";
import { notifyMergedPullRequests } from "./pr-merged.ts";
import { captureLogger, seededDb } from "./testing.ts";

function setup() {
  const seed = seededDb();
  seed.addAgent("a1", 1, seed.member.id, 11);
  seed.addAgent("a2", 2, seed.member.id, 22);
  seed.addAgent("a3", 1, seed.other.id, null);
  const bus = new GitHubEventBus();
  const merged: HenchmanSnapshot[] = [];
  const directory = new NotificationDirectory(seed.db);
  const off = notifyMergedPullRequests({
    db: seed.db,
    events: bus,
    center: { pullRequestMerged: (henchman) => merged.push(henchman) },
    directory,
    logger: captureLogger().logger,
  });
  return { ...seed, bus, merged, directory, off };
}

function closed(
  repoIds: string[],
  number: number,
  over: { merged?: boolean; source?: "webhook" | "poll"; stale?: boolean; action?: string } = {},
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
    operationIds: [],
    installationId: null,
    sender: null,
    fromOfficeApp: false,
    stale: over.stale ?? false,
    payload: {
      action: over.action ?? "closed",
      pull_request: {
        number,
        state: "closed",
        // REST objects (polling) carry merged_at; webhooks carry both.
        ...(over.source === "poll" ? {} : { merged }),
        merged_at: merged ? "2026-09-30T10:00:00Z" : null,
      },
    },
  };
}

describe("notifyMergedPullRequests", () => {
  test("a merge notifies the henchman's owner once, whether webhook or poll reports it", () => {
    const s = setup();
    s.bus.emit(closed(["repo-1"], 11));
    s.bus.emit(closed(["repo-1"], 11, { source: "poll" }));
    expect(s.merged).toHaveLength(1);
    expect(s.merged[0]).toMatchObject({
      agentId: "a1",
      repoId: "repo-1",
      ownerUserId: s.member.id,
      ownerName: "Mia",
      prNumber: 11,
    });
    // Across restarts: a new subscriber on the same database stays quiet.
    s.off();
    const again: HenchmanSnapshot[] = [];
    notifyMergedPullRequests({
      db: s.db,
      events: s.bus,
      center: { pullRequestMerged: (r) => again.push(r) },
      directory: new NotificationDirectory(s.db),
      logger: captureLogger().logger,
    });
    s.bus.emit(closed(["repo-1"], 11));
    expect(again).toHaveLength(0);
  });

  test("a poll that only has merged_at counts as a merge", () => {
    const s = setup();
    s.bus.emit(closed(["repo-2"], 22, { source: "poll" }));
    expect(s.merged.map((r) => r.agentId)).toEqual(["a2"]);
  });

  test("closed without merge, other actions, other PRs, other repos and stale replays are ignored", () => {
    const s = setup();
    s.bus.emit(closed(["repo-1"], 11, { merged: false }));
    s.bus.emit(closed(["repo-1"], 11, { action: "opened" }));
    s.bus.emit(closed(["repo-1"], 99));
    s.bus.emit(closed(["repo-2"], 11));
    s.bus.emit(closed([], 11));
    s.bus.emit(closed(["repo-1"], 11, { stale: true }));
    expect(s.merged).toHaveLength(0);
    // A close without merge leaves no mark: a later reopen + merge still notifies.
    s.bus.emit(closed(["repo-1"], 11));
    expect(s.merged).toHaveLength(1);
  });

  test("a PR merged after its henchman was sent home still reaches the owner", () => {
    const s = setup();
    s.db
      .update(agents)
      .set({ status: "exited", exitedAt: new Date() })
      .where(eq(agents.id, "a1"))
      .run();
    s.bus.emit(closed(["repo-1"], 11));
    expect(s.merged).toEqual([
      expect.objectContaining({ agentId: "a1", status: "exited", ownerUserId: s.member.id }),
    ]);
  });
});
