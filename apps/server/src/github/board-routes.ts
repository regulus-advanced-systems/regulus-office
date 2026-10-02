/**
 * REST for the issue and PR board panel (SPEC §9.4, D7; #36). Shapes and
 * paths are in `@regulus/protocol` boards-api.ts.
 *
 * - Reading a card needs `view` on its operation; the body comes from the #35
 *   cache, comments are read live.
 * - Writing (comment, assign, merge, close) needs operation `manage` (office
 *   owners and admins have it everywhere) and a same-origin request. Each
 *   write is audited (`github.board_*`, no comment text) and made with the
 *   operation repo's office credential: the App installation token narrowed to
 *   the repo, else the org PAT (#141). An operation repo's own stored PAT and any
 *   human's personal token are never used; without an office credential the
 *   write is refused with `office_credential_missing`.
 * - Posted comments end with a footer naming the human, "via Regulus Office".
 * - After a write the card is re-read from GitHub into the cache and the
 *   board is republished, so every viewer sees the change without waiting
 *   for the webhook or the next poll.
 *
 * An operation the caller cannot see, or a card that is not on it, answers 404.
 */
import {
  BOARDS_API_PATH,
  BoardAssignRequest,
  type BoardCardDetail,
  BoardCommentRequest,
  BoardMergeRequest,
  CARD_KINDS,
  type CardKind,
  type ChecksState,
  mayWriteBoard,
  type ReviewState,
} from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, type AuditAction, writeAudit } from "../auth/audit.ts";
import type { OfficeAuth, SessionUser } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import { githubIssues, githubPulls, operationRepos } from "../db/schema/index.ts";
import { readJsonBody } from "../http/body.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import { operationAccessFor } from "../operations/access.ts";
import { type BoardGitHub, officeCommentBody, type RepoName } from "./board-actions.ts";
import type { BoardCache } from "./board-cache.ts";
import { normalizeIssue, normalizePull } from "./board-normalize.ts";
import { GitHubApiError } from "./pulls.ts";

export interface BoardRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  db: Db;
  /** The office credential for a repo: `GitHubConnection.tokenFor` (never a repo or personal PAT). */
  officeToken(owner: string, name: string): Promise<string | null>;
  github: BoardGitHub;
  /** The #35 cache and board publisher (`GitHubSync`). */
  sync: { cache: BoardCache; publish(operationIds: readonly string[]): void };
  logger: Logger;
  /** A PR was merged from the board: ring the merge gong now (#43). */
  onMerged?(pull: { repoIds: readonly string[]; number: number; title?: string }): void;
}

interface Target {
  operationId: string;
  kind: CardKind;
  repoId: string;
  repo: RepoName;
  number: number;
}

type CardRow = typeof githubIssues.$inferSelect & Partial<typeof githubPulls.$inferSelect>;

const rawOf = (text: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(text) as unknown;
    return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const list = (text: string): string[] => {
  const v = (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return [];
    }
  })();
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function mountBoardRoutes(router: Router, deps: BoardRoutesDeps): void {
  const { auth, db, github, sync, logger } = deps;
  const base = `${BOARDS_API_PATH}/:operationId/:kind/:repoId/:number`;

  const session = async (request: Request): Promise<SessionUser> => {
    const user = await auth.getSessionFromRequest(request);
    if (!user) throw unauthorized();
    return user;
  };
  const sameOrigin = (request: Request) => {
    const check = checkOrigin(request, auth.publicUrl, { allowedOrigins: auth.allowedOrigins });
    if (!check.ok) throw forbidden("origin_mismatch");
  };
  const notFound = () => new AuthHttpError(404, "card_not_found");

  /** The operation repo `repoId` on `operationId`, if the user may see the operation. */
  const operationRepo = (user: SessionUser, operationId: string, repoId: string) => {
    const access = operationAccessFor(db, { id: user.id, role: user.role }, operationId);
    if (!access) throw notFound();
    const repo = db
      .select({ owner: operationRepos.owner, name: operationRepos.name })
      .from(operationRepos)
      .where(and(eq(operationRepos.id, repoId), eq(operationRepos.operationId, operationId)))
      .get();
    if (!repo) throw notFound();
    return { access, repo };
  };

  const cardRow = (t: Target): CardRow | undefined => {
    const table = t.kind === "pr" ? githubPulls : githubIssues;
    return db
      .select()
      .from(table)
      .where(and(eq(table.repoId, t.repoId), eq(table.number, t.number)))
      .get() as CardRow | undefined;
  };

  const target = (ctx: RouteContext, user: SessionUser) => {
    const { operationId = "", kind = "", repoId = "" } = ctx.params;
    const number = Number(ctx.params.number);
    if (!(CARD_KINDS as readonly string[]).includes(kind)) throw notFound();
    if (!Number.isInteger(number) || number <= 0) throw notFound();
    const { access, repo } = operationRepo(user, operationId, repoId);
    const t: Target = { operationId, kind: kind as CardKind, repoId, repo, number };
    const row = cardRow(t);
    if (!row) throw notFound();
    return { t, row, access };
  };

  const tokenFor = async (repo: RepoName): Promise<string | null> => {
    try {
      return await deps.officeToken(repo.owner, repo.name);
    } catch (err) {
      logger.warn({ err, repo: `${repo.owner}/${repo.name}` }, "office GitHub credential failed");
      return null;
    }
  };

  const githubFailure = (err: unknown): AuthHttpError => {
    if (err instanceof GitHubApiError && err.status >= 400 && err.status < 500) {
      return new AuthHttpError(err.status === 404 ? 404 : 409, "github_rejected", {
        detail: err.detail,
      });
    }
    const detail = err instanceof GitHubApiError ? err.detail : "unexpected error";
    return new AuthHttpError(502, "github_unavailable", { detail });
  };

  const handle =
    (fn: (ctx: RouteContext, user: SessionUser) => Promise<Response>, write = false) =>
    async (ctx: RouteContext) => {
      try {
        if (write) sameOrigin(ctx.request);
        return await fn(ctx, await session(ctx.request));
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };

  /** Re-read the card from GitHub into the cache and republish its operations' boards. */
  const refresh = async (token: string, t: Target) => {
    try {
      const raw = await github.fetch(token, t.repo, t.kind, t.number);
      const followed = sync.cache.follow(t.repo.owner, t.repo.name);
      if (!followed) return;
      if (t.kind === "pr") {
        const fields = normalizePull(raw);
        if (fields) sync.cache.upsertPull(followed.repoIds, fields);
      } else {
        const fields = normalizeIssue(raw);
        if (fields) sync.cache.upsertIssue(followed.repoIds, fields);
      }
      sync.publish(followed.operationIds);
    } catch (err) {
      // The webhook or the next poll catches up.
      logger.warn({ err, repo: `${t.repo.owner}/${t.repo.name}` }, "board refresh failed");
    }
  };

  /** Shared checks for a write: manage, a valid body, then an office credential. */
  const writer = async <B>(
    ctx: RouteContext,
    user: SessionUser,
    parse: (request: Request) => Promise<B>,
  ) => {
    const found = target(ctx, user);
    if (!mayWriteBoard(found.access)) throw forbidden("manage_required");
    const body = await parse(ctx.request);
    const token = await tokenFor(found.t.repo);
    if (!token) throw new AuthHttpError(409, "office_credential_missing");
    return { ...found, body, token };
  };
  const noBody = async () => ({});

  const audit = (
    user: SessionUser,
    action: AuditAction,
    t: Target,
    meta: Record<string, unknown> = {},
  ) =>
    writeAudit(db, {
      userId: user.id,
      action,
      targetKind: "github_card",
      targetId: `${t.repoId}#${t.number}`,
      meta: {
        operationId: t.operationId,
        kind: t.kind,
        repo: `${t.repo.owner}/${t.repo.name}`,
        number: t.number,
        ...meta,
      },
    });

  router.get(
    base,
    handle(async (ctx, user) => {
      const { t, row, access } = target(ctx, user);
      const raw = rawOf(row.raw);
      const token = await tokenFor(t.repo);
      let comments: BoardCardDetail["comments"] = [];
      let commentsError: string | null = null;
      if (!token) commentsError = "No office GitHub connection covers this repo.";
      else {
        try {
          comments = await github.comments(token, t.repo, t.number);
        } catch (err) {
          commentsError =
            err instanceof GitHubApiError ? `GitHub: ${err.detail}` : "GitHub is unreachable.";
        }
      }
      const detail: BoardCardDetail = {
        kind: t.kind,
        repoId: t.repoId,
        repo: `${t.repo.owner}/${t.repo.name}`,
        number: t.number,
        title: row.title.slice(0, 300),
        state: row.state.slice(0, 16),
        merged: raw.merged === true,
        draft: row.isDraft === true,
        author: text(raw.author, 64),
        labels: list(row.labelsJson),
        assignees: list(row.assigneesJson),
        url: text(raw.htmlUrl, 512),
        bodyMd: row.bodyMd ?? "",
        updatedAt: row.ghUpdatedAt.getTime(),
        headBranch: (row.headRef ?? "").slice(0, 200),
        baseBranch: (row.baseRef ?? "").slice(0, 200),
        checksState: (row.checksState ?? "none") as ChecksState,
        reviewState: (row.reviewState ?? "none") as ReviewState,
        comments,
        commentsError,
        canWrite: mayWriteBoard(access),
        credential: token !== null,
      };
      return json(detail, { headers: { "cache-control": "no-store" } });
    }),
  );

  router.get(
    `${BOARDS_API_PATH}/:operationId/:repoId/assignees`,
    handle(async (ctx, user) => {
      const { repo } = operationRepo(user, ctx.params.operationId ?? "", ctx.params.repoId ?? "");
      const token = await tokenFor(repo);
      if (!token) throw new AuthHttpError(409, "office_credential_missing");
      try {
        return json({ logins: await github.assignees(token, repo) });
      } catch (err) {
        throw githubFailure(err);
      }
    }),
  );

  router.post(
    `${base}/comment`,
    handle(async (ctx, user) => {
      const {
        t,
        token,
        body: request,
      } = await writer(ctx, user, (r) => readJsonBody(r, BoardCommentRequest));
      const body = request.body;
      try {
        const comment = await github.comment(
          token,
          t.repo,
          t.number,
          officeCommentBody(body, user.displayName),
        );
        audit(user, AUDIT_ACTIONS.githubBoardComment, t, {
          commentId: comment.id,
          length: body.length,
        });
        return json(comment, { status: 201 });
      } catch (err) {
        throw githubFailure(err);
      }
    }, true),
  );

  router.post(
    `${base}/assign`,
    handle(async (ctx, user) => {
      const {
        t,
        token,
        body: change,
      } = await writer(ctx, user, (r) => readJsonBody(r, BoardAssignRequest));
      try {
        await github.assign(token, t.repo, t.number, change);
      } catch (err) {
        throw githubFailure(err);
      }
      audit(user, AUDIT_ACTIONS.githubBoardAssign, t, { add: change.add, remove: change.remove });
      await refresh(token, t);
      return new Response(null, { status: 204 });
    }, true),
  );

  router.post(
    `${base}/merge`,
    handle(async (ctx, user) => {
      if (ctx.params.kind !== "pr") throw new AuthHttpError(400, "not_a_pull_request");
      const { t, token, row, body } = await writer(ctx, user, (r) =>
        readJsonBody(r, BoardMergeRequest),
      );
      const method = body.method;
      if (row.state !== "open") {
        throw new AuthHttpError(409, "github_rejected", {
          detail: "This pull request is not open.",
        });
      }
      let merged: { merged: boolean; sha: string | null };
      try {
        merged = await github.merge(token, t.repo, t.number, method);
      } catch (err) {
        throw githubFailure(err);
      }
      audit(user, AUDIT_ACTIONS.githubBoardMerge, t, { method, sha: merged.sha });
      await refresh(token, t);
      if (merged.merged) {
        try {
          const followed = sync.cache.follow(t.repo.owner, t.repo.name);
          deps.onMerged?.({ repoIds: followed?.repoIds ?? [t.repoId], number: t.number });
        } catch (err) {
          logger.warn({ err }, "merge gong failed");
        }
      }
      return json(merged);
    }, true),
  );

  router.post(
    `${base}/close`,
    handle(async (ctx, user) => {
      const { t, token } = await writer(ctx, user, noBody);
      try {
        await github.close(token, t.repo, t.kind, t.number);
      } catch (err) {
        throw githubFailure(err);
      }
      audit(user, AUDIT_ACTIONS.githubBoardClose, t);
      await refresh(token, t);
      return new Response(null, { status: 204 });
    }, true),
  );
}
