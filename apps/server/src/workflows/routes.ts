/**
 * REST for GitHub workflows (#155).
 *
 *   GET    /api/workflows?operationId=               list (operation view)
 *   POST   /api/workflows                        create (admin or operation manage)
 *   PATCH  /api/workflows/:id                    replace the definition (same)
 *   DELETE /api/workflows/:id                    (same)
 *   POST   /api/workflows/:id/dry-run            {eventId, workflow?} (same)
 *   GET    /api/workflows/events?operationId=        recent events for dry runs (operation view)
 *   GET    /api/workflows/runs?operationId=&workflowId=  run history (operation view)
 *   GET    /api/workflows/runs/:id               one run with its log (operation view)
 *   POST   /api/workflows/runs/:id/cancel        (admin or operation manage)
 *
 * Only office owners/admins may turn approve on (an operation manager may keep or
 * turn off what an admin set). `fix` cannot be turned on yet. Writes need a
 * same-origin request and are audited.
 */
import {
  CreateWorkflowRequest,
  type OperationAccess,
  WORKFLOW_EVENTS_API_PATH,
  WORKFLOW_PROVIDERS,
  WORKFLOW_RUNS_API_PATH,
  WORKFLOWS_API_PATH,
  WorkflowDryRunRequest,
  WorkflowInput,
  type WorkflowListResponse,
  type WorkflowSpec,
} from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import type { GitHubConnection } from "../github/connection.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import { isOfficeManager, type OperationActor, operationAccessFor } from "../operations/access.ts";
import { readBody } from "../operations/routes.ts";
import { CronError, parseCron } from "./cron.ts";
import { dryRun } from "./dry-run.ts";
import type { WorkflowEngine } from "./engine.ts";
import type { EventLog } from "./event-log.ts";
import { hasOfficeKey } from "./office-key.ts";
import type { RunStore } from "./runs.ts";
import { type StoredWorkflow, toView, type WorkflowStore } from "./store.ts";

export interface WorkflowRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  db: Db;
  store: WorkflowStore;
  runs: RunStore;
  events: EventLog;
  engine: Pick<WorkflowEngine, "cancel">;
  repos: Pick<RepoAccess, "listOperationRepos">;
  connection: Pick<GitHubConnection, "app">;
  now?: () => number;
}

const RANK: Record<OperationAccess, number> = { view: 0, spawn: 1, manage: 2 };

export function mountWorkflowRoutes(router: Router, deps: WorkflowRoutesDeps): void {
  const { auth, db, store, runs, events } = deps;
  const now = deps.now ?? Date.now;

  const handle =
    (
      fn: (ctx: RouteContext, actor: OperationActor) => Promise<Response> | Response,
      write = false,
    ) =>
    async (ctx: RouteContext) => {
      try {
        if (write) {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw forbidden("origin_mismatch");
        }
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        return await fn(ctx, { id: user.id, role: user.role });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };

  /** The actor's access to the operation, at least `need`; 404 for operations they cannot see. */
  const require = (
    actor: OperationActor,
    operationId: string,
    need: OperationAccess,
  ): OperationAccess => {
    const access = operationAccessFor(db, actor, operationId);
    if (!access) throw new AuthHttpError(404, "operation_not_found");
    if (RANK[access] < RANK[need]) throw forbidden("operation_manage_required");
    return access;
  };
  const workflowFor = (
    actor: OperationActor,
    id: string,
    need: OperationAccess,
  ): StoredWorkflow => {
    const wf = store.get(id);
    if (!wf || !operationAccessFor(db, actor, wf.operationId))
      throw new AuthHttpError(404, "not_found");
    require(actor, wf.operationId, need);
    return wf;
  };
  const operationParam = (ctx: RouteContext): string => {
    const id = ctx.url.searchParams.get("operationId") ?? "";
    if (!id || id.length > 128) throw new AuthHttpError(400, "operation_id_required");
    return id;
  };

  /** Rules the schema cannot express. */
  const validate = (
    actor: OperationActor,
    operationId: string,
    spec: WorkflowSpec,
    previous?: StoredWorkflow,
  ) => {
    if (spec.actions.fix.enabled) throw new AuthHttpError(400, "fix_not_available");
    const hadApprove = previous?.spec.actions.approve.enabled ?? false;
    if (spec.actions.approve.enabled && !hadApprove && !isOfficeManager(actor.role)) {
      throw forbidden("approve_needs_admin");
    }
    if (spec.trigger.kind === "schedule") {
      try {
        parseCron(spec.trigger.cron);
      } catch (err) {
        throw new AuthHttpError(400, "invalid_cron", {
          detail: err instanceof CronError ? err.message : "invalid",
        });
      }
    }
    const repoIds = new Set(deps.repos.listOperationRepos(operationId).map((r) => r.repoId));
    if (spec.filters.repoIds.some((id) => !repoIds.has(id))) {
      throw new AuthHttpError(400, "unknown_repo");
    }
  };
  const audit = (
    actor: OperationActor,
    action: "create" | "update" | "delete",
    wf: StoredWorkflow,
  ) =>
    writeAudit(db, {
      userId: actor.id,
      action:
        action === "create"
          ? AUDIT_ACTIONS.workflowCreate
          : action === "update"
            ? AUDIT_ACTIONS.workflowUpdate
            : AUDIT_ACTIONS.workflowDelete,
      targetKind: "workflow",
      targetId: wf.id,
      meta: {
        operationId: wf.operationId,
        name: wf.spec.name,
        enabled: wf.spec.enabled,
        trigger: wf.spec.trigger.kind,
        actions: Object.entries(wf.spec.actions)
          .filter(([, v]) => v.enabled)
          .map(([k]) => k),
      },
    });
  const view = (wf: StoredWorkflow) => toView(wf, runs.today(wf.id, now()));

  router.get(
    WORKFLOWS_API_PATH,
    handle((ctx, actor) => {
      const operationId = operationParam(ctx);
      const access = require(actor, operationId, "view");
      const list = store.listForOperation(operationId);
      const missing: string[] = [];
      if (!deps.connection.app()) missing.push("github_app");
      for (const provider of WORKFLOW_PROVIDERS) {
        if (
          list.some((w) => w.spec.henchman.provider === provider) &&
          !hasOfficeKey(db, provider)
        ) {
          missing.push(`office_key:${provider}`);
        }
      }
      const body: WorkflowListResponse = {
        workflows: list.map(view),
        canEdit: access === "manage",
        canApprove: isOfficeManager(actor.role),
        missing,
      };
      return json(body);
    }),
  );

  router.post(
    WORKFLOWS_API_PATH,
    handle(async (ctx, actor) => {
      const { operationId, ...spec } = await readBody(ctx.request, CreateWorkflowRequest);
      require(actor, operationId, "manage");
      validate(actor, operationId, spec);
      const wf = store.create(operationId, spec, actor.id);
      audit(actor, "create", wf);
      return json(view(wf), { status: 201 });
    }, true),
  );

  router.add(
    "PATCH",
    `${WORKFLOWS_API_PATH}/:id`,
    handle(async (ctx, actor) => {
      const previous = workflowFor(actor, ctx.params.id ?? "", "manage");
      const spec = await readBody(ctx.request, WorkflowInput);
      validate(actor, previous.operationId, spec, previous);
      const wf = store.update(previous.id, spec);
      if (!wf) throw new AuthHttpError(404, "not_found");
      audit(actor, "update", wf);
      return json(view(wf));
    }, true),
  );

  router.add(
    "DELETE",
    `${WORKFLOWS_API_PATH}/:id`,
    handle((ctx, actor) => {
      const wf = workflowFor(actor, ctx.params.id ?? "", "manage");
      store.delete(wf.id);
      audit(actor, "delete", wf);
      return new Response(null, { status: 204 });
    }, true),
  );

  router.post(
    `${WORKFLOWS_API_PATH}/:id/dry-run`,
    handle(async (ctx, actor) => {
      const wf = workflowFor(actor, ctx.params.id ?? "", "manage");
      const body = await readBody(ctx.request, WorkflowDryRunRequest);
      const event = events.get(body.eventId);
      if (!event || !event.view.operationIds.includes(wf.operationId)) {
        throw new AuthHttpError(404, "event_not_found");
      }
      return json(dryRun(body.workflow ?? wf.spec, wf.operationId, event.context));
    }, true),
  );

  router.get(
    WORKFLOW_EVENTS_API_PATH,
    handle((ctx, actor) => {
      const operationId = operationParam(ctx);
      require(actor, operationId, "view");
      return json({ events: events.listForOperation(operationId, 50) });
    }),
  );

  router.get(
    WORKFLOW_RUNS_API_PATH,
    handle((ctx, actor) => {
      const operationId = operationParam(ctx);
      require(actor, operationId, "view");
      const workflowId = ctx.url.searchParams.get("workflowId") ?? undefined;
      return json({ runs: runs.list({ operationId, workflowId, limit: 100 }) });
    }),
  );

  router.get(
    `${WORKFLOW_RUNS_API_PATH}/:id`,
    handle((ctx, actor) => {
      const run = runs.detail(ctx.params.id ?? "");
      if (!run || !operationAccessFor(db, actor, run.operationId))
        throw new AuthHttpError(404, "not_found");
      return json(run);
    }),
  );

  router.post(
    `${WORKFLOW_RUNS_API_PATH}/:id/cancel`,
    handle((ctx, actor) => {
      const run = runs.get(ctx.params.id ?? "");
      if (!run || !operationAccessFor(db, actor, run.operationId))
        throw new AuthHttpError(404, "not_found");
      require(actor, run.operationId, "manage");
      const cancelled = deps.engine.cancel(run.id);
      if (cancelled) {
        writeAudit(db, {
          userId: actor.id,
          action: AUDIT_ACTIONS.workflowRunCancel,
          targetKind: "workflow_run",
          targetId: run.id,
          meta: { workflowId: run.workflowId },
        });
      }
      return json({ cancelled });
    }, true),
  );
}
