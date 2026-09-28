/**
 * SpawnPlan construction for the unmodified `claude` binary (SPEC §7, §8).
 *
 * Per agent the plan writes, under `~/.regulus-office/claude/<agentId>/` in
 * the runner HOME (never inside `~/.claude`):
 * - `settings.json` (0600, secret): http hooks for every event in
 *   `CLAUDE_HOOK_EVENTS` pointing at the office with the per-agent bearer
 *   token, plus the statusline command. Passed with `--settings`, which
 *   layers over the human's own settings for this session only.
 * - `statusline.sh` (0700): POSTs the statusline JSON to the office with curl
 *   (headers read from a file, so the token is never in argv or output) and
 *   prints a short line; it always exits 0.
 * - `statusline.headers` (0600, secret): the `Authorization` header.
 *
 * Credentials: `cli_login` injects nothing (the CLI reads its own login from
 * the runner HOME; the office never touches it). API keys and base-URL plan
 * keys go into `SpawnPlan.env` only, never argv or files.
 * Env names: https://code.claude.com/docs/en/env-vars
 */

import { Secret, SecretEnv } from "../secret.ts";
import { tmuxSessionName } from "../session.ts";
import type { RunnerContext, SpawnCredential, SpawnPlan, SpawnRequest } from "../types.ts";
import { CLAUDE_HOOK_EVENTS } from "./hooks.ts";

export interface ClaudeSpawnOptions {
  /** Program to run; `claude` on the runner PATH by default. */
  command: string;
  /** How long the office may hold a PermissionRequest hook open, seconds. */
  permissionHoldSeconds: number;
  /** New session ids (UUIDs) for `--session-id`. */
  newSessionId: () => string;
}

export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultracode"] as const;

/** Model override keys → env var (https://code.claude.com/docs/en/model-config). */
export const MODEL_OVERRIDE_ENV: Readonly<Record<string, string>> = {
  default: "ANTHROPIC_MODEL",
  opus: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  sonnet: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  haiku: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  fable: "ANTHROPIC_DEFAULT_FABLE_MODEL",
  subagent: "CLAUDE_CODE_SUBAGENT_MODEL",
};

/**
 * Hosts whose Anthropic-compatible endpoint documents `ANTHROPIC_API_KEY`
 * (Kimi Code). Everything else gets `ANTHROPIC_AUTH_TOKEN` (Bearer), as
 * documented for Z.AI and DeepSeek (research 04).
 */
const API_KEY_HOSTS = [/(^|\.)kimi\.(ai|com)$/, /(^|\.)moonshot\.(ai|cn)$/];

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,127}$/;

export function settingsDir(home: string, agentId: string): string {
  return `${home.replace(/\/+$/, "")}/.regulus-office/claude/${agentId}`;
}

export function hookUrl(officeUrl: string, agentId: string): string {
  return `${officeUrl.replace(/\/+$/, "")}/api/agents/${encodeURIComponent(agentId)}/hooks/claude`;
}

export function statuslineUrl(officeUrl: string, agentId: string): string {
  return `${officeUrl.replace(/\/+$/, "")}/api/agents/${encodeURIComponent(agentId)}/statusline`;
}

/** POSIX single-quoting for the generated shell script. */
export function shQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

export function credentialEnv(credential: SpawnCredential): SecretEnv {
  switch (credential.kind) {
    case "cli_login":
      return SecretEnv.empty();
    case "api_key":
      return SecretEnv.of({ ANTHROPIC_API_KEY: credential.apiKey });
    case "base_url_key": {
      const url = parseBaseUrl(credential.baseUrl);
      const keyVar = API_KEY_HOSTS.some((re) => re.test(url.hostname))
        ? "ANTHROPIC_API_KEY"
        : "ANTHROPIC_AUTH_TOKEN";
      let env = SecretEnv.of({
        ANTHROPIC_BASE_URL: credential.baseUrl,
        [keyVar]: credential.apiKey,
        API_TIMEOUT_MS: "3000000",
      });
      for (const [key, model] of Object.entries(credential.modelOverrides ?? {})) {
        const name = MODEL_OVERRIDE_ENV[key];
        if (!name) throw new Error(`Unknown Claude Code model override: ${key}`);
        env = env.with(name, checkModel(model));
      }
      return env;
    }
  }
}

function parseBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Base URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Base URL must be http(s)");
  }
  return url;
}

export function checkModel(model: string): string {
  if (!MODEL.test(model)) throw new Error(`Invalid model name: ${model}`);
  return model;
}

/** The `--settings` JSON: http hooks + statusline. Contains the token. */
export function buildSettings(
  agentId: string,
  officeUrl: string,
  token: Secret,
  statuslineCommand: string,
  permissionHoldSeconds: number,
): Record<string, unknown> {
  const handler = (timeout: number) => ({
    type: "http",
    url: hookUrl(officeUrl, agentId),
    headers: { Authorization: `Bearer ${token.reveal()}` },
    timeout,
  });
  const hooks: Record<string, unknown> = {};
  for (const event of CLAUDE_HOOK_EVENTS) {
    const timeout = event === "PermissionRequest" ? permissionHoldSeconds + 5 : 10;
    hooks[event] = [{ hooks: [handler(timeout)] }];
  }
  return { hooks, statusLine: { type: "command", command: statuslineCommand, padding: 0 } };
}

export function statuslineScript(agentId: string, url: string): string {
  return `#!/bin/sh
# Generated by Regulus Office for agent ${agentId}. Forwards Claude Code's
# statusline JSON to the office. The token stays in statusline.headers and is
# never printed; an unreachable office never fails the statusline.
dir=$(dirname "$0")
input=$(cat)
if command -v curl >/dev/null 2>&1 && [ -r "$dir/statusline.headers" ]; then
  printf '%s' "$input" | curl -s -o /dev/null --max-time 2 --connect-timeout 1 \\
    -H 'Content-Type: application/json' -H "@$dir/statusline.headers" \\
    --data-binary @- ${shQuote(url)} >/dev/null 2>&1 || true
fi
model=$(printf '%s' "$input" | sed -n 's/.*"display_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)
printf 'Regulus Office%s\\n' "\${model:+ | $model}"
exit 0
`;
}

/** Hook/statusline files and the `--settings` path; empty without a token. */
export function hookFiles(
  agentId: string,
  ctx: RunnerContext,
  permissionHoldSeconds: number,
): { files: SpawnPlan["files"]; settingsPath?: string } {
  if (!ctx.agentToken) return { files: [] };
  const dir = settingsDir(ctx.home, agentId);
  const script = `${dir}/statusline.sh`;
  const settings = buildSettings(
    agentId,
    ctx.officeUrl,
    ctx.agentToken,
    shQuote(script),
    permissionHoldSeconds,
  );
  return {
    settingsPath: `${dir}/settings.json`,
    files: [
      {
        path: `${dir}/settings.json`,
        contents: Secret.of(`${JSON.stringify(settings, null, 2)}\n`),
        mode: 0o600,
      },
      {
        path: `${dir}/statusline.headers`,
        contents: Secret.of(`Authorization: Bearer ${ctx.agentToken.reveal()}\n`),
        mode: 0o600,
      },
      {
        path: script,
        contents: statuslineScript(agentId, statuslineUrl(ctx.officeUrl, agentId)),
        mode: 0o700,
      },
    ],
  };
}

/** Env every Claude process of this office gets, before credentials. */
export function baseEnv(ctx: RunnerContext): SecretEnv {
  const env = SecretEnv.of({ HOME: ctx.home });
  // SPEC §8: satisfies Claude's root guard if a docker runner image runs as root.
  return ctx.backend === "docker" ? env.with("IS_SANDBOX", "1") : env;
}

export function buildClaudeSpawn(
  req: SpawnRequest,
  ctx: RunnerContext,
  opts: ClaudeSpawnOptions,
): SpawnPlan {
  const tmuxSession = tmuxSessionName(req.agentId);
  const { files, settingsPath } = hookFiles(req.agentId, ctx, opts.permissionHoldSeconds);
  const argv = [opts.command];
  if (settingsPath) argv.push("--settings", settingsPath);
  let sessionId: string;
  if (req.resumeSessionId) {
    if (!SESSION_ID.test(req.resumeSessionId)) throw new Error("Invalid Claude session id");
    sessionId = req.resumeSessionId;
    argv.push("--resume", sessionId);
  } else {
    sessionId = opts.newSessionId();
    argv.push("--session-id", sessionId);
  }
  if (req.model) argv.push("--model", checkModel(req.model));
  if (req.effort) {
    if (!(CLAUDE_EFFORTS as readonly string[]).includes(req.effort)) {
      throw new Error(`Invalid Claude effort: ${req.effort}`);
    }
    argv.push("--effort", req.effort);
  }
  // The first prompt is a positional argument; a leading space keeps a prompt
  // that starts with "-" from being parsed as a flag.
  if (req.prompt?.trim()) argv.push(req.prompt.startsWith("-") ? ` ${req.prompt}` : req.prompt);
  return {
    agentId: req.agentId,
    provider: "claude-code",
    argv,
    env: baseEnv(ctx).merge(credentialEnv(req.credential)),
    cwd: req.workdir,
    tmuxSession,
    files,
    providerSessionId: sessionId,
  };
}
