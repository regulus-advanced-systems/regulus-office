/**
 * Codex adapter (SPEC §7, research 04 §"OpenAI Codex CLI + SDK + app-server").
 *
 * - Primary control: `codex app-server` over stdio, JSON-RPC (control.ts).
 *   `buildSpawn` returns that command; `connect` starts it with
 *   `RunnerOps.spawnPiped` inside the human's runner. The plan is not meant for
 *   `Runner.exec` (tmux): the tmux session name is where the TUI hand-off runs.
 * - TUI: `codex resume <threadId>` in the agent's tmux session. Hand-off, not
 *   co-drive: close the structured control first (see `buildAttachTui`).
 * - Login: ChatGPT device code via `account/login/start` (login.ts). API and
 *   base-URL keys arrive as `Secret`s and go into the env only.
 * - Usage: `thread/tokenUsage/updated` in-band; plan limits from
 *   `account/rateLimits/read|updated`.
 */
import {
  effectivePermissionMode,
  isPermissionModeFor,
  type LimitSample,
  type ProviderId,
  type UsageSample,
} from "@regulus/protocol";
import { SecretEnv } from "../secret.ts";
import { tmuxSessionName } from "../session.ts";
import type {
  AdapterCapabilities,
  AgentAdapter,
  AgentRecord,
  LoginFlowPlan,
  ReadUsageOptions,
  RunnerContext,
  SpawnCredential,
  SpawnPlan,
  SpawnRequest,
} from "../types.ts";
import { CodexControl, type CodexControlOptions } from "./control.ts";
import { beginDeviceLogin } from "./login.ts";
import { CodexRpcClient } from "./rpc.ts";
import { limitSamplesFromRead } from "./usage.ts";

export const CODEX_CAPABILITIES: Readonly<AdapterCapabilities> = Object.freeze({
  structured: true,
  attachTui: true,
  coDrive: false,
  resume: true,
  usageInband: true,
  limits: true,
  deviceLogin: true,
});

/** Env var a key profile's key is injected as; referenced by `env_key` below. */
export const CODEX_KEY_ENV = "OFFICE_CODEX_API_KEY";
/** Model provider id the office defines for key profiles (`-c model_providers.<id>`). */
export const CODEX_KEY_PROVIDER = "office_key";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

const SAFE_CONFIG_VALUE = /^[A-Za-z0-9._:/@+-]{1,200}$/;
const THREAD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface CodexAdapterOptions {
  /** Program used for `codex` (tests point this at a fake app-server). */
  command?: readonly string[];
  control?: CodexControlOptions;
}

/** TOML string for a `-c key=value` override; JSON strings are valid TOML basic strings. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function configArg(key: string, value: string): string[] {
  if (!SAFE_CONFIG_VALUE.test(value)) throw new Error(`Unsafe value for codex config ${key}`);
  return ["-c", `${key}=${tomlString(value)}`];
}

/**
 * Key profiles: a custom model provider that reads the key from
 * `OFFICE_CODEX_API_KEY` (`env_key`). Only the variable *name* is on the
 * command line; the key itself is in the process env (SPEC §8 rule 2).
 * Codex's default `shell_environment_policy` drops `*KEY*` variables from the
 * commands the agent runs, so the key is not exposed to tool calls either.
 */
function providerArgs(credential: SpawnCredential): string[] {
  if (credential.kind === "cli_login") return [];
  const baseUrl = credential.kind === "api_key" ? OPENAI_BASE_URL : credential.baseUrl;
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Codex base URL must be http(s)");
  }
  const name = credential.kind === "api_key" ? "OpenAI (API key)" : "Custom endpoint";
  const provider = `{ name = ${tomlString(name)}, base_url = ${tomlString(url.toString())}, env_key = ${tomlString(CODEX_KEY_ENV)}, wire_api = "responses" }`;
  return [
    "-c",
    `model_provider=${tomlString(CODEX_KEY_PROVIDER)}`,
    "-c",
    `model_providers.${CODEX_KEY_PROVIDER}=${provider}`,
  ];
}

function modelArgs(model?: string, effort?: string): string[] {
  return [
    ...(model ? configArg("model", model) : []),
    ...(effort ? configArg("model_reasoning_effort", effort) : []),
  ];
}

/**
 * The robot's approval policy (#166): the stored one, else Codex's recommended
 * `on-request` (https://learn.chatgpt.com/docs/agent-approvals-security).
 */
export function codexApprovalPolicy(mode: string | undefined): string {
  if (mode !== undefined && !isPermissionModeFor("codex", mode)) {
    throw new Error(`Invalid Codex approval policy: ${mode}`);
  }
  return effectivePermissionMode("codex", mode) ?? "on-request";
}

/**
 * HOME of the runner identity. CODEX_HOME is left at its default (`~/.codex`):
 * codex refuses an explicit CODEX_HOME that does not exist yet, while it
 * creates the default one itself on first run.
 */
export function codexEnv(ctx: RunnerContext): SecretEnv {
  return SecretEnv.of({ HOME: ctx.home });
}

export class CodexAdapter implements AgentAdapter {
  readonly id: ProviderId = "codex";
  readonly capabilities = CODEX_CAPABILITIES;
  readonly #command: readonly string[];
  readonly #controlOptions: CodexControlOptions;

  constructor(options: CodexAdapterOptions = {}) {
    this.#command = options.command ?? ["codex"];
    this.#controlOptions = options.control ?? {};
  }

  buildSpawn(req: SpawnRequest, ctx: RunnerContext): SpawnPlan {
    if (req.resumeSessionId && !THREAD_ID.test(req.resumeSessionId)) {
      throw new Error("Invalid Codex thread id");
    }
    const permissionMode = codexApprovalPolicy(req.permissionMode);
    let env = codexEnv(ctx);
    if (req.credential.kind !== "cli_login") env = env.with(CODEX_KEY_ENV, req.credential.apiKey);
    return {
      agentId: req.agentId,
      provider: this.id,
      argv: [
        ...this.#command,
        "app-server",
        ...modelArgs(req.model, req.effort),
        ...providerArgs(req.credential),
      ],
      env,
      cwd: req.workdir,
      tmuxSession: tmuxSessionName(req.agentId),
      files: [],
      providerSessionId: req.resumeSessionId,
      // Applied as `approvalPolicy` on thread/start and thread/resume (control.ts).
      permissionMode,
    };
  }

  connect(plan: SpawnPlan, ctx: RunnerContext): CodexControl {
    return new CodexControl(plan, ctx, this.#controlOptions);
  }

  /**
   * `codex resume <threadId>` in the agent's tmux session. Codex does not
   * support two live drivers of one thread from separate processes (research
   * 04: "hand-off, not co-drive"; the app-server only lets connections to the
   * *same* server rejoin a running thread via `thread/resume`). The caller must
   * `close()` the structured control first so the thread is unloaded, and
   * reconnect with `thread/resume` after the TUI exits.
   *
   * Key profiles: the returned env has no key; the server merges the profile's
   * env (from `buildSpawn`) when it runs this plan.
   */
  buildAttachTui(agent: AgentRecord, ctx: RunnerContext): SpawnPlan | null {
    const threadId = agent.providerSessionId;
    if (!threadId || !THREAD_ID.test(threadId)) return null;
    return {
      agentId: agent.agentId,
      provider: this.id,
      argv: [
        ...this.#command,
        "resume",
        ...modelArgs(agent.model, agent.effort),
        ...configArg("approval_policy", codexApprovalPolicy(agent.permissionMode)),
        threadId,
      ],
      env: codexEnv(ctx),
      cwd: agent.workdir,
      tmuxSession: agent.tmuxSession,
      files: [],
      providerSessionId: threadId,
    };
  }

  loginFlow(ctx: RunnerContext): LoginFlowPlan {
    return {
      kind: "device_code",
      begin: () => beginDeviceLogin(this.#sidePlan(ctx, "login"), ctx),
    };
  }

  /** Plan limits via a short-lived app-server (`account/rateLimits/read`). */
  async *readUsage(
    ctx: RunnerContext,
    opts: ReadUsageOptions = {},
  ): AsyncIterable<UsageSample | LimitSample> {
    if (opts.signal?.aborted) return;
    let samples: LimitSample[] = [];
    const proc = await ctx.runner.spawnPiped(this.#sidePlan(ctx, "usage"));
    const client = new CodexRpcClient(proc, { requestTimeoutMs: 15_000 });
    const abort = () => void client.close();
    opts.signal?.addEventListener("abort", abort, { once: true });
    try {
      await client.initialize();
      const res = await client.request("account/rateLimits/read", undefined);
      samples = limitSamplesFromRead(res, ctx.now());
    } catch {
      // not signed in with ChatGPT (API-key accounts have no plan limits)
    } finally {
      opts.signal?.removeEventListener("abort", abort);
      await client.close();
    }
    for (const s of samples) {
      if (opts.since === undefined || s.observedAt > opts.since) yield s;
    }
  }

  /** Side process (login, usage) in the human's runner; not an agent. */
  #sidePlan(ctx: RunnerContext, purpose: "login" | "usage"): SpawnPlan {
    const agentId = `codex-${purpose}-${ctx.userId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
    return {
      agentId,
      provider: this.id,
      argv: [...this.#command, "app-server"],
      env: codexEnv(ctx),
      cwd: ctx.home,
      tmuxSession: tmuxSessionName(agentId),
      files: [],
    };
  }
}
