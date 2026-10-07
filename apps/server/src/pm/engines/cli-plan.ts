/**
 * How the CLI session engine runs one turn of an office agent (#271): the
 * unmodified `claude` CLI, headless, in the session that belongs to the
 * conversation, with the office MCP server as its only way to act.
 *
 * Claude Code (`claude -p`, https://code.claude.com/docs/en/cli-reference,
 * https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/mcp):
 * - `--session-id <uuid>` starts the conversation's session and `--resume
 *   <uuid>` continues it, so the agent keeps its context between turns and
 *   across office restarts;
 * - `--tools ""` removes every built-in tool (no Bash, no file access, no
 *   web): the agent is not a coding henchman;
 * - `--strict-mcp-config --mcp-config <file>` loads the office MCP server and
 *   nothing else, and `--allowedTools mcp__office` pre-approves its tools;
 *   `--permission-mode dontAsk` denies anything else instead of waiting for
 *   a human who is not there;
 * - `--setting-sources user` ignores project and local settings (the working
 *   directory is the agent's own folder);
 * - `--append-system-prompt-file` carries who the agent is: its soul and what
 *   it remembers (#136), from the office's copy, written anew for each turn.
 *
 * Secrets (SPEC §8): the model key goes into the plan's env only. The agent's
 * office token is in the MCP config file, mode 0600 in the runner identity's
 * HOME, like the henchmen's hook tokens; it is never on argv.
 *
 * Privacy (D20): the soul and the memories are private to the agent's person,
 * so they are not on argv either, where every process on the host could read
 * them: they are in `prompt.md` in the agent's own folder, mode 0600, in its
 * owner's runner identity (a shared agent's in the office agents' identity).
 */
import {
  CLAUDE_EFFORTS,
  checkModel,
  credentialEnv,
  type PlannedFile,
  Secret,
  SecretEnv,
  type SpawnCredential,
  type SpawnPlan,
} from "@regulus/agent-adapters";
import { type BackendId, OFFICE_MCP_SERVER_NAME } from "@regulus/protocol";
import type { EngineAgent } from "./types.ts";

export interface CliTurnInput {
  agent: EngineAgent;
  /** HOME of the runner identity the turn runs as. */
  home: string;
  backend: BackendId;
  mcpUrl: string;
  token: Secret;
  credential: SpawnCredential;
  sessionId: string;
  /** False on the conversation's first turn. */
  resume: boolean;
  /** What the agent remembers, as text (`EngineMind.digest()`); empty when nothing. */
  memory?: string;
  prompt: string;
  /** Program override (tests point this at the fake CLI). */
  command?: string;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AGENT_ID = /^[A-Za-z0-9-]{1,64}$/;

/** The agent's own folder in the runner identity's HOME. */
export function agentDir(home: string, agentId: string): string {
  if (!AGENT_ID.test(agentId)) throw new Error("invalid office agent id");
  return `${home.replace(/\/+$/, "")}/.regulus-office/office-agents/${agentId}`;
}

/**
 * Who the agent is, for the system prompt: the office's frame, then its soul
 * (so the soul can refine the frame), then what it remembers.
 */
export function rolePrompt(agent: EngineAgent, memory = ""): string {
  const whose =
    agent.ownerUserId === null
      ? "You are a shared agent of the office: you serve everyone in it. Each message tells you who is speaking and their user id. When an office tool takes `onBehalfOf` and you act for the person who asked, pass their user id; you can only act for a person while they wait for your answer."
      : `You are the personal agent of ${agent.ownerName ?? "your owner"}. You act only for them and with their rights; nobody else can talk to you.`;
  return [
    `You are ${agent.name}, an office agent (role: ${agent.role}) in a Regulus Office.`,
    whose,
    `You act only through the "${OFFICE_MCP_SERVER_NAME}" MCP tools; your privilege preset is "${agent.preset}". A refused tool call is final: say what was refused and why, do not work around it.`,
    "Your final answer is shown to the person as your reply, so answer them directly and briefly.",
    agent.ownerUserId === null
      ? "You keep memories and notes in the office (memory_save, memory_search, note_write, note_read): they outlast every conversation and you use them with everyone, and the office's admins can read them. Save what helps the office; never what one person told you in confidence, and never a password, key or token."
      : "You keep memories and notes in the office (memory_save, memory_search, note_write, note_read): they outlast every conversation, and only your owner can read them. Save what you should still know next time; never a password, key or token.",
    agent.instructions.trim(),
    memory.trim(),
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/** Keep a prompt that starts with "-" from being parsed as a flag. */
const positional = (text: string) => (text.startsWith("-") ? ` ${text}` : text);

export function mcpConfig(mcpUrl: string, token: Secret): Secret {
  return Secret.of(
    JSON.stringify({
      mcpServers: {
        [OFFICE_MCP_SERVER_NAME]: {
          type: "http",
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token.reveal()}` },
        },
      },
    }),
  );
}

export function claudeTurnArgv(
  input: Omit<CliTurnInput, "token" | "credential" | "memory">,
  mcpPath: string,
  promptPath: string,
) {
  if (!SESSION_ID.test(input.sessionId)) throw new Error("invalid session id");
  const argv = [
    input.command ?? "claude",
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--setting-sources",
    "user",
    "--strict-mcp-config",
    "--mcp-config",
    mcpPath,
    input.resume ? "--resume" : "--session-id",
    input.sessionId,
    "--model",
    checkModel(input.agent.model),
  ];
  const effort = input.agent.effort;
  if (effort && (CLAUDE_EFFORTS as readonly string[]).includes(effort)) {
    argv.push("--effort", effort);
  }
  argv.push("--tools", "", "--allowedTools", `mcp__${OFFICE_MCP_SERVER_NAME}`);
  // Single-value options last, so no variadic option swallows the prompt.
  argv.push("--append-system-prompt-file", promptPath);
  argv.push(positional(input.prompt));
  return argv;
}

/** The plan handed to `Runner.spawnPiped` for one turn. */
export function buildClaudeTurn(input: CliTurnInput): SpawnPlan {
  const dir = agentDir(input.home, input.agent.id);
  const mcpPath = `${dir}/mcp.json`;
  const promptPath = `${dir}/prompt.md`;
  const files: PlannedFile[] = [
    { path: mcpPath, contents: mcpConfig(input.mcpUrl, input.token), mode: 0o600 },
    // A Secret so it is never logged with the plan: it is private, not a credential.
    {
      path: promptPath,
      contents: Secret.of(`${rolePrompt(input.agent, input.memory)}\n`),
      mode: 0o600,
    },
  ];
  let env = SecretEnv.of({
    HOME: input.home,
    LANG: "C.UTF-8",
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  });
  if (input.backend === "docker") env = env.with("IS_SANDBOX", "1");
  return {
    agentId: input.agent.id,
    provider: "claude-code",
    argv: claudeTurnArgv(input, mcpPath, promptPath),
    env: env.merge(credentialEnv(input.credential)),
    cwd: dir,
    tmuxSession: `agent-${input.agent.id}`,
    files,
    providerSessionId: input.sessionId,
  };
}

export interface CliTurnResult {
  /** The agent's answer, or null when the CLI gave none. */
  reply: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
  };
  /** Why there is no answer (short, no model output). */
  error: string | null;
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;

/** `claude -p --output-format json` prints one `result` object; stray lines before it are tolerated. */
export function parseClaudeTurn(stdout: string): CliTurnResult {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  let result: Raw | null = null;
  const text = stdout.trim();
  for (const candidate of [text, ...text.split("\n").reverse()]) {
    try {
      const v = obj(JSON.parse(candidate));
      if (v?.type === "result") {
        result = v;
        break;
      }
    } catch {
      // not this line
    }
  }
  if (!result) return { reply: null, usage, error: "the CLI gave no result" };
  const u = obj(result.usage);
  usage.inputTokens = n(u?.input_tokens);
  usage.outputTokens = n(u?.output_tokens);
  usage.cacheReadTokens = n(u?.cache_read_input_tokens);
  usage.cacheWriteTokens = n(u?.cache_creation_input_tokens);
  usage.costUsd = n(result.total_cost_usd);
  if (result.is_error === true) {
    const subtype = typeof result.subtype === "string" ? result.subtype.slice(0, 60) : "an error";
    return { reply: null, usage, error: `the CLI reported ${subtype}` };
  }
  const reply = typeof result.result === "string" ? result.result.trim() : "";
  return reply
    ? { reply, usage, error: null }
    : { reply: null, usage, error: "the CLI gave an empty answer" };
}
