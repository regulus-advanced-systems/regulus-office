/**
 * Browser client for GitHub workflows (#155): an operation's workflows, recent
 * events, dry runs and the run history. The server checks every call again
 * (admin or operation manage to edit; operation access to read).
 */
import {
  type CreateWorkflowRequest,
  WORKFLOW_EVENTS_API_PATH,
  WORKFLOW_RUNS_API_PATH,
  WORKFLOWS_API_PATH,
  WorkflowCancelResponse,
  WorkflowDryRunResult,
  WorkflowEventListResponse,
  type WorkflowInput,
  WorkflowListResponse,
  WorkflowRunDetail,
  WorkflowRunListResponse,
  WorkflowView,
  workflowDryRunPath,
  workflowPath,
  workflowRunCancelPath,
  workflowRunPath,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

const NO_CONTENT: Parser<void> = { safeParse: () => ({ success: true, data: undefined }) };

export function createWorkflowsApi(options: { fetch?: typeof fetch; baseUrl?: string } = {}) {
  const base = options.baseUrl ?? "";

  async function call<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const doFetch = options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: "network_error" };
    }
    let json: unknown = null;
    if (res.status !== 204) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const b = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      const out: ApiFailure = {
        ok: false,
        status: res.status,
        code: typeof b.error === "string" ? b.error.toLowerCase() : `http_${res.status}`,
      };
      if (Array.isArray(b.fields))
        out.reason = b.fields.filter((f) => typeof f === "string").join(", ");
      if (typeof b.detail === "string") out.reason = b.detail;
      return out;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }

  const q = (operationId: string) => `?operationId=${encodeURIComponent(operationId)}`;
  return {
    list: (operationId: string) =>
      call("GET", `${WORKFLOWS_API_PATH}${q(operationId)}`, WorkflowListResponse),
    create: (req: CreateWorkflowRequest) => call("POST", WORKFLOWS_API_PATH, WorkflowView, req),
    update: (id: string, input: WorkflowInput) =>
      call("PATCH", workflowPath(id), WorkflowView, input),
    remove: (id: string) => call("DELETE", workflowPath(id), NO_CONTENT),
    events: (operationId: string) =>
      call("GET", `${WORKFLOW_EVENTS_API_PATH}${q(operationId)}`, WorkflowEventListResponse),
    dryRun: (id: string, eventId: string, workflow?: WorkflowInput) =>
      call("POST", workflowDryRunPath(id), WorkflowDryRunResult, { eventId, workflow }),
    runs: (operationId: string, workflowId?: string) =>
      call(
        "GET",
        `${WORKFLOW_RUNS_API_PATH}${q(operationId)}${workflowId ? `&workflowId=${encodeURIComponent(workflowId)}` : ""}`,
        WorkflowRunListResponse,
      ),
    run: (id: string) => call("GET", workflowRunPath(id), WorkflowRunDetail),
    cancel: (id: string) => call("POST", workflowRunCancelPath(id), WorkflowCancelResponse),
  };
}

export type WorkflowsApi = ReturnType<typeof createWorkflowsApi>;

const MESSAGES: Record<string, string> = {
  approve_needs_admin: "Only an office owner or admin can let a workflow approve.",
  fix_not_available: "The fix action is not available yet.",
  invalid_cron: "The schedule is not a valid cron expression.",
  unknown_repo: "One of the chosen repos is not in this operation.",
  operation_manage_required: "You need Manage access to this operation to change its workflows.",
  invalid_body: "Some fields are not valid",
  event_not_found: "That event is no longer kept.",
  network_error: "The office cannot be reached.",
};

export function describeWorkflowError(f: ApiFailure): string {
  const base = MESSAGES[f.code] ?? `The office refused the request (${f.code}).`;
  return f.reason ? `${base}: ${f.reason}` : base;
}
