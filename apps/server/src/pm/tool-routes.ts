/**
 * The office tools as REST (SPEC §10 M5; #135, #271), for engines without
 * MCP (Hermes tools calling the office, #57):
 *
 *   GET  /api/agent-tools          the tools the agent's preset includes, with JSON Schemas
 *   POST /api/agent-tools/:name    run one; the body is the tool's input
 *
 * `Authorization: Bearer <agent token>`, the same token as `/mcp`, and the
 * same authorisation and audit (tools/call.ts). No session cookie is read.
 */
import {
  OFFICE_AGENT_TOOLS_API_PATH,
  type OfficeToolError,
  type OfficeToolResult,
} from "@regulus/protocol";
import { AuthHttpError } from "../auth/errors.ts";
import { readJsonValue } from "../http/body.ts";
import { json, type Router } from "../http/router.ts";
import {
  type AgentAuthDeps,
  agentFromRequest,
  callerFromRequest,
  unauthorizedAgent,
} from "./mcp.ts";
import type { OfficeTools } from "./tools/call.ts";

const STATUS: Readonly<Record<OfficeToolError, number>> = {
  unknown_tool: 404,
  invalid_input: 400,
  preset_forbids: 403,
  not_found: 404,
  forbidden: 403,
  on_behalf_required: 403,
  not_waiting: 403,
  cap_reached: 429,
  secret_rejected: 422,
  unavailable: 503,
  failed: 500,
};

export const statusOfToolResult = (result: OfficeToolResult): number =>
  result.ok ? 200 : STATUS[result.error];

export function mountToolRoutes(router: Router, deps: AgentAuthDeps & { tools: OfficeTools }) {
  router.get(OFFICE_AGENT_TOOLS_API_PATH, (ctx) => {
    const agent = agentFromRequest(deps, ctx.request);
    if (!agent) return unauthorizedAgent();
    return json({
      agent: { id: agent.id, name: agent.name, preset: agent.preset },
      tools: deps.tools.list(agent),
    });
  });

  router.post(`${OFFICE_AGENT_TOOLS_API_PATH}/:name`, async (ctx) => {
    const found = callerFromRequest(deps, ctx.request);
    if (!found) return unauthorizedAgent();
    const { agent, caller } = found;
    let input: unknown;
    try {
      input = await readJsonValue(ctx.request, { maxBytes: 256 * 1024 });
    } catch (err) {
      if (err instanceof AuthHttpError) return err.toResponse();
      throw err;
    }
    const result = await deps.tools.call(agent, ctx.params.name ?? "", input, "rest", caller);
    return json(result, { status: statusOfToolResult(result) });
  });
}
