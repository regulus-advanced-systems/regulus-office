import { beforeEach, describe, expect, test } from "bun:test";
import { ClaudeCodeAdapter, createFakeRunnerContext, Secret } from "@regulus/agent-adapters";
import { Router } from "../../http/router.ts";
import { MemoryEventSink } from "../events.ts";
import { CLAUDE_HOOK_ROUTE, CLAUDE_STATUSLINE_ROUTE, mountClaudeHookRoutes } from "./routes.ts";
import { denyAllAgentTokens, MemoryAgentTokens } from "./tokens.ts";

const fixtures = await Bun.file(
  new URL(
    "../../../../../packages/agent-adapters/src/claude-code/fixtures/hooks.json",
    import.meta.url,
  ),
).json();

let router: Router;
let sink: MemoryEventSink;
let tokens: MemoryAgentTokens;
let adapter: ClaudeCodeAdapter;
let token: string;

beforeEach(() => {
  router = new Router();
  sink = new MemoryEventSink();
  tokens = new MemoryAgentTokens();
  adapter = new ClaudeCodeAdapter({ permissionHoldSeconds: 1, newRequestId: () => "perm-1" });
  mountClaudeHookRoutes(router, { sink, tokens, adapter });
  token = tokens.issue("a1");
});

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${token}` },
): Promise<Response> {
  const request = new Request(`http://office.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const url = new URL(request.url);
  const match = router.match("POST", url.pathname);
  if (!match) return new Response(null, { status: 404 });
  return match.handler({ request, url, params: match.params });
}

describe("claude hook routes", () => {
  test("patterns carry no token (safe to log, #90)", () => {
    expect(CLAUDE_HOOK_ROUTE).toBe("/api/agents/:agentId/hooks/claude");
    expect(CLAUDE_STATUSLINE_ROUTE).toBe("/api/agents/:agentId/statusline");
  });

  test("missing, wrong or other agent's token is 401", async () => {
    const other = tokens.issue("a2");
    const cases: Record<string, string>[] = [
      {},
      { authorization: "Bearer nope" },
      { authorization: `Basic ${token}` },
      { authorization: `Bearer ${other}` },
    ];
    for (const headers of cases) {
      const res = await post("/api/agents/a1/hooks/claude", fixtures.Stop, headers);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
    }
    expect(sink.events).toEqual([]);
  });

  test("the deny-all store rejects everything", async () => {
    const r = new Router();
    mountClaudeHookRoutes(r, { sink, tokens: denyAllAgentTokens });
    const match = r.match("POST", "/api/agents/a1/statusline");
    const request = new Request("http://office.test/api/agents/a1/statusline", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "{}",
    });
    const res = await match?.handler({
      request,
      url: new URL(request.url),
      params: { agentId: "a1" },
    });
    expect(res?.status).toBe(401);
  });

  test("bad agent id is 404", async () => {
    expect((await post("/api/agents/a.b/hooks/claude", {})).status).toBe(404);
  });

  test("oversize bodies are 413, junk is 400, wrong type is 415", async () => {
    const big = JSON.stringify({ hook_event_name: "PreToolUse", pad: "x".repeat(1024 * 1024) });
    expect((await post("/api/agents/a1/hooks/claude", big)).status).toBe(413);
    const bigStatus = JSON.stringify({ pad: "x".repeat(70 * 1024) });
    expect((await post("/api/agents/a1/statusline", bigStatus)).status).toBe(413);
    expect((await post("/api/agents/a1/hooks/claude", "{nope")).status).toBe(400);
    const res = await post("/api/agents/a1/hooks/claude", "{}", {
      authorization: `Bearer ${token}`,
      "content-type": "text/plain",
    });
    expect(res.status).toBe(415);
  });

  test("hook events are mapped and published; response is an empty 2xx", async () => {
    const res = await post("/api/agents/a1/hooks/claude", fixtures.PreToolUse_Edit);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(sink.for("a1").map((e) => e.kind)).toEqual(["status", "action", "tool_call"]);
  });

  test("statusline is published as usage and limit events", async () => {
    const statusline = await Bun.file(
      new URL(
        "../../../../../packages/agent-adapters/src/claude-code/fixtures/statusline.json",
        import.meta.url,
      ),
    ).json();
    const res = await post("/api/agents/a1/statusline", statusline);
    expect(res.status).toBe(204);
    expect(sink.for("a1").map((e) => e.kind)).toEqual(["usage", "limit", "limit"]);
  });

  test("PermissionRequest is held until the office answers, then returns the decision", async () => {
    const ctx = createFakeRunnerContext({ agentToken: Secret.of("t") });
    const plan = adapter.buildSpawn(
      { agentId: "a1", provider: "claude-code", workdir: "/w", credential: { kind: "cli_login" } },
      ctx,
    );
    const control = adapter.connect(plan, ctx);
    const pending = post("/api/agents/a1/hooks/claude", fixtures.PermissionRequest);
    const request = await sink.next((e) => e.kind === "permission_request", "a1");
    expect(request).toMatchObject({ requestId: "perm-1", toolName: "Bash" });
    await control.respondPermission("perm-1", "allow_always");
    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
          updatedPermissions: [
            {
              type: "addRules",
              rules: [{ toolName: "Bash", ruleContent: "rm -rf node_modules" }],
              behavior: "allow",
              destination: "session",
            },
          ],
        },
      },
    });
  });

  test("an unanswered PermissionRequest falls back to Claude's own dialog", async () => {
    const res = await post("/api/agents/a1/hooks/claude", fixtures.PermissionRequest);
    expect(res.status).toBe(204);
    expect(adapter.permissions.pending("a1")).toEqual([]);
  });

  test("a turn boundary releases a held request", async () => {
    const pending = post("/api/agents/a1/hooks/claude", fixtures.PermissionRequest);
    await sink.next((e) => e.kind === "permission_request", "a1");
    await post("/api/agents/a1/hooks/claude", fixtures.Stop);
    expect((await pending).status).toBe(204);
  });
});

describe("MemoryAgentTokens", () => {
  test("verify is per agent and revocable", () => {
    const store = new MemoryAgentTokens();
    const t = store.issue("x");
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(store.verify("x", t)).toBe(true);
    expect(store.verify("y", t)).toBe(false);
    expect(store.verify("x", "")).toBe(false);
    store.revoke("x");
    expect(store.verify("x", t)).toBe(false);
  });
});
