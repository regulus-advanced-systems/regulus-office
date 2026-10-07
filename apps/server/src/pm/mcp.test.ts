/**
 * The office MCP server over its real route (#271), driven by the official MCP
 * client (`@modelcontextprotocol/sdk`, streamable HTTP): authentication with
 * the per-agent token, the tool list a preset gets, tool calls with their
 * authorisation, and the audit of every call.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OFFICE_AGENTS_API_PATH,
  OFFICE_MCP_PATH,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
  toolsForPreset,
} from "@regulus/protocol";
import { type AgentsOffice, APOLLO, APOLLO_REPO, agentsOffice, BOREALIS } from "./test-helpers.ts";

let o: AgentsOffice;
let agent: OfficeAgentView;
let token: string;
const clients: Client[] = [];

async function connect(bearer: string): Promise<Client> {
  const client = new Client({ name: "office-agents-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(OFFICE_MCP_PATH, o.office.server.url), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    }),
  );
  clients.push(client);
  return client;
}

const post = (body: unknown, bearer?: string) =>
  fetch(new URL(OFFICE_MCP_PATH, o.office.server.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeAll(async () => {
  o = await agentsOffice();
  const made = await o.send(OFFICE_AGENTS_API_PATH, "POST", o.people.mia.cookie, {
    name: "Hermes",
    owner: "me",
    engine: "cli-session",
    role: "assistant",
    provider: "claude-code",
    model: "sonnet",
  });
  agent = (await made.json()) as OfficeAgentView;
  const minted = await o.send(
    `${OFFICE_AGENTS_API_PATH}/${agent.id}/tokens`,
    "POST",
    o.people.mia.cookie,
    { label: "mcp" },
  );
  token = ((await minted.json()) as OfficeAgentTokenCreated).token;
});
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => {});
  await o.stop();
});

describe("office MCP server", () => {
  test("no token, a made-up token and a session cookie are all refused", async () => {
    const init = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const none = await post(init);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    expect((await post(init, `roa_${"A".repeat(43)}`)).status).toBe(401);
    expect((await post(init, "not-a-token")).status).toBe(401);
    // A person's session is not an agent's identity.
    const cookie = await fetch(new URL(OFFICE_MCP_PATH, o.office.server.url), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: o.people.olga.cookie },
      body: JSON.stringify(init),
    });
    expect(cookie.status).toBe(401);
    await expect(connect(`roa_${"B".repeat(43)}`)).rejects.toThrow();
  });

  test("a real MCP client connects and lists exactly the tools of the agent's preset", async () => {
    const client = await connect(token);
    expect(client.getServerVersion()).toMatchObject({ name: "regulus-office" });
    expect(client.getInstructions()).toContain("Hermes");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(toolsForPreset("coordinator").map((t) => t.name));
    expect(tools.map((t) => t.name)).not.toContain("spawn_henchman");
    const enqueue = tools.find((t) => t.name === "enqueue_task");
    expect(enqueue?.inputSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["operationId", "repoId", "kind", "provider", "model"]),
    });
    expect(tools.find((t) => t.name === "read_board")?.annotations?.readOnlyHint).toBe(true);
  });

  test("tool calls run with the owner's rights and return structured results", async () => {
    const client = await connect(token);
    const ops = await client.callTool({ name: "list_operations", arguments: {} });
    expect(ops.isError).toBeFalsy();
    // Mia may spawn on Apollo and has nothing on Borealis; her agent sees the same.
    expect(ops.structuredContent).toEqual({
      operations: [
        expect.objectContaining({
          id: APOLLO,
          access: "spawn",
          repos: [expect.objectContaining({ id: APOLLO_REPO, repo: "octo/hello" })],
        }),
      ],
    });
    const queued = await client.callTool({
      name: "enqueue_task",
      arguments: {
        operationId: APOLLO,
        repoId: APOLLO_REPO,
        kind: "freeform",
        prompt: "Tidy the README",
        provider: "claude-code",
        model: "sonnet",
      },
    });
    expect(queued.isError).toBeFalsy();
    expect(queued.structuredContent).toMatchObject({ queuedFor: o.people.mia.id });
    const queue = await client.callTool({ name: "read_queue", arguments: { operationId: APOLLO } });
    const tasks = (queue.structuredContent as { tasks: Array<{ title: string }> }).tasks;
    expect(tasks.map((t) => t.title)).toEqual(["Tidy the README"]);
  });

  test("refusals come back as tool errors the model can read, and are audited as denied", async () => {
    const client = await connect(token);
    const closed = await client.callTool({
      name: "read_board",
      arguments: { operationId: BOREALIS },
    });
    expect(closed.isError).toBe(true);
    expect(closed.structuredContent).toEqual({ error: "not_found", message: "no such operation" });
    const beyond = await client.callTool({
      name: "spawn_henchman",
      arguments: {
        operationId: APOLLO,
        repoId: APOLLO_REPO,
        provider: "claude-code",
        model: "sonnet",
      },
    });
    expect(beyond.structuredContent).toMatchObject({ error: "preset_forbids" });
    expect(o.spawned.filter((s) => s.input.prompt === "")).toEqual([]);
    const bad = await client.callTool({ name: "read_board", arguments: { operationId: 7 } });
    expect(bad.structuredContent).toMatchObject({ error: "invalid_input" });
    await expect(client.callTool({ name: "delete_everything", arguments: {} })).rejects.toThrow(
      /unknown tool/,
    );
    const denied = o.audits("office_agent.tool_denied").map((a) => a.meta);
    expect(denied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "read_board",
          via: "mcp",
          error: "not_found",
          operationId: BOREALIS,
        }),
        expect.objectContaining({ tool: "spawn_henchman", error: "preset_forbids" }),
        expect.objectContaining({ tool: "unknown", error: "unknown_tool" }),
      ]),
    );
    const ran = o.audits("office_agent.tool_call");
    expect(ran.some((a) => a.meta.tool === "enqueue_task" && a.meta.ok === true)).toBe(true);
    // Calls are recorded under the owner whose rights were used; never with the prompt.
    expect(ran.every((a) => a.userId === o.people.mia.id && a.targetId === agent.id)).toBe(true);
    expect(JSON.stringify(o.audits())).not.toContain("Tidy the README");
  });

  test("the transport: notifications are accepted, unknown methods and bad JSON are JSON-RPC errors, there is no GET stream", async () => {
    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, token);
    expect(note.status).toBe(202);
    const ping = await post({ jsonrpc: "2.0", id: "p", method: "ping" }, token);
    expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: "p", result: {} });
    const unknown = await post({ jsonrpc: "2.0", id: 2, method: "resources/list" }, token);
    expect(((await unknown.json()) as { error: { code: number } }).error.code).toBe(-32601);
    const garbage = await post("{nope", token);
    expect(garbage.status).toBe(400);
    expect(((await garbage.json()) as { error: { code: number } }).error.code).toBe(-32700);
    const old = await post(
      { jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      token,
    );
    const negotiated = (await old.json()) as { result: { protocolVersion: string } };
    expect(negotiated.result.protocolVersion).toBe("2025-06-18");
    const get = await fetch(new URL(OFFICE_MCP_PATH, o.office.server.url), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get.status).toBe(405);
  });

  test("a preset change applies to the next call of an open client", async () => {
    const client = await connect(token);
    await o.send(`${OFFICE_AGENTS_API_PATH}/${agent.id}`, "PATCH", o.people.mia.cookie, {
      preset: "observer",
    });
    const refused = await client.callTool({
      name: "post_chat",
      arguments: { text: "hello office" },
    });
    expect(refused.structuredContent).toMatchObject({ error: "preset_forbids" });
    expect(o.chat).toEqual([]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(toolsForPreset("observer").map((t) => t.name));
  });
});
