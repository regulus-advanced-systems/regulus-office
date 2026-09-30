/**
 * How a workflow robot is started (#155): one headless, read-only run of the
 * unmodified provider CLI in the run's own sandbox, answering with JSON.
 *
 * Claude Code (`claude -p`, https://code.claude.com/docs/en/cli-reference,
 * https://code.claude.com/docs/en/headless):
 * - `--tools Read,Grep,Glob` makes only those built-in tools exist (no Bash,
 *   Edit, Write, WebFetch, WebSearch); `--allowedTools` pre-approves them and
 *   `--disallowedTools` denies the rest by name as a second lock;
 * - `--permission-mode dontAsk` denies anything not pre-approved instead of
 *   asking (https://code.claude.com/docs/en/permission-modes);
 * - `--setting-sources user` ignores the checkout's `.claude/settings*.json`
 *   (the PR could add hooks there, which would run commands), and
 *   `--strict-mcp-config` with no `--mcp-config` ignores its `.mcp.json`;
 *   the robot's HOME is the office workflow runner's, which holds no one's
 *   settings;
 * - `--no-session-persistence`, `--json-schema` for the answer,
 *   `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` so the only traffic is the
 *   model API (https://code.claude.com/docs/en/env-vars).
 * With "execute PR code" (same-repo PRs only) `Bash` is added to the tools.
 *
 * Codex (`codex exec`, https://developers.openai.com/codex/noninteractive,
 * https://developers.openai.com/codex/security):
 * - `--sandbox read-only` (no writes, no network for commands) and
 *   `approval_policy="never"` so it never waits for a human;
 * - `--disable shell_tool --disable unified_exec` removes command execution,
 *   so by default Codex reviews from the diff in the prompt only;
 *   `--disable hooks` and `web_search="disabled"` as well;
 * - `--output-schema` for the answer, `--json` for events and token usage.
 * With "execute PR code" the shell stays on in a `workspace-write` sandbox
 * (network still off).
 *
 * Credentials (SPEC §8, D2): only the office's own API key for the provider,
 * injected as env; never a GitHub token, never anyone's CLI login.
 */
import {
  CODEX_KEY_ENV,
  CODEX_KEY_PROVIDER,
  checkModel,
  type PlannedFile,
  type Secret,
  SecretEnv,
  type SpawnPlan,
} from "@regulus/agent-adapters";
import type { BackendId, WorkflowProvider } from "@regulus/protocol";
import { REVIEW_OUTPUT_SCHEMA, robotRules } from "./prompt.ts";

export const CLAUDE_READ_TOOLS = ["Read", "Grep", "Glob"] as const;
export const CLAUDE_DENIED_TOOLS = [
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
] as const;
const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const CODEX_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface RobotPlanInput {
  runId: string;
  provider: WorkflowProvider;
  model?: string;
  effort?: string;
  /** Checkout path inside the runner. */
  workdir: string;
  /** Runner HOME of the workflow identity. */
  home: string;
  backend: BackendId;
  prompt: string;
  /** The office's API key for the provider. */
  apiKey: Secret;
  /** Same-repo PR and the workflow allows it. */
  runCommands: boolean;
  /** Program override (tests point this at the fake CLI). */
  command?: string;
}

/** Keep a prompt that starts with "-" from being parsed as a flag. */
const positional = (text: string) => (text.startsWith("-") ? ` ${text}` : text);

function baseEnv(input: RobotPlanInput): SecretEnv {
  const env = SecretEnv.of({ HOME: input.home, LANG: "C.UTF-8" });
  return input.backend === "docker" ? env.with("IS_SANDBOX", "1") : env;
}

export function claudeArgv(input: Omit<RobotPlanInput, "apiKey">): string[] {
  const tools = input.runCommands ? [...CLAUDE_READ_TOOLS, "Bash"] : [...CLAUDE_READ_TOOLS];
  const denied = input.runCommands ? [...CLAUDE_DENIED_TOOLS] : [...CLAUDE_DENIED_TOOLS, "Bash"];
  const argv = [
    input.command ?? "claude",
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--tools",
    tools.join(","),
    "--allowedTools",
    tools.join(","),
    "--disallowedTools",
    denied.join(","),
    "--setting-sources",
    "user",
    "--strict-mcp-config",
    "--json-schema",
    JSON.stringify(REVIEW_OUTPUT_SCHEMA),
  ];
  if (input.model) argv.push("--model", checkModel(input.model));
  if (input.effort && CLAUDE_EFFORTS.has(input.effort)) argv.push("--effort", input.effort);
  // Single-value options last, so no variadic option swallows the prompt.
  argv.push("--append-system-prompt", robotRules({ canRunCommands: input.runCommands }));
  argv.push(positional(input.prompt));
  return argv;
}

export function codexArgv(input: Omit<RobotPlanInput, "apiKey">, schemaPath: string): string[] {
  const provider = `{ name = "OpenAI (office key)", base_url = ${JSON.stringify(OPENAI_BASE_URL)}, env_key = ${JSON.stringify(CODEX_KEY_ENV)}, wire_api = "responses" }`;
  const argv = [
    input.command ?? "codex",
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    input.runCommands ? "workspace-write" : "read-only",
    "-c",
    'approval_policy="never"',
    "-c",
    'web_search="disabled"',
    "--disable",
    "hooks",
    ...(input.runCommands ? [] : ["--disable", "shell_tool", "--disable", "unified_exec"]),
    "--output-schema",
    schemaPath,
    "-c",
    `model_provider=${JSON.stringify(CODEX_KEY_PROVIDER)}`,
    "-c",
    `model_providers.${CODEX_KEY_PROVIDER}=${provider}`,
  ];
  if (input.model) argv.push("-c", `model=${JSON.stringify(checkModel(input.model))}`);
  if (input.effort && CODEX_EFFORTS.has(input.effort)) {
    argv.push("-c", `model_reasoning_effort=${JSON.stringify(input.effort)}`);
  }
  argv.push("--", input.prompt);
  return argv;
}

/** The plan handed to `Runner.spawnPiped` for the workflow identity. */
export function buildRobotPlan(input: RobotPlanInput): SpawnPlan {
  const dir = `${input.home.replace(/\/+$/, "")}/.regulus-office/workflows/${input.runId}`;
  const files: PlannedFile[] = [];
  let argv: string[];
  let env = baseEnv(input);
  if (input.provider === "claude-code") {
    argv = claudeArgv(input);
    env = env
      .with("DISABLE_AUTOUPDATER", "1")
      .with("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
      .merge(SecretEnv.of({ ANTHROPIC_API_KEY: input.apiKey }));
  } else {
    const schemaPath = `${dir}/schema.json`;
    files.push({ path: schemaPath, contents: JSON.stringify(REVIEW_OUTPUT_SCHEMA), mode: 0o600 });
    argv = codexArgv(input, schemaPath);
    env = env.merge(SecretEnv.of({ [CODEX_KEY_ENV]: input.apiKey }));
  }
  return {
    agentId: input.runId,
    provider: input.provider,
    argv,
    env,
    cwd: input.workdir,
    tmuxSession: `agent-${input.runId}`,
    files,
  };
}
