/**
 * Board panel routes (#36) over a real server with sessions, against a fake
 * GitHub: who may read and write, the office credential, the comment footer,
 * the audit trail and the cache refresh after a write.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BoardCardDetail, boardAssigneesPath, boardCardPath } from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import { auditLog, githubIssues, githubPulls } from "../db/schema/index.ts";
import {
  type BoardRoutesFixture,
  boardRoutesFixture,
  HELLO,
  OPERATION,
  ORG_PAT,
  REPO_PAT,
  SECRET,
  SECRET_OPERATION,
} from "./board-routes.fixture.ts";

let f: BoardRoutesFixture;
beforeAll(async () => {
  f = await boardRoutesFixture();
});
afterAll(async () => {
  await f.stop();
});

const issue7 = (action?: "comment" | "assign" | "merge" | "close") =>
  boardCardPath(OPERATION, "issue", HELLO, 7, action);
const pull9 = (action?: "comment" | "assign" | "merge" | "close") =>
  boardCardPath(OPERATION, "pr", HELLO, 9, action);
const audits = () =>
  f.office.db
    .select()
    .from(auditLog)
    .all()
    .filter((a) => a.action.startsWith("github.board_"));

describe("reading a card", () => {
  test("anyone with view access gets body, comments and whether they may write", async () => {
    const res = await f.call("GET", issue7(), f.people.viewer.cookie);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as BoardCardDetail;
    expect(detail).toMatchObject({
      kind: "issue",
      repo: "octo/hello",
      number: 7,
      title: "Issue 7",
      state: "open",
      author: "olga",
      canWrite: false,
      credential: true,
      commentsError: null,
    });
    // The markdown goes out as written; the client renders it sanitised.
    expect(detail.bodyMd).toContain("<script>");
    expect(detail.comments).toEqual([
      expect.objectContaining({ id: 1, author: "olga", bodyMd: "Seen on **main** too." }),
    ]);
    const mine = (await (await f.call("GET", issue7(), f.people.manager.cookie)).json()) as {
      canWrite: boolean;
    };
    expect(mine.canWrite).toBe(true);
    const owner = (await (await f.call("GET", pull9(), f.people.owner.cookie)).json()) as {
      canWrite: boolean;
      headBranch: string;
    };
    expect(owner).toMatchObject({ canWrite: true, headBranch: "office/fix-9" });
  });

  test("signed out 401; strangers, unknown cards and other operations' repos 404", async () => {
    expect((await f.call("GET", issue7())).status).toBe(401);
    expect((await f.call("GET", issue7(), f.people.stranger.cookie)).status).toBe(404);
    // The office role reads no board: the admin's GitHub account cannot see the repo (#270).
    expect((await f.call("GET", issue7(), f.people.admin.cookie)).status).toBe(404);
    const people = await f.call("GET", boardAssigneesPath(OPERATION, HELLO), f.people.admin.cookie);
    expect(people.status).toBe(404);
    const missing = boardCardPath(OPERATION, "issue", HELLO, 404);
    expect((await f.call("GET", missing, f.people.viewer.cookie)).status).toBe(404);
    // #9 is a PR, not an issue.
    const wrongKind = boardCardPath(OPERATION, "issue", HELLO, 9);
    expect((await f.call("GET", wrongKind, f.people.viewer.cookie)).status).toBe(404);
    const elsewhere = boardCardPath("operation-other", "issue", HELLO, 7);
    expect((await f.call("GET", elsewhere, f.people.owner.cookie)).status).toBe(404);
  });

  test("without an office credential comments are not read (and no repo PAT is used)", async () => {
    const before = f.gh.calls.length;
    const res = await f.call(
      "GET",
      boardCardPath(SECRET_OPERATION, "issue", SECRET, 3),
      f.people.viewer.cookie,
    );
    const detail = (await res.json()) as BoardCardDetail;
    expect(detail).toMatchObject({ credential: false, comments: [] });
    expect(detail.commentsError).toContain("No office GitHub connection");
    const sent = f.gh.calls.slice(before);
    expect(sent.every((c) => !c.path.includes("/secret"))).toBe(true);
    expect(JSON.stringify(sent)).not.toContain(REPO_PAT);
  });

  test("the repo's assignable people", async () => {
    const res = await f.call("GET", boardAssigneesPath(OPERATION, HELLO), f.people.viewer.cookie);
    expect(await res.json()).toEqual({ logins: ["ada", "ben"] });
  });
});

describe("write access", () => {
  test("view and spawn access are refused before anything reaches GitHub", async () => {
    const before = f.boardCalls().length;
    for (const who of [f.people.viewer, f.people.spawner]) {
      for (const [path, body] of [
        [issue7("comment"), { body: "hi" }],
        [issue7("assign"), { add: ["ada"] }],
        [pull9("merge"), { method: "squash" }],
        [issue7("close"), {}],
      ] as const) {
        const res = await f.call("POST", path, who.cookie, body);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: string }).error).toBe("manage_required");
      }
    }
    expect((await f.call("POST", issue7("close"), f.people.stranger.cookie, {})).status).toBe(404);
    // Nor does it write one.
    expect((await f.call("POST", issue7("close"), f.people.admin.cookie, {})).status).toBe(404);
    expect((await f.call("POST", pull9("merge"), f.people.admin.cookie, {})).status).toBe(404);
    expect((await f.call("POST", issue7("close"), undefined, {})).status).toBe(401);
    expect(f.boardCalls().length).toBe(before);
    expect(audits()).toEqual([]);
  });

  test("a cross-origin write is refused", async () => {
    const res = await f.call(
      "POST",
      issue7("comment"),
      f.people.manager.cookie,
      { body: "hi" },
      "https://evil.example",
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("origin_mismatch");
  });

  test("a repo without an office credential cannot be written, even with its own PAT", async () => {
    const path = boardCardPath(SECRET_OPERATION, "issue", SECRET, 3, "comment");
    const res = await f.call("POST", path, f.people.manager.cookie, { body: "hello" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("office_credential_missing");
    expect(JSON.stringify(f.gh.calls)).not.toContain(REPO_PAT);
  });
});

describe("write actions (operation managers, office credential, audited)", () => {
  test("comment: the human is named, via Regulus Office; the text is not audited", async () => {
    const res = await f.call("POST", issue7("comment"), f.people.manager.cookie, {
      body: "  On it, @ada. **Soon**.  ",
    });
    expect(res.status).toBe(201);
    const posted = f.boardCalls().findLast((c) => c.method === "POST");
    expect(posted?.path).toBe("/repos/octo/hello/issues/7/comments");
    expect(posted?.authorization).toBe(`Bearer ${ORG_PAT}`);
    expect((posted?.body as { body: string }).body).toBe(
      "On it, @ada. **Soon**.\n\n---\n_Posted by Mia Manager via Regulus Office_",
    );
    const [entry] = audits();
    expect(entry).toMatchObject({
      userId: f.people.manager.id,
      action: "github.board_comment",
      targetKind: "github_card",
      targetId: `${HELLO}#7`,
    });
    expect(JSON.parse(entry?.metaJson ?? "{}")).toMatchObject({
      operationId: OPERATION,
      repo: "octo/hello",
      kind: "issue",
      number: 7,
    });
    expect(entry?.metaJson).not.toContain("On it");
  });

  test("assign and unassign update GitHub, the cache and the board", async () => {
    const published = f.published.length;
    let res = await f.call("POST", issue7("assign"), f.people.owner.cookie, { add: ["ada"] });
    expect(res.status).toBe(204);
    const cached = () =>
      f.office.db
        .select({ assignees: githubIssues.assigneesJson })
        .from(githubIssues)
        .where(and(eq(githubIssues.repoId, HELLO), eq(githubIssues.number, 7)))
        .get()?.assignees;
    expect(cached()).toBe('["ada"]');
    expect(f.published.slice(published)).toEqual([[OPERATION]]);
    res = await f.call("POST", issue7("assign"), f.people.manager.cookie, { remove: ["ada"] });
    expect(res.status).toBe(204);
    expect(cached()).toBe("[]");
    expect(
      f
        .boardCalls()
        .filter((c) => c.path.endsWith("/assignees") && c.method !== "GET")
        .map((c) => [c.method, c.body]),
    ).toEqual([
      ["POST", { assignees: ["ada"] }],
      ["DELETE", { assignees: ["ada"] }],
    ]);
    expect(audits().filter((a) => a.action === "github.board_assign")).toHaveLength(2);
    // A bad login never reaches GitHub.
    res = await f.call("POST", issue7("assign"), f.people.manager.cookie, { add: ["no such"] });
    expect(res.status).toBe(400);
  });

  test("merge: GitHub's refusal is shown; then a squash merge lands on the board", async () => {
    expect(
      (
        await f.call(
          "POST",
          boardCardPath(OPERATION, "issue", HELLO, 7, "merge"),
          f.people.manager.cookie,
          {
            method: "squash",
          },
        )
      ).status,
    ).toBe(400);
    expect(
      (await f.call("POST", pull9("merge"), f.people.manager.cookie, { method: "octopus" })).status,
    ).toBe(400);
    f.state.mergeRefusal = "Pull Request is not mergeable";
    let res = await f.call("POST", pull9("merge"), f.people.manager.cookie, { method: "squash" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "github_rejected",
      detail: "Pull Request is not mergeable",
    });
    expect(audits().filter((a) => a.action === "github.board_merge")).toEqual([]);
    expect(f.merged).toEqual([]);

    res = await f.call("POST", pull9("merge"), f.people.manager.cookie, { method: "squash" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true, sha: "mergesha" });
    const merge = f.boardCalls().findLast((c) => c.method === "PUT");
    expect(merge?.body).toEqual({ merge_method: "squash" });
    // The merge gong rings at once (#43), for every operation repo row of the repo.
    expect(f.merged).toEqual([{ repoIds: [HELLO], number: 9 }]);
    const row = f.office.db
      .select()
      .from(githubPulls)
      .where(and(eq(githubPulls.repoId, HELLO), eq(githubPulls.number, 9)))
      .get();
    expect(row?.state).toBe("closed");
    expect(JSON.parse(row?.raw ?? "{}").merged).toBe(true);
    const [entry] = audits().filter((a) => a.action === "github.board_merge");
    expect(JSON.parse(entry?.metaJson ?? "{}")).toMatchObject({
      method: "squash",
      sha: "mergesha",
    });
    // Merged is not open any more.
    res = await f.call("POST", pull9("merge"), f.people.manager.cookie, { method: "merge" });
    expect(res.status).toBe(409);
  });

  test("close an issue", async () => {
    const res = await f.call("POST", issue7("close"), f.people.manager.cookie, {});
    expect(res.status).toBe(204);
    const patch = f.boardCalls().findLast((c) => c.method === "PATCH");
    expect(patch).toMatchObject({ path: "/repos/octo/hello/issues/7", body: { state: "closed" } });
    const row = f.office.db
      .select({ state: githubIssues.state })
      .from(githubIssues)
      .where(and(eq(githubIssues.repoId, HELLO), eq(githubIssues.number, 7)))
      .get();
    expect(row?.state).toBe("closed");
    expect(audits().filter((a) => a.action === "github.board_close")).toHaveLength(1);
  });

  test("every GitHub call used the office credential, never a repo or personal token", () => {
    const calls = f.boardCalls();
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.every((c) => c.authorization === `Bearer ${ORG_PAT}`)).toBe(true);
    expect(JSON.stringify(f.office.db.select().from(auditLog).all())).not.toContain(ORG_PAT);
  });
});
