#!/usr/bin/env bun
/**
 * Stand-in for the `claude` binary in the CLI session engine's tests (#271).
 * It is NOT Claude Code, talks to no model and never reads `~/.claude`.
 *
 * Like `claude -p --output-format json` it takes the flags the engine passes
 * (cli-plan.ts), keeps one session per `--session-id` (in `$HOME`, so
 * `--resume` of an unknown session fails as the real CLI does), connects to
 * the MCP server from `--mcp-config` with the configured headers, and prints
 * one `result` object. Its "answer" is a JSON report of what it saw, so a
 * test can check the whole path: argv, env, session, MCP and the office tools.
 *
 * Prompts: "SLEEP" hangs (timeout test), "FAIL" reports an error, "QUEUE
 * <operation> <repo> <user>" calls `enqueue_task` on behalf of that user.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const prompt = (argv.at(-1) ?? "").trim();
const home = process.env.HOME ?? "";
const resume = flag("--resume");
const sessionId = resume ?? flag("--session-id") ?? "";

const out = (body: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify({ type: "result", session_id: sessionId, ...body })}\n`);
};
const fail = (subtype: string) => {
  out({ subtype, is_error: true, result: "" });
  process.exit(1);
};

if (!argv.includes("-p") || flag("--output-format") !== "json") fail("error_bad_flags");
const sessionDir = `${home}/.fake-claude`;
const sessionFile = `${sessionDir}/${sessionId}.json`;
let turns: string[] = [];
try {
  turns = JSON.parse(readFileSync(sessionFile, "utf8")) as string[];
} catch {
  if (resume) fail("error_no_conversation_found");
}
if (!resume && turns.length > 0) fail("error_session_id_in_use");
if (prompt.includes("SLEEP")) await Bun.sleep(60_000);
if (prompt.includes("FAIL")) fail("error_during_execution");

const config = JSON.parse(readFileSync(flag("--mcp-config") ?? "", "utf8")) as {
  mcpServers: Record<string, { url: string; headers: Record<string, string> }>;
};
const server = config.mcpServers.office;
if (!server) fail("error_no_office_mcp_server");
let rpcId = 0;
async function rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
  rpcId += 1;
  const res = await fetch(server?.url ?? "", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...server?.headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  });
  if (!res.ok) return { httpStatus: res.status };
  return ((await res.json()) as { result: Record<string, unknown> }).result;
}
const callTool = async (name: string, args: unknown) =>
  (await rpc("tools/call", { name, arguments: args })).structuredContent;

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {} });
const listed = (await rpc("tools/list", {})) as { tools?: Array<{ name: string }> };
const operations = await callTool("list_operations", {});
let queued: unknown;
const queue = /QUEUE (\S+) (\S+) (\S+)/.exec(prompt);
if (queue) {
  queued = await callTool("enqueue_task", {
    operationId: queue[1],
    repoId: queue[2],
    onBehalfOf: queue[3],
    kind: "freeform",
    prompt: "from the fake CLI",
    provider: "claude-code",
    model: "sonnet",
  });
}

turns.push(prompt);
mkdirSync(sessionDir, { recursive: true });
writeFileSync(sessionFile, JSON.stringify(turns));

out({
  subtype: "success",
  is_error: false,
  total_cost_usd: 0.002,
  usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 5 },
  result: JSON.stringify({
    turn: turns.length,
    resumed: resume !== undefined,
    prompt,
    model: flag("--model"),
    builtInTools: flag("--tools"),
    allowedTools: flag("--allowedTools"),
    systemPrompt: flag("--append-system-prompt"),
    tools: listed.tools?.map((t) => t.name) ?? [],
    operations,
    queued,
    // Booleans only: the fake never prints a secret.
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    tokenOnArgv: argv.some((a) => a.includes("roa_")),
    home,
    cwd: process.cwd(),
  }),
});
