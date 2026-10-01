/**
 * The webhook endpoint end to end against the fake GitHub fixture (#35):
 * refusal before parsing, dedupe, each event type → cache → OperationRoom board
 * summary → event bus, loop protection and replay flags.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fakeIssue, fakePull } from "./fake-github-boards.ts";
import { APP_ID, APP_SLUG, type SyncFixture, syncFixture, WEBHOOK_SECRET } from "./sync-fixture.ts";
import { DeliveryLog } from "./webhook-deliveries.ts";
import { signWebhookBody } from "./webhook-signature.ts";

const HOOK_URL = "https://office.example.com/api/github/webhook";
const repository = { name: "hello", full_name: "octo/hello", owner: { login: "octo" } };
const human = { login: "olga", id: 1, type: "User" };

let f: SyncFixture;
afterEach(() => f?.stop());

function deliver(
  event: string,
  payload: unknown,
  opts: { id?: string; secret?: string; signature?: string | null; contentType?: string } = {},
) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "application/json",
    "x-github-event": event,
    "x-github-delivery": opts.id ?? randomUUID(),
  };
  const signature =
    opts.signature === undefined
      ? signWebhookBody(opts.secret ?? WEBHOOK_SECRET, body)
      : opts.signature;
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  const request = new Request(HOOK_URL, { method: "POST", body, headers });
  return f.sync.webhookHandler({ request, url: new URL(HOOK_URL), params: {} });
}

const board = (operationId: string) => f.published.get(operationId) ?? { issues: [], pulls: [] };
const recent = (ms = 0) => new Date(Date.now() - 60_000 + ms).toISOString();

describe("refusals (before any JSON is parsed)", () => {
  test("unsigned, badly signed, wrong type, too large, no secret", async () => {
    f = syncFixture();
    const junk = "{not json";
    expect((await deliver("issues", junk, { signature: null })).status).toBe(401);
    expect((await deliver("issues", junk, { secret: "wrong" })).status).toBe(401);
    expect(
      (await deliver("issues", junk, { contentType: "application/x-www-form-urlencoded" })).status,
    ).toBe(415);
    const big = JSON.stringify({ pad: "x".repeat(4 * 1024 * 1024 + 10) });
    expect((await deliver("issues", big)).status).toBe(413);
    expect((await deliver("issues", {}, { id: "bad id!" })).status).toBe(400);
    // A correctly signed body that is not JSON is only then refused as such.
    expect((await deliver("issues", junk)).status).toBe(400);
    expect(f.events).toHaveLength(0);
    expect(f.published.size).toBe(0);
    f.stop();

    f = syncFixture({ webhookSecret: null });
    const res = await deliver("issues", { action: "opened" });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("whsec");
  });

  test("a flood of bad deliveries is rate limited", async () => {
    f = syncFixture();
    const statuses: number[] = [];
    for (let i = 0; i < 80; i += 1)
      statuses.push((await deliver("issues", "x", { signature: null })).status);
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 50).every((s) => s === 401)).toBe(true);
  });

  test("ping is acknowledged", async () => {
    f = syncFixture();
    expect((await deliver("ping", { zen: "Keep it logically awesome." })).status).toBe(200);
    expect(f.sync.status().mode).toBe("webhook");
  });
});

describe("issues", () => {
  test("opened → cache → both operations' boards → bus; a duplicate delivery is dropped", async () => {
    f = syncFixture();
    const id = randomUUID();
    const payload = {
      action: "opened",
      issue: fakeIssue(7, { updated_at: recent() }),
      repository,
      sender: human,
      installation: { id: 3 },
    };
    expect((await deliver("issues", payload, { id })).status).toBe(202);
    const card = board(f.alpha.operationId).issues[0];
    expect(card).toMatchObject({
      repoId: f.alpha.repoIds[0],
      number: 7,
      title: "Issue 7",
      state: "open",
      labels: ["bug"],
      assignees: ["ada"],
      author: "olga",
      url: "https://github.com/octo/hello/issues/7",
    });
    expect(board(f.beta.operationId).issues[0]?.repoId).toBe(f.beta.repoIds[0]);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      name: "issues",
      action: "opened",
      deliveryId: id,
      source: "webhook",
      repo: { owner: "octo", name: "hello", fullName: "octo/hello" },
      operationIds: [f.alpha.operationId, f.beta.operationId],
      installationId: 3,
      sender: { login: "olga", type: "User" },
      fromOfficeApp: false,
      stale: false,
    });

    const again = await deliver("issues", payload, { id });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(f.events).toHaveLength(1);
  });

  test("an older copy never regresses the cache and is flagged stale when out of the window", async () => {
    f = syncFixture();
    await deliver("issues", {
      action: "edited",
      issue: fakeIssue(7, { title: "New", updated_at: recent() }),
      repository,
    });
    const old = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    await deliver("issues", {
      action: "opened",
      issue: fakeIssue(7, { title: "Old", updated_at: old }),
      repository,
    });
    expect(board(f.alpha.operationId).issues[0]?.title).toBe("New");
    expect(f.events.map((e) => e.stale)).toEqual([false, true]);
  });

  test("closed stays on the board for a while; deleted removes it", async () => {
    f = syncFixture();
    await deliver("issues", {
      action: "closed",
      issue: fakeIssue(8, { state: "closed", updated_at: recent() }),
      repository,
    });
    expect(board(f.alpha.operationId).issues[0]?.state).toBe("closed");
    await deliver("issues", {
      action: "deleted",
      issue: fakeIssue(8, { updated_at: recent(1) }),
      repository,
    });
    expect(board(f.alpha.operationId).issues).toHaveLength(0);
  });

  test("a repo no operation follows updates nothing but still reaches the bus", async () => {
    f = syncFixture();
    const other = { name: "x", full_name: "someone/x", owner: { login: "someone" } };
    expect(
      (await deliver("issues", { action: "opened", issue: fakeIssue(1), repository: other }))
        .status,
    ).toBe(202);
    expect(f.published.size).toBe(0);
    expect(f.events[0]?.repoIds).toEqual([]);
  });
});

describe("pull requests, reviews and checks", () => {
  test("opened → checks → reviews → synchronize → merged", async () => {
    f = syncFixture();
    const pr = (over: Record<string, unknown>) => fakePull(5, { updated_at: recent(), ...over });
    await deliver("pull_request", {
      action: "opened",
      pull_request: pr({ requested_reviewers: [{ login: "ada" }] }),
      repository,
    });
    let card = board(f.alpha.operationId).pulls[0];
    expect(card).toMatchObject({
      number: 5,
      headBranch: "office/fix-5",
      draft: false,
      merged: false,
      checksState: "none",
      reviewState: "review_required",
    });

    const suite = (id: number, over: Record<string, unknown>) => ({
      id,
      head_sha: "sha5aaaa",
      latest_check_runs_count: 1,
      updated_at: recent(),
      pull_requests: [{ number: 5 }],
      app: { id: 99 },
      ...over,
    });
    await deliver("check_suite", {
      action: "requested",
      check_suite: suite(1, { status: "queued", latest_check_runs_count: 0 }),
      repository,
    });
    expect(board(f.alpha.operationId).pulls[0]?.checksState).toBe("none");
    await deliver("check_run", {
      action: "created",
      check_run: {
        id: 11,
        status: "in_progress",
        check_suite: suite(1, { status: "in_progress", latest_check_runs_count: undefined }),
      },
      repository,
    });
    expect(board(f.alpha.operationId).pulls[0]?.checksState).toBe("pending");
    await deliver("check_suite", {
      action: "completed",
      check_suite: suite(1, { status: "completed", conclusion: "success" }),
      repository,
    });
    await deliver("check_suite", {
      action: "completed",
      check_suite: suite(2, { status: "completed", conclusion: "failure" }),
      repository,
    });
    expect(board(f.alpha.operationId).pulls[0]?.checksState).toBe("failure");
    await deliver("check_suite", {
      action: "rerequested",
      check_suite: suite(2, { status: "in_progress" }),
      repository,
    });
    expect(board(f.alpha.operationId).pulls[0]?.checksState).toBe("pending");

    const review = (state: string, login = "ada") => ({
      action: "submitted",
      review: { id: 1, state, user: { login }, submitted_at: recent() },
      pull_request: { number: 5, updated_at: recent() },
      repository,
    });
    await deliver("pull_request_review", review("commented"));
    expect(board(f.alpha.operationId).pulls[0]?.reviewState).toBe("review_required");
    await deliver("pull_request_review", review("approved"));
    expect(board(f.alpha.operationId).pulls[0]?.reviewState).toBe("approved");
    await deliver("pull_request_review", review("changes_requested", "bob"));
    expect(board(f.alpha.operationId).pulls[0]?.reviewState).toBe("changes_requested");
    await deliver("pull_request_review", {
      ...review("changes_requested", "bob"),
      action: "dismissed",
    });
    expect(board(f.alpha.operationId).pulls[0]?.reviewState).toBe("approved");

    // New commits: the old head's checks no longer apply.
    await deliver("pull_request", {
      action: "synchronize",
      pull_request: pr({
        head: { ref: "office/fix-5", sha: "sha5bbbb" },
        updated_at: recent(1000),
      }),
      repository,
    });
    expect(board(f.alpha.operationId).pulls[0]?.checksState).toBe("none");
    await deliver("pull_request", {
      action: "closed",
      pull_request: pr({
        state: "closed",
        merged: true,
        merged_at: recent(2000),
        updated_at: recent(2000),
        head: { ref: "office/fix-5", sha: "sha5bbbb" },
      }),
      repository,
    });
    card = board(f.alpha.operationId).pulls[0];
    expect(card).toMatchObject({ state: "closed", merged: true, reviewState: "approved" });
    expect(f.events.map((e) => `${e.name}.${e.action}`)).toContain("pull_request.closed");
  });
});

describe("push, installation and loop protection", () => {
  test("push reaches the bus only; installation events resync", async () => {
    f = syncFixture();
    await deliver("push", {
      ref: "refs/heads/main",
      before: "a",
      after: "b",
      repository: { ...repository, pushed_at: Math.floor(Date.now() / 1000) },
      sender: human,
    });
    expect(f.published.size).toBe(0);
    expect(f.events[0]).toMatchObject({ name: "push", action: null, stale: false });
    await deliver("installation", { action: "created", installation: { id: 3 }, sender: human });
    expect(f.events[1]).toMatchObject({
      name: "installation",
      action: "created",
      installationId: 3,
    });
  });

  test("events caused by the office App are marked", async () => {
    f = syncFixture();
    const bot = { login: `${APP_SLUG}[bot]`, id: 9, type: "Bot" };
    await deliver("issue_comment", {
      action: "created",
      issue: fakeIssue(1),
      comment: { id: 1 },
      repository,
      sender: bot,
    });
    await deliver("issues", {
      action: "opened",
      issue: fakeIssue(2, { performed_via_github_app: { id: APP_ID } }),
      repository,
      sender: human,
    });
    await deliver("check_run", {
      action: "completed",
      check_run: {
        id: 1,
        app: { id: APP_ID },
        check_suite: { id: 5, head_sha: "x", status: "completed", conclusion: "success" },
      },
      repository,
      sender: human,
    });
    await deliver("issues", {
      action: "opened",
      issue: fakeIssue(3),
      repository,
      sender: { login: "dependabot[bot]", type: "Bot" },
    });
    expect(f.events.map((e) => e.fromOfficeApp)).toEqual([true, true, true, false]);
  });
});

describe("logs", () => {
  test("never carry the secret, tokens or payload contents", async () => {
    f = syncFixture();
    const secretish = "ghp_leakyTokenInABody0123456789";
    const payload = {
      action: "opened",
      issue: fakeIssue(9, { body: secretish, updated_at: recent() }),
      repository,
    };
    await deliver("issues", payload, { secret: "wrong" });
    await deliver("issues", payload);
    f.gh.state.failAll = true;
    await f.sync.pollNow();
    const text = f.logs.join("");
    expect(text).toContain("github webhook");
    expect(text).toContain("github board poll failed");
    for (const leak of [
      WEBHOOK_SECRET,
      secretish,
      "Something is broken",
      "ghs_fixtureInstallationToken",
    ]) {
      expect(text).not.toContain(leak);
    }
  });
});

describe("DeliveryLog", () => {
  test("claim, release after a failure, prune after the window", () => {
    f = syncFixture();
    let now = Date.now();
    const log = new DeliveryLog(f.db, () => now);
    expect(log.claim("delivery-1", "issues")).toBe(true);
    expect(log.claim("delivery-1", "issues")).toBe(false);
    log.release("delivery-1");
    expect(log.claim("delivery-1", "issues")).toBe(true);
    now += 8 * 24 * 3600_000;
    log.prune();
    expect(log.claim("delivery-1", "issues")).toBe(true);
  });
});
