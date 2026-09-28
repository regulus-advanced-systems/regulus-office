/**
 * Claude Code adapter (SPEC §7 row "Claude Code", §8 credential rules).
 *
 * Runs the unmodified `claude` binary in the human's runner, TUI in tmux as
 * the primary surface, observed through http hooks and a statusline
 * forwarder registered with `--settings`. The office never reads, stores,
 * copies or forwards Claude OAuth credentials: subscription users log in
 * with `/login` in their own terminal (`pty_paste_code`), and only API keys
 * or base-URL plan keys, handed in as `Secret`, reach the process env.
 */
import type { AgentEvent, LimitSample, UsageSample } from "@regulus/protocol";
import { tmuxSessionName } from "../session.ts";
import type {
  AdapterCapabilities,
  AgentAdapter,
  AgentRecord,
  LoginFlowPlan,
  OutOfBandInput,
  ReadUsageOptions,
  RunnerContext,
  SpawnPlan,
  SpawnRequest,
} from "../types.ts";
import { ClaudeControl } from "./control.ts";
import { mapHookPayload, payloadSessionId } from "./hooks.ts";
import { PermissionBroker } from "./permissions.ts";
import { baseEnv, buildClaudeSpawn, checkModel, hookFiles } from "./spawn.ts";
import { limitSamplesFromStatusline, StatuslineUsageTracker } from "./statusline.ts";
import { scanTranscripts } from "./transcript.ts";

export interface ClaudeCodeAdapterOptions {
  /** Program to run, `claude` by default (tests point this at a fake script). */
  command?: string;
  /**
   * How long a PermissionRequest hook is held open for an office decision,
   * in seconds (default 120). After that Claude Code's own dialog decides.
   */
  permissionHoldSeconds?: number;
  newSessionId?: () => string;
  newRequestId?: () => string;
}

export const CLAUDE_CODE_CAPABILITIES: AdapterCapabilities = {
  structured: true,
  attachTui: true,
  coDrive: false,
  resume: true,
  usageInband: true,
  limits: true,
  deviceLogin: false,
};

export const CLAUDE_LOGIN_INSTRUCTIONS =
  "Claude Code is starting in your own terminal. Type /login, pick your Claude account, " +
  "open the link in your browser and, if the browser shows a code, paste it at the " +
  '"Paste code here if prompted" prompt. Claude Code stores the login in your runner\'s ' +
  "HOME; Regulus Office never sees it.";

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = "claude-code" as const;
  readonly capabilities: Readonly<AdapterCapabilities> = Object.freeze({
    ...CLAUDE_CODE_CAPABILITIES,
  });
  /** Held PermissionRequest hooks; shared by the hook route and every control. */
  readonly permissions = new PermissionBroker();
  readonly permissionHoldSeconds: number;
  readonly #command: string;
  readonly #newSessionId: () => string;
  readonly #newRequestId: () => string;
  readonly #usage = new StatuslineUsageTracker();
  /** Latest session id seen in a hook/statusline payload, per agent. */
  readonly #sessions = new Map<string, string>();
  /** Latest statusline limit readings, per office user. */
  readonly #limits = new Map<string, LimitSample[]>();

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.#command = options.command ?? "claude";
    this.permissionHoldSeconds = Math.max(1, Math.floor(options.permissionHoldSeconds ?? 120));
    this.#newSessionId = options.newSessionId ?? (() => crypto.randomUUID());
    this.#newRequestId = options.newRequestId ?? (() => `perm-${crypto.randomUUID()}`);
  }

  buildSpawn(req: SpawnRequest, ctx: RunnerContext): SpawnPlan {
    return buildClaudeSpawn(req, ctx, {
      command: this.#command,
      permissionHoldSeconds: this.permissionHoldSeconds,
      newSessionId: this.#newSessionId,
    });
  }

  connect(plan: SpawnPlan, ctx: RunnerContext): ClaudeControl {
    return new ClaudeControl(plan, ctx, this.permissions, () => this.#sessions.get(plan.agentId));
  }

  /**
   * `claude --resume <id>` in the agent's tmux session, for re-opening the
   * TUI after the process exited (Claude Code does not support two drivers
   * of one session, so this is a hand-off). Hooks are re-registered when the
   * context carries the agent token. Credential env for API-key profiles is
   * not known here; the caller merges it like a spawn.
   */
  buildAttachTui(agent: AgentRecord, ctx: RunnerContext): SpawnPlan | null {
    const sessionId = this.#sessions.get(agent.agentId) ?? agent.providerSessionId;
    if (!sessionId) return null;
    const { files, settingsPath } = hookFiles(agent.agentId, ctx, this.permissionHoldSeconds);
    const argv = [this.#command];
    if (settingsPath) argv.push("--settings", settingsPath);
    argv.push("--resume", sessionId);
    if (agent.model) argv.push("--model", checkModel(agent.model));
    return {
      agentId: agent.agentId,
      provider: this.id,
      argv,
      env: baseEnv(ctx),
      cwd: agent.workdir,
      tmuxSession: agent.tmuxSession,
      files,
      providerSessionId: sessionId,
    };
  }

  /** Subscription login is `/login` inside the unmodified CLI, in the human's terminal. */
  loginFlow(ctx: RunnerContext): LoginFlowPlan {
    const agentId = `login-${ctx.userId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50) || "user"}`;
    return {
      kind: "pty_paste_code",
      instructions: CLAUDE_LOGIN_INSTRUCTIONS,
      plan: {
        agentId,
        provider: this.id,
        argv: [this.#command],
        env: baseEnv(ctx),
        cwd: ctx.home,
        tmuxSession: tmuxSessionName(agentId),
        files: [],
      },
    };
  }

  /** Latest statusline limits for this human, then transcript usage. */
  async *readUsage(
    ctx: RunnerContext,
    opts: ReadUsageOptions = {},
  ): AsyncIterable<UsageSample | LimitSample> {
    for (const sample of this.#limits.get(ctx.userId) ?? []) {
      if (opts.since === undefined || sample.observedAt > opts.since) yield sample;
    }
    yield* scanTranscripts(ctx.runner, ctx.home, opts);
  }

  ingest(input: OutOfBandInput, ctx: RunnerContext): AgentEvent[] {
    const sessionId = payloadSessionId(input.payload);
    if (sessionId) this.#sessions.set(input.agentId, sessionId);
    const now = ctx.now();
    if (input.channel === "hook") {
      return mapHookPayload(input.payload, { now, newRequestId: this.#newRequestId });
    }
    if (input.channel === "statusline") {
      const limits = limitSamplesFromStatusline(input.payload, now);
      if (limits.length > 0) this.#limits.set(ctx.userId, limits);
      const usage = this.#usage.sample(input.agentId, input.payload, now);
      return [
        ...(usage ? [{ ...usage, kind: "usage" as const }] : []),
        ...limits.map((l) => ({ ...l, kind: "limit" as const, ts: now })),
      ];
    }
    return [];
  }

  /** Forget per-agent state once the agent is gone. */
  forget(agentId: string): void {
    this.#sessions.delete(agentId);
    this.#usage.forget(agentId);
    this.permissions.cancelAgent(agentId);
  }
}
