/**
 * Test fixture for the board panel routes (#36 tests only): a signed-in
 * office with one operation (repos `octo/hello`, covered by the office's org PAT,
 * and `octo/secret`, which only has its own stored repo PAT), people with each
 * operation access, the board cache seeded with issue #7 and PR #9, and a fake
 * GitHub that answers the board actions on 127.0.0.1 and records them.
 */
import { randomBytes } from "node:crypto";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { operationMembers, operationRepos, operations } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { createBoardGitHub } from "./board-actions.ts";
import { BoardCache } from "./board-cache.ts";
import { normalizeIssue, normalizePull } from "./board-normalize.ts";
import { mountBoardRoutes } from "./board-routes.ts";
import { startFakeGitHub } from "./fake-github.ts";
import { fakeIssue, fakePull } from "./fake-github-boards.ts";
import { createGitHubConnection } from "./setup.ts";

export const ORG_PAT = "github_pat_ORGboards_0123456789abcdefghijkl";
export const REPO_PAT = "github_pat_REPOsecret_0123456789abcdefghij";
export const OPERATION = "operation-apollo";
/** The room of the `secret` repo: one repo per operation (#268). */
export const SECRET_OPERATION = "operation-secret";
export const HELLO = "repo-hello";
export const SECRET = "repo-secret";

type Raw = Record<string, unknown>;

export async function boardRoutesFixture() {
  const now = () => new Date().toISOString();
  const state = {
    issue: fakeIssue(7, { body: "Steps:\n- [ ] fix <script>alert(1)</script>", assignees: [] }),
    pull: fakePull(9, { head: { ref: "office/fix-9", sha: "sha9" } }) as Raw,
    /** Set to make the next merge fail like GitHub does for an unmergeable PR. */
    mergeRefusal: null as string | null,
    comments: [
      {
        id: 1,
        user: { login: "olga" },
        body: "Seen on **main** too.",
        created_at: "2026-09-02T10:00:00Z",
        html_url: "https://github.com/octo/hello/issues/7#issuecomment-1",
      },
    ] as Raw[],
  };
  const bump = (o: Raw) => {
    o.updated_at = now();
  };

  const gh = startFakeGitHub({
    pats: { [ORG_PAT]: { login: "org-bot", repos: [{ owner: "octo", name: "hello" }] } },
    extra: (req, url, body) => {
      if (req.headers.get("authorization") !== `Bearer ${ORG_PAT}`) {
        return Response.json({ message: "Bad credentials" }, { status: 401 });
      }
      const m = /^\/repos\/octo\/hello\/(.+)$/.exec(url.pathname);
      if (!m) return undefined;
      const rest = m[1] ?? "";
      const b = (body ?? {}) as Raw;
      if (rest === "assignees") return Response.json([{ login: "ada" }, { login: "ben" }]);
      if (rest === "issues/7/comments" && req.method === "GET")
        return Response.json(state.comments);
      if (/^issues\/\d+\/comments$/.test(rest) && req.method === "POST") {
        const c = {
          id: 100 + state.comments.length,
          user: { login: "org-bot" },
          body: b.body,
          created_at: now(),
          html_url: "https://github.com/octo/hello/issues/7#issuecomment-100",
        };
        state.comments.push(c);
        return Response.json(c, { status: 201 });
      }
      const assign = /^issues\/(\d+)\/assignees$/.exec(rest);
      if (assign) {
        const target = assign[1] === "9" ? state.pull : state.issue;
        const logins = (b.assignees as string[]) ?? [];
        const current = ((target.assignees as { login: string }[]) ?? []).map((a) => a.login);
        const next =
          req.method === "DELETE"
            ? current.filter((l) => !logins.includes(l))
            : [...new Set([...current, ...logins])];
        target.assignees = next.map((login) => ({ login }));
        bump(target);
        return Response.json(target, { status: req.method === "POST" ? 201 : 200 });
      }
      if (rest === "pulls/9/merge" && req.method === "PUT") {
        if (state.mergeRefusal) {
          const message = state.mergeRefusal;
          state.mergeRefusal = null;
          return Response.json({ message }, { status: 405 });
        }
        Object.assign(state.pull, { state: "closed", merged: true, merged_at: now() });
        bump(state.pull);
        return Response.json({ merged: true, sha: "mergesha", message: "Pull Request merged" });
      }
      if (rest === "issues/7" || rest === "pulls/9") {
        const target = rest === "pulls/9" ? state.pull : state.issue;
        if (req.method === "PATCH") {
          Object.assign(target, { state: b.state });
          bump(target);
        }
        return Response.json(target);
      }
      return undefined;
    },
  });

  const office: Office = startOffice();
  const logger = createLogger({ level: "silent" });
  const github = createGitHubConnection({
    db: office.db,
    keyring: { current: 1, keys: { 1: randomBytes(32) } },
    config: {
      githubApiBase: gh.url,
      githubWebBase: "https://github.example",
      githubApp: undefined,
    },
    logger,
  });
  github.connection.store.savePat(ORG_PAT, "org-bot");

  const owner = await office.signUp("Olga");
  const manager = await office.signUp("Mia");
  office.db.$client.run(
    `update user_profiles set display_name = 'Mia Manager' where user_id = '${manager.id}'`,
  );
  const spawner = await office.signUp("Sam");
  const viewer = await office.signUp("Vic");
  const stranger = await office.signUp("Stan");

  const db = office.db;
  db.insert(operations)
    .values({
      id: OPERATION,
      name: "Apollo",
      slug: "apollo",
      index: 1,
      paletteId: "p",
      layoutTemplateId: "t",
    })
    .run();
  db.insert(operations)
    .values({
      id: "operation-other",
      name: "Other",
      slug: "other",
      index: 2,
      paletteId: "p",
      layoutTemplateId: "t",
    })
    .run();
  db.insert(operations)
    .values({
      id: SECRET_OPERATION,
      name: "Secret",
      slug: "secret",
      index: 3,
      paletteId: "p",
      layoutTemplateId: "t",
    })
    .run();
  for (const [id, name, credential, operationId] of [
    [HELLO, "hello", null, OPERATION],
    [SECRET, "secret", REPO_PAT, SECRET_OPERATION],
  ] as const) {
    db.insert(operationRepos)
      .values({
        id,
        operationId,
        owner: "octo",
        name,
        url: `https://github.com/octo/${name}`,
        workdir: `/tmp/rg36-none/${name}`,
        isPrimary: true,
        cloneStatus: "ready",
        // Not a real envelope: the routes must never even try the repo's own PAT.
        encryptedCredential: credential,
      })
      .run();
  }
  for (const [user, access] of [
    [manager, "manage"],
    [spawner, "spawn"],
    [viewer, "view"],
  ] as const) {
    for (const operationId of [OPERATION, SECRET_OPERATION])
      db.insert(operationMembers).values({ operationId, userId: user.id, access }).run();
  }

  const cache = new BoardCache(db);
  const issue = normalizeIssue(state.issue);
  const pull = normalizePull(state.pull);
  if (!issue || !pull) throw new Error("fixture cards do not normalize");
  cache.upsertIssue([HELLO], issue);
  cache.upsertPull([HELLO], pull);
  const secretIssue = normalizeIssue(fakeIssue(3));
  if (secretIssue) cache.upsertIssue([SECRET], secretIssue);

  const published: string[][] = [];
  const merged: { repoIds: readonly string[]; number: number }[] = [];
  mountBoardRoutes(office.server.router, {
    auth: office.auth,
    db,
    officeToken: (o, n) => github.connection.tokenFor(o, n),
    github: createBoardGitHub({ apiBase: gh.url }),
    sync: { cache, publish: (ids) => published.push([...ids]) },
    logger,
    onMerged: (pull) => merged.push(pull),
  });

  const call = (method: string, path: string, cookie?: string, body?: unknown, origin?: string) =>
    office.request(path, {
      method,
      cookie,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: origin ? { origin } : undefined,
    });

  return {
    office,
    gh,
    state,
    cache,
    published,
    /** Merges reported to the merge gong (#43). */
    merged,
    people: { owner, manager, spawner, viewer, stranger },
    call,
    /** GitHub calls other than the connection's own repo listing. */
    boardCalls: () => gh.calls.filter((c) => c.path.startsWith("/repos/")),
    async stop() {
      await office.stop();
      gh.stop();
    },
  };
}

export type BoardRoutesFixture = Awaited<ReturnType<typeof boardRoutesFixture>>;
