/**
 * HTTP endpoints for Claude Code's http hooks and the statusline forwarder
 * (issue #27; SPEC §7 Claude Code row, §8).
 *
 *   POST /api/agents/:agentId/hooks/claude   hook JSON body (any hook event)
 *   POST /api/agents/:agentId/statusline     statusline JSON body
 *
 * Both authenticate with the agent's bearer token (constant-time check in
 * `tokens.verify`), cap the body size, map the payload through
 * `ClaudeCodeAdapter.ingest` and publish the resulting events into the
 * `AgentEventSink` behind schema validation.
 *
 * A `PermissionRequest` hook is held open (up to the adapter's
 * `permissionHoldSeconds`) until the office answers through
 * `AgentControl.respondPermission`; the decision goes back to Claude Code as
 * the documented hook response body. Without an answer the response is an
 * empty 2xx and Claude Code's own dialog decides.
 *
 * Logging: request logs carry the route pattern only (#90), the token is in a
 * header that is never logged, and bodies are never logged.
 */
import {
  ClaudeCodeAdapter,
  hookEventName,
  permissionHookResponse,
  permissionSuggestions,
  type RunnerContext,
  type RunnerOps,
} from "@regulus/agent-adapters";
import type { AgentEvent } from "@regulus/protocol";
import { json, type RouteContext, type Router } from "../../http/router.ts";
import { type AgentEventSink, validatingSink } from "../events.ts";
import { readJsonBody } from "./body.ts";
import { type AgentTokenVerifier, bearerToken } from "./tokens.ts";

export const CLAUDE_HOOK_ROUTE = "/api/agents/:agentId/hooks/claude";
export const CLAUDE_STATUSLINE_ROUTE = "/api/agents/:agentId/statusline";

/** Hook bodies carry tool input (e.g. a whole file for Write), so allow 1 MiB. */
export const DEFAULT_HOOK_BODY_LIMIT = 1024 * 1024;
export const DEFAULT_STATUSLINE_BODY_LIMIT = 64 * 1024;

/** Hook events that end a turn; any held permission request is stale after them. */
const TURN_BOUNDARIES = new Set(["UserPromptSubmit", "Stop", "StopFailure", "SessionEnd"]);

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface WarnLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface ClaudeHookRouteOptions {
  sink: AgentEventSink;
  tokens: AgentTokenVerifier;
  /**
   * The adapter instance registered for `claude-code`: its permission broker
   * is what `respondPermission` resolves, so it must be the same object.
   */
  adapter?: ClaudeCodeAdapter;
  /** Runner context of an agent's owner; a hook-only context is used otherwise. */
  contextFor?: (agentId: string) => RunnerContext | undefined;
  logger?: WarnLogger;
  hookBodyLimit?: number;
  statuslineBodyLimit?: number;
  now?: () => number;
}

export interface ClaudeHookRoutes {
  adapter: ClaudeCodeAdapter;
}

export function mountClaudeHookRoutes(
  router: Router,
  options: ClaudeHookRouteOptions,
): ClaudeHookRoutes {
  const adapter = options.adapter ?? new ClaudeCodeAdapter();
  const now = options.now ?? Date.now;
  const sink = validatingSink(options.sink, (agentId, issues) =>
    options.logger?.warn({ agentId, issues }, "dropped invalid claude hook event"),
  );
  const contextFor = (agentId: string): RunnerContext =>
    options.contextFor?.(agentId) ?? hookOnlyContext(now);

  const authenticate = (ctx: RouteContext): string | Response => {
    const agentId = ctx.params.agentId ?? "";
    if (!AGENT_ID.test(agentId)) return json({ error: "not_found" }, { status: 404 });
    const token = bearerToken(ctx.request);
    if (!token || !options.tokens.verify(agentId, token)) {
      return json(
        { error: "unauthorized" },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }
    return agentId;
  };

  const publishAll = async (agentId: string, events: AgentEvent[]) => {
    for (const event of events) await sink.publish(agentId, event);
  };

  router.post(CLAUDE_HOOK_ROUTE, async (ctx) => {
    const agentId = authenticate(ctx);
    if (agentId instanceof Response) return agentId;
    const body = await readJsonBody(ctx.request, options.hookBodyLimit ?? DEFAULT_HOOK_BODY_LIMIT);
    if (!body.ok) return json({ error: body.error }, { status: body.status });

    const eventName = hookEventName(body.value);
    if (eventName && TURN_BOUNDARIES.has(eventName)) adapter.permissions.cancelAgent(agentId);
    const events = adapter.ingest(
      { channel: "hook", agentId, payload: body.value },
      contextFor(agentId),
    );
    await publishAll(agentId, events);

    const request = events.find((e) => e.kind === "permission_request");
    if (eventName !== "PermissionRequest" || !request) return new Response(null, { status: 204 });

    // Hold the hook open for an office decision (see permissions.ts).
    const holdSeconds = adapter.permissionHoldSeconds;
    ctx.server?.timeout(ctx.request, holdSeconds + 10);
    const decision = await adapter.permissions.wait(
      agentId,
      request.requestId,
      permissionSuggestions(body.value),
      holdSeconds * 1000,
      ctx.request.signal,
    );
    if (!decision) return new Response(null, { status: 204 });
    return json(permissionHookResponse(decision, permissionSuggestions(body.value)));
  });

  router.post(CLAUDE_STATUSLINE_ROUTE, async (ctx) => {
    const agentId = authenticate(ctx);
    if (agentId instanceof Response) return agentId;
    const limit = options.statuslineBodyLimit ?? DEFAULT_STATUSLINE_BODY_LIMIT;
    const body = await readJsonBody(ctx.request, limit);
    if (!body.ok) return json({ error: body.error }, { status: body.status });
    const events = adapter.ingest(
      { channel: "statusline", agentId, payload: body.value },
      contextFor(agentId),
    );
    await publishAll(agentId, events);
    return new Response(null, { status: 204 });
  });

  return { adapter };
}

/**
 * Context for mapping payloads when the caller has no runner context: only
 * `now` is used by `ingest`; runner operations are refused.
 */
function hookOnlyContext(now: () => number): RunnerContext {
  const refuse = async (): Promise<never> => {
    throw new Error("runner operations are not available while ingesting hooks");
  };
  const runner: RunnerOps = {
    sendKeys: refuse,
    capturePane: refuse,
    paneTitle: refuse,
    spawnPiped: refuse,
    readTextFile: refuse,
    listDir: refuse,
  };
  return { backend: "linux-user", userId: "", home: "", officeUrl: "", runner, now };
}
