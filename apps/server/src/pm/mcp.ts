/**
 * The office MCP server (SPEC §10 M5, D3; #135, #271): streamable HTTP at
 * `/mcp`, authenticated with the agent's own bearer token.
 *
 * Transport (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports):
 * every client message is a `POST /mcp` with one JSON-RPC message (a batch is
 * accepted too); a request is answered with `application/json`, a
 * notification or response with `202`. The server is stateless: it issues no
 * session id, never streams and never calls the client, so `GET /mcp` (the
 * optional server-to-client stream) answers `405`.
 *
 * Methods: `initialize`, `ping`, `tools/list`, `tools/call`. The tools and
 * their authorisation are tools/call.ts, the same as over REST. A refused or
 * failed tool call is a normal result with `isError: true`, so the model
 * reads why; protocol errors are JSON-RPC errors.
 *
 * No session cookie is ever read here and browsers cannot attach the token,
 * so there is nothing for a cross-site request to ride on.
 */
import { OFFICE_MCP_PATH, type OfficeToolResult } from "@regulus/protocol";
import { AuthHttpError } from "../auth/errors.ts";
import { readJsonValue } from "../http/body.ts";
import { json, type Router } from "../http/router.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "./store.ts";
import { bearerOf, type OfficeAgentTokens } from "./tokens.ts";
import type { ToolCaller } from "./tools/asking.ts";
import type { OfficeTools } from "./tools/call.ts";

/** Newest first; a client asking for another version gets the newest. */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const MCP_BODY_MAX_BYTES = 256 * 1024;

export interface AgentAuthDeps {
  store: OfficeAgentStore;
  tokens: OfficeAgentTokens;
}

/** The agent a request's bearer token belongs to and how the token came to be, or null. */
export function callerFromRequest(
  deps: AgentAuthDeps,
  request: Request,
): { agent: OfficeAgentRow; caller: ToolCaller } | null {
  const token = bearerOf(request);
  if (!token) return null;
  const found = deps.tokens.verify(token);
  const agent = found ? deps.store.get(found.agentId) : undefined;
  return found && agent ? { agent, caller: { kind: found.kind, mintedBy: found.mintedBy } } : null;
}

/** The agent a request's bearer token belongs to, or null. */
export function agentFromRequest(deps: AgentAuthDeps, request: Request): OfficeAgentRow | null {
  return callerFromRequest(deps, request)?.agent ?? null;
}

export const unauthorizedAgent = () =>
  json(
    { error: "unauthorized" },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="office-agent"' } },
  );

export interface McpDeps extends AgentAuthDeps {
  tools: OfficeTools;
  version: string;
}

type RpcId = string | number | null;
interface RpcResponse {
  jsonrpc: "2.0";
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

const rpcError = (id: RpcId, code: number, message: string): RpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function toolResult(result: OfficeToolResult) {
  const payload = result.ok ? result.result : { error: result.error, message: result.message };
  const structured = isObject(payload) ? payload : { result: payload };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: structured,
    isError: !result.ok,
  };
}

export function mountMcp(router: Router, deps: McpDeps): void {
  const handle = async (
    { agent, caller }: { agent: OfficeAgentRow; caller: ToolCaller },
    message: unknown,
  ): Promise<RpcResponse | null> => {
    if (!isObject(message) || message.jsonrpc !== "2.0") {
      return rpcError(null, -32600, "invalid request");
    }
    const { method, params } = message;
    const hasId = typeof message.id === "string" || typeof message.id === "number";
    const id: RpcId = hasId ? (message.id as string | number) : null;
    // Responses to requests the server never makes, and notifications: nothing to answer.
    if (typeof method !== "string") return hasId ? null : rpcError(null, -32600, "invalid request");
    if (!hasId) return null;
    const ok = (result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize": {
        const wanted = isObject(params) ? params.protocolVersion : undefined;
        const version = (MCP_PROTOCOL_VERSIONS as readonly unknown[]).includes(wanted)
          ? (wanted as string)
          : MCP_PROTOCOL_VERSIONS[0];
        return ok({
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "regulus-office", title: "Regulus Office", version: deps.version },
          instructions: `You are connected as the office agent "${agent.name}" (preset: ${agent.preset}). Every tool call is authorised and audited by the office.`,
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: deps.tools.list(agent).map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { title: t.title, readOnlyHint: t.readOnly, openWorldHint: false },
          })),
        });
      case "tools/call": {
        if (!isObject(params) || typeof params.name !== "string") {
          return rpcError(id, -32602, "tools/call needs a tool name");
        }
        const result = await deps.tools.call(
          agent,
          params.name,
          params.arguments ?? {},
          "mcp",
          caller,
        );
        // An unknown tool is a protocol error (MCP spec, "Error handling"); it is audited all the same.
        if (!result.ok && result.error === "unknown_tool") {
          return rpcError(id, -32602, `unknown tool: ${params.name.slice(0, 80)}`);
        }
        return ok(toolResult(result));
      }
      default:
        return rpcError(id, -32601, "method not found");
    }
  };

  router.post(OFFICE_MCP_PATH, async (ctx) => {
    const agent = callerFromRequest(deps, ctx.request);
    if (!agent) return unauthorizedAgent();
    let body: unknown;
    try {
      body = await readJsonValue(ctx.request, {
        maxBytes: MCP_BODY_MAX_BYTES,
        emptyAsObject: false,
      });
    } catch (err) {
      if (err instanceof AuthHttpError && err.status === 413) return err.toResponse();
      return json(rpcError(null, -32700, "parse error"), { status: 400 });
    }
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > 20) {
        return json(rpcError(null, -32600, "invalid request"), { status: 400 });
      }
      const answers: RpcResponse[] = [];
      for (const message of body) {
        const answer = await handle(agent, message);
        if (answer) answers.push(answer);
      }
      return answers.length > 0 ? json(answers) : new Response(null, { status: 202 });
    }
    const answer = await handle(agent, body);
    return answer ? json(answer) : new Response(null, { status: 202 });
  });

  // No server-to-client stream and no session to end.
  const notAllowed = () =>
    json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
  router.get(OFFICE_MCP_PATH, notAllowed);
  router.add("DELETE", OFFICE_MCP_PATH, notAllowed);
}
