/**
 * REST for GitHub workflows (#155).
 *
 *   GET    /api/workflows?floorId=               list (floor view)
 *   POST   /api/workflows                        create (admin or floor manage)
 *   PATCH  /api/workflows/:id                    replace the definition (same)
 *   DELETE /api/workflows/:id                    (same)
 *   POST   /api/workflows/:id/dry-run            {eventId, workflow?} (same)
 *   GET    /api/workflows/events?floorId=        recent events for dry runs (floor view)
 *   GET    /api/workflows/runs?floorId=&workflowId=  run history (floor view)
 *   GET    /api/workflows/runs/:id               one run with its log (floor view)
 *   POST   /api/workflows/runs/:id/cancel        (admin or floor manage)
 *
 * Only office owners/admins may turn approve on (a floor manager may keep or
 * turn off what an admin set). `fix` cannot be turned on yet. Writes need a
 * same-origin request and are audited.
 */
import {
  CreateWorkflowRequest,
  type FloorAccess,
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
import { type FloorActor, floorAccessFor, isOfficeManager } from "../floors/access.ts";
import { readBody } from "../floors/routes.ts";
import type { GitHubConnection } from "../github/connection.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
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
  repos: Pick<RepoAccess, "listFloorRepos">;
  connection: Pick<GitHubConnection, "app">;
  now?: () => number;
}

const RANK: Record<FloorAccess, number> = { view: 0, spawn: 1, manage: 2 };

export function mountWorkflowRoutes(router: Router, deps: WorkflowRoutesDeps): void {
  const { auth, db, store, runs, events } = deps;
  const now = deps.now ?? Date.now;

  const handle =
    (fn: (ctx: RouteContext, actor: FloorActor) => Promise<Response> | Response, write = false) =>
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

  /** The actor's access to the floor, at least `need`; 404 for floors they cannot see. */
  const require = (actor: FloorActor, floorId: string, need: FloorAccess): FloorAccess => {
    const access = floorAccessFor(db, actor, floorId);
    if (!access) throw new AuthHttpError(404, "floor_not_found");
    if (RANK[access] < RANK[need]) throw forbidden("floor_manage_required");
    return access;
  };
  const workflowFor = (actor: FloorActor, id: string, need: FloorAccess): StoredWorkflow => {
    const wf = store.get(id);
    if (!wf || !floorAccessFor(db, actor, wf.floorId)) throw new AuthHttpError(404, "not_found");
    require(actor, wf.floorId, need);
    return wf;
  };
  const floorParam = (ctx: RouteContext): string => {
    const id = ctx.url.searchParams.get("floorId") ?? "";
    if (!id || id.length > 128) throw new AuthHttpError(400, "floor_id_required");
    return id;
  };

  /** Rules the schema cannot express. */
  const validate = (
    actor: FloorActor,
    floorId: string,
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
    const repoIds = new Set(deps.repos.listFloorRepos(floorId).map((r) => r.repoId));
    if (spec.filters.repoIds.some((id) => !repoIds.has(id))) {
      throw new AuthHttpError(400, "unknown_repo");
    }
  };
  const audit = (actor: FloorActor, action: "create" | "update" | "delete", wf: StoredWorkflow) =>
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
        floorId: wf.floorId,
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
      const floorId = floorParam(ctx);
      const access = require(actor, floorId, "view");
      const list = store.listForFloor(floorId);
      const missing: string[] = [];
      if (!deps.connection.app()) missing.push("github_app");
      for (const provider of WORKFLOW_PROVIDERS) {
        if (list.some((w) => w.spec.robot.provider === provider) && !hasOfficeKey(db, provider)) {
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
      const { floorId, ...spec } = await readBody(ctx.request, CreateWorkflowRequest);
      require(actor, floorId, "manage");
      validate(actor, floorId, spec);
      const wf = store.create(floorId, spec, actor.id);
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
      validate(actor, previous.floorId, spec, previous);
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
      if (!event || !event.view.floorIds.includes(wf.floorId)) {
        throw new AuthHttpError(404, "event_not_found");
      }
      return json(dryRun(body.workflow ?? wf.spec, wf.floorId, event.context));
    }, true),
  );

  router.get(
    WORKFLOW_EVENTS_API_PATH,
    handle((ctx, actor) => {
      const floorId = floorParam(ctx);
      require(actor, floorId, "view");
      return json({ events: events.listForFloor(floorId, 50) });
    }),
  );

  router.get(
    WORKFLOW_RUNS_API_PATH,
    handle((ctx, actor) => {
      const floorId = floorParam(ctx);
      require(actor, floorId, "view");
      const workflowId = ctx.url.searchParams.get("workflowId") ?? undefined;
      return json({ runs: runs.list({ floorId, workflowId, limit: 100 }) });
    }),
  );

  router.get(
    `${WORKFLOW_RUNS_API_PATH}/:id`,
    handle((ctx, actor) => {
      const run = runs.detail(ctx.params.id ?? "");
      if (!run || !floorAccessFor(db, actor, run.floorId))
        throw new AuthHttpError(404, "not_found");
      return json(run);
    }),
  );

  router.post(
    `${WORKFLOW_RUNS_API_PATH}/:id/cancel`,
    handle((ctx, actor) => {
      const run = runs.get(ctx.params.id ?? "");
      if (!run || !floorAccessFor(db, actor, run.floorId))
        throw new AuthHttpError(404, "not_found");
      require(actor, run.floorId, "manage");
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
