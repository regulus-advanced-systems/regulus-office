/**
 * Polling mode against the fake GitHub (#35): first pass, ETag 304s, changes
 * → cache → board → bus, rate-limit pauses and backoff, missing permissions.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fakeIssue, fakePull } from "./fake-github-boards.ts";
import { type SyncFixture, syncFixture, WEBHOOK_SECRET } from "./sync-fixture.ts";
import { signWebhookBody } from "./webhook-signature.ts";

let f: SyncFixture;
afterEach(() => f?.stop());

const clock = { t: Date.now() };
const at = (minutesAgo: number) => new Date(clock.t - minutesAgo * 60_000).toISOString();

function seeded() {
  clock.t = Date.now();
  f = syncFixture({ now: () => clock.t });
  const hello = f.boards.repo("octo", "hello");
  hello.issues.push(
    fakeIssue(1, { updated_at: at(30) }),
    fakeIssue(2, { updated_at: at(20), labels: [] }),
    fakeIssue(3, { state: "closed", updated_at: at(10_000) }),
  );
  hello.pulls.push(fakePull(10, { updated_at: at(5), requested_reviewers: [{ login: "bob" }] }));
  hello.reviews[10] = [
    { user: { login: "ada" }, state: "CHANGES_REQUESTED" },
    { user: { login: "ada" }, state: "COMMENTED" },
    { user: { login: "ada" }, state: "APPROVED" },
  ];
  hello.suites.sha10aaaa = [
    { id: 1, status: "completed", conclusion: "success", latest_check_runs_count: 2 },
    // An app that never runs checks: ignored, not "pending" forever.
    { id: 2, status: "queued", conclusion: null, latest_check_runs_count: 0 },
  ];
  f.boards.repo("octo", "other").issues.push(fakeIssue(4, { updated_at: at(1) }));
  return hello;
}

const tick = async (minutes = 1.1) => {
  clock.t += minutes * 60_000;
  await f.sync.pollNow();
};
const board = (operationId: string) => f.published.get(operationId) ?? { issues: [], pulls: [] };
const statuses = (from: number) => f.boards.log.slice(from).map((l) => l.status);

describe("first pass and conditional requests", () => {
  test("fills the cache and every following operation's board, without events", async () => {
    seeded();
    await f.sync.pollNow();
    const alpha = board(f.alpha.operationId);
    expect(alpha.issues.map((i) => i.number).sort()).toEqual([1, 2, 4]);
    expect(alpha.pulls).toEqual([
      expect.objectContaining({ number: 10, checksState: "success", reviewState: "approved" }),
    ]);
    expect(
      board(f.beta.operationId)
        .issues.map((i) => i.number)
        .sort(),
    ).toEqual([1, 2]);
    expect(f.events).toHaveLength(0);
    // Pull requests in the issues list are not issues.
    expect(alpha.issues.some((i) => i.number === 10)).toBe(false);
    expect(f.sync.status()).toMatchObject({ mode: "polling", repos: 2 });
    expect(f.sync.status().lastPollAt).toBe(clock.t);
  });

  test("unchanged repos answer 304 on every conditional request", async () => {
    seeded();
    await f.sync.pollNow();
    await tick(); // first steady pass learns the ETags
    const before = f.boards.log.length;
    const remaining = f.boards.rate.remaining;
    await tick();
    expect(statuses(before).length).toBeGreaterThan(0);
    expect(statuses(before).every((s) => s === 304)).toBe(true);
    expect(f.boards.rate.remaining).toBe(remaining);
    expect(f.events).toHaveLength(0);
  });

  test("repos are not polled before their interval, nor without a token", async () => {
    seeded();
    await f.sync.pollNow();
    const before = f.boards.log.length;
    await tick(0.5);
    expect(f.boards.log.length).toBe(before);
    f.stop();

    clock.t = Date.now();
    f = syncFixture({ now: () => clock.t, token: null });
    f.boards.repo("octo", "hello").issues.push(fakeIssue(1));
    await f.sync.pollNow();
    expect(f.boards.log).toHaveLength(0);
    expect(f.published.size).toBe(0);
  });
});

describe("changes", () => {
  test("closed issue, new PR, failing checks and a new review reach cache, board and bus", async () => {
    const hello = seeded();
    await f.sync.pollNow();
    await tick();
    Object.assign(hello.issues[0] as object, { state: "closed", updated_at: at(0) });
    hello.pulls.push(fakePull(11, { updated_at: at(0) }));
    hello.suites.sha10aaaa = [
      { id: 1, status: "completed", conclusion: "failure", latest_check_runs_count: 2 },
    ];
    hello.reviews[10]?.push({ user: { login: "bob" }, state: "CHANGES_REQUESTED" });
    Object.assign(hello.pulls[0] as object, { updated_at: at(0) });
    await tick();

    const alpha = board(f.alpha.operationId);
    expect(alpha.issues.find((i) => i.number === 1)?.state).toBe("closed");
    expect(alpha.pulls.find((p) => p.number === 11)).toBeDefined();
    expect(alpha.pulls.find((p) => p.number === 10)).toMatchObject({
      checksState: "failure",
      reviewState: "changes_requested",
    });
    const seen = f.events.map((e) => `${e.name}.${e.action}.${e.source}`);
    expect(seen).toContain("issues.closed.poll");
    expect(seen).toContain("pull_request.opened.poll");
    expect(f.events.every((e) => e.operationIds.includes(f.alpha.operationId))).toBe(true);
  });

  test("a PR opened and merged between two polls is reported closed, with merged_at", async () => {
    const hello = seeded();
    hello.pulls.push(
      fakePull(30, { state: "closed", merged_at: at(20_000), updated_at: at(20_000) }),
    );
    await f.sync.pollNow();
    await tick();
    expect(f.events).toHaveLength(0); // old closed PRs are learnt in the first pass, silently
    hello.pulls.push(fakePull(12, { state: "closed", merged_at: at(0), updated_at: at(0) }));
    await tick();
    const event = f.events.find((e) => e.name === "pull_request");
    expect(event).toMatchObject({ action: "closed", source: "poll", stale: false });
    expect(
      (event?.payload as { pull_request?: { merged_at?: unknown } }).pull_request?.merged_at,
    ).toBeString();
    expect(board(f.alpha.operationId).pulls.find((p) => p.number === 12)).toMatchObject({
      merged: true,
    });
  });

  test("an installation webhook makes the next poll start over", async () => {
    seeded();
    await f.sync.pollNow();
    await tick();
    const body = JSON.stringify({ action: "added", installation: { id: 3 } });
    const request = new Request("https://office.example.com/api/github/webhook", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-github-event": "installation_repositories",
        "x-github-delivery": randomUUID(),
        "x-hub-signature-256": signWebhookBody(WEBHOOK_SECRET, body),
      },
    });
    const res = await f.sync.webhookHandler({ request, url: new URL(request.url), params: {} });
    expect(res.status).toBe(202);
    f.sync.stop(); // no background timer; poll by hand
    const before = f.boards.log.length;
    await f.sync.pollNow();
    expect(f.boards.log.slice(before).some((l) => l.path.includes("state=open"))).toBe(true);
  });
});

describe("rate limits", () => {
  test("403 with no requests left pauses until the reset", async () => {
    seeded();
    f.boards.rate.next = { status: 403, remaining: 0 };
    await f.sync.pollNow();
    expect(f.sync.status().rateLimitedUntil).toBe(f.boards.rate.reset * 1000);
    const before = f.boards.log.length;
    await tick(5);
    expect(f.boards.log.length).toBe(before);
  });

  test("429 with retry-after waits that long, then resumes", async () => {
    seeded();
    f.boards.rate.next = { status: 429, retryAfter: 120 };
    await f.sync.pollNow();
    expect(f.sync.status().rateLimitedUntil).toBe(clock.t + 120_000);
    const before = f.boards.log.length;
    await tick(1);
    expect(f.boards.log.length).toBe(before);
    await tick(1.5);
    expect(f.boards.log.length).toBeGreaterThan(before);
    expect(board(f.alpha.operationId).issues.length).toBeGreaterThan(0);
  });

  test("a secondary limit backs off a minute; a low remaining count pauses until the reset", async () => {
    seeded();
    f.boards.rate.next = {
      status: 403,
      message: "You have exceeded a secondary rate limit",
      remaining: 4000,
    };
    await f.sync.pollNow();
    expect(f.sync.status().rateLimitedUntil).toBe(clock.t + 60_000);
    f.stop();

    seeded();
    f.boards.rate.remaining = 20;
    await f.sync.pollNow();
    expect(f.sync.status().rateLimitedUntil).toBe(f.boards.rate.reset * 1000);
  });

  test("a token without Checks permission skips checks instead of pausing", async () => {
    seeded();
    f.boards.rate.forbidden = ["check-suites"];
    await f.sync.pollNow();
    expect(f.sync.status().rateLimitedUntil).toBeNull();
    expect(board(f.alpha.operationId).pulls[0]).toMatchObject({
      checksState: "none",
      reviewState: "approved",
    });
    const before = f.boards.log.length;
    await tick();
    expect(f.boards.log.slice(before).some((l) => l.path.includes("check-suites"))).toBe(false);
  });

  test("other failures back off per repo", async () => {
    seeded();
    f.gh.state.failAll = true;
    await f.sync.pollNow();
    const before = f.gh.calls.length;
    await tick(1.1); // backoff is 2 intervals after the first failure
    expect(f.gh.calls.length).toBe(before);
    f.gh.state.failAll = false;
    await tick(1.1);
    expect(board(f.alpha.operationId).issues.length).toBeGreaterThan(0);
  });
});
