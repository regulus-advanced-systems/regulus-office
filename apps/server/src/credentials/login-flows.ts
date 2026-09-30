/**
 * CLI subscription logins driven from the office UI (SPEC §7 login column,
 * §8 rule 1). The unmodified CLI does the login inside the human's own
 * runner and writes its credential into that runner's HOME; the office only
 * starts it, shows what the CLI shows, and asks the CLI whether it worked.
 *
 * - Codex: the adapter's device-code flow (`account/login/start
 *   {chatgptDeviceCode}` on a short-lived app-server). The office relays
 *   `verificationUrl` + `userCode` and waits for `account/login/completed`.
 * - Claude Code: `claude auth login` in a login session (a tmux session in
 *   the runner that is not an agent), opened by the human as
 *   `/ws/term/login-<id>`. Success is `claude auth status` exiting 0. Then
 *   the CLI's onboarding is marked complete in the runner (#158: `auth
 *   login` alone leaves it open, and the first robot would ask to sign in
 *   again); only that flag in `~/.claude.json`, never a credential.
 *
 * Flows are in memory, visible only to the human who started them, one per
 * human and provider, and end on success, cancel or timeout; their login
 * session is killed and unregistered from the bridge then.
 */
import { type AdapterRegistry, ensureClaudeOnboarding } from "@regulus/agent-adapters";
import {
  CLI_LOGIN_PROVIDERS,
  type CliLoginProvider,
  type LoginFlowInfo,
  type LoginFlowState,
  type ProviderLoginStatus,
} from "@regulus/protocol";
import { type StartFailure, safeReason, startFailure } from "../agents/manager/failure.ts";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import { AuthHttpError, forbidden } from "../auth/errors.ts";
import type { Db } from "../db/index.ts";
import type { Logger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import type { LoginSessionTargets } from "../terminals/login-sessions.ts";
import { CliMissingError, cliInstalled, requireCli } from "./cli-probe.ts";
import {
  type CliCommands,
  cliLoggedIn,
  DEFAULT_CLI_COMMANDS,
  runnerContext,
} from "./cli-status.ts";
import type { CredentialActor } from "./http.ts";

export const CLAUDE_AUTH_LOGIN_INSTRUCTIONS =
  "Claude Code's own sign-in (claude auth login) is running in this terminal. Choose your " +
  "Claude subscription, open the link it prints in your browser and sign in. If the browser " +
  "shows a code, paste it at the prompt here and press Enter. Claude Code keeps the login in " +
  "your runner's HOME; Regulus Office never sees it.";

export interface LoginFlowsOptions {
  db: Db;
  runner: Runner;
  adapters: Pick<AdapterRegistry, "get">;
  logins: LoginSessionTargets;
  officeUrl: string;
  logger: Logger;
  commands?: CliCommands;
  now?: () => number;
  /** How long a flow may stay pending (default 15 min). */
  ttlMs?: number;
  /** How long a finished flow stays readable (default 5 min). */
  keepMs?: number;
  /** Cache of connected/not connected per human and provider (default 30 s). */
  statusTtlMs?: number;
  /** Least time between two `claude auth status` checks of one flow (default 3 s). */
  checkIntervalMs?: number;
  statusTimeoutMs?: number;
}

interface Flow {
  info: LoginFlowInfo;
  userId: string;
  cancel: () => Promise<void>;
  expiry: ReturnType<typeof setTimeout>;
  /** Claude: when the CLI was last asked, and the check in flight. */
  lastCheckAt?: number;
  checking?: Promise<void>;
  check?: () => Promise<Exclude<LoginFlowState, "pending"> | null>;
  /** Codex: settles when the CLI reports the outcome (attached once the flow is registered). */
  completion?: Promise<Exclude<LoginFlowState, "pending">>;
}

const GENERIC_REASONS: Partial<Record<LoginFlowState, string>> = {
  failed: "The CLI reported that the sign-in did not complete.",
  expired: "The sign-in timed out. Start it again.",
  cancelled: "Cancelled.",
};

export class LoginFlows {
  readonly #opts: LoginFlowsOptions;
  readonly #log: Logger;
  readonly #flows = new Map<string, Flow>();
  readonly #status = new Map<string, ProviderLoginStatus>();

  constructor(options: LoginFlowsOptions) {
    this.#opts = options;
    this.#log = options.logger.child({ component: "provider-logins" });
  }

  get #now(): number {
    return (this.#opts.now ?? Date.now)();
  }

  get #commands(): CliCommands {
    return this.#opts.commands ?? DEFAULT_CLI_COMMANDS;
  }

  /** Connected or not, per CLI provider, from the CLI's own status (cached briefly). */
  async status(actor: CredentialActor): Promise<ProviderLoginStatus[]> {
    const ttl = this.#opts.statusTtlMs ?? 30_000;
    const out: ProviderLoginStatus[] = [];
    for (const provider of CLI_LOGIN_PROVIDERS) {
      const key = `${actor.id}:${provider}`;
      const cached = this.#status.get(key);
      if (cached && this.#now - cached.checkedAt < ttl) {
        out.push(cached);
        continue;
      }
      const connected = await this.#ask(actor.id, provider);
      const fresh = { provider, connected, checkedAt: this.#now };
      this.#status.set(key, fresh);
      out.push(fresh);
    }
    return out;
  }

  async start(actor: CredentialActor, provider: CliLoginProvider): Promise<LoginFlowInfo> {
    if (actor.role === "viewer") throw forbidden("viewers_cannot_connect");
    for (const [id, flow] of this.#flows) {
      if (flow.userId === actor.id && flow.info.provider === provider) {
        await this.#end(id, "cancelled");
      }
    }
    const loginId = crypto.randomUUID();
    const expiresAt = this.#now + (this.#opts.ttlMs ?? 15 * 60_000);
    let flow: Flow;
    try {
      flow =
        provider === "codex"
          ? await this.#startCodex(actor.id, loginId, expiresAt)
          : await this.#startClaude(actor.id, loginId, expiresAt);
    } catch (err) {
      if (err instanceof AuthHttpError) throw err;
      const { code, message } = await this.#whyNot(actor.id, provider, err);
      this.#log.warn(
        { provider, code, reason: message, err: { name: (err as Error).name } },
        "login could not start",
      );
      // The human sees the classified cause (#151); `message` is already safe (safeReason).
      throw new AuthHttpError(502, "login_unavailable", { cause: code, reason: message });
    }
    this.#flows.set(loginId, flow);
    void flow.completion?.then((state) => this.#end(loginId, state));
    writeAudit(this.#opts.db, {
      userId: actor.id,
      action: AUDIT_ACTIONS.providerLoginStart,
      targetKind: "provider_login",
      targetId: loginId,
      meta: { provider, kind: flow.info.kind },
    });
    this.#log.info({ loginId, provider, kind: flow.info.kind }, "provider login started");
    return { ...flow.info };
  }

  /** The flow's state; a pending Claude flow asks the CLI (at most every few seconds). */
  async get(actor: CredentialActor, loginId: string): Promise<LoginFlowInfo> {
    const flow = this.#own(actor, loginId);
    if (flow.info.state === "pending" && flow.check) {
      const interval = this.#opts.checkIntervalMs ?? 3_000;
      if (
        !flow.checking &&
        (flow.lastCheckAt === undefined || this.#now - flow.lastCheckAt >= interval)
      ) {
        flow.lastCheckAt = this.#now;
        const check = flow.check;
        flow.checking = check()
          .then(async (state) => {
            if (state) await this.#end(loginId, state);
          })
          .catch(() => {})
          .finally(() => {
            flow.checking = undefined;
          });
      }
      await flow.checking;
    }
    return { ...flow.info };
  }

  async cancel(actor: CredentialActor, loginId: string): Promise<void> {
    const flow = this.#own(actor, loginId);
    if (flow.info.state === "pending") await this.#end(loginId, "cancelled");
  }

  /** Server shutdown: cancel pending flows (kills login sessions, stops device polling). */
  async shutdown(): Promise<void> {
    for (const [id, flow] of this.#flows) {
      if (flow.info.state === "pending") await this.#end(id, "cancelled");
      clearTimeout(flow.expiry);
    }
    this.#flows.clear();
  }

  #own(actor: CredentialActor, loginId: string): Flow {
    const flow = this.#flows.get(loginId);
    // Someone else's login is indistinguishable from a missing one.
    if (!flow || flow.userId !== actor.id) throw new AuthHttpError(404, "not_found");
    return flow;
  }

  /**
   * Why a login could not start, safe to show (#151): the runner's or
   * Docker's own cause, `cli_missing` only when `command -v` cannot find the
   * CLI, and a fixed text for anything else (CLI output is never forwarded).
   */
  async #whyNot(userId: string, provider: CliLoginProvider, err: unknown): Promise<StartFailure> {
    let failure = startFailure(err);
    if (failure.code === "start_failed" && provider === "codex") {
      const bin = this.#commands.codex[0] ?? "codex";
      const missing = await runnerContext(
        this.#opts.runner,
        userId,
        this.#opts.officeUrl,
        () => this.#now,
      )
        .then((ctx) => cliInstalled(ctx, bin))
        .then((found) => !found)
        .catch(() => false);
      if (missing) failure = startFailure(new CliMissingError(bin));
    }
    if (failure.code === "start_failed") {
      failure = { code: "start_failed", message: "the CLI stopped before the sign-in began" };
    }
    return { code: failure.code, message: safeReason(failure.message) };
  }

  async #ask(userId: string, provider: CliLoginProvider): Promise<boolean | null> {
    try {
      const ctx = await runnerContext(
        this.#opts.runner,
        userId,
        this.#opts.officeUrl,
        () => this.#now,
      );
      return await cliLoggedIn(provider, ctx, this.#commands, this.#opts.statusTimeoutMs);
    } catch {
      return null;
    }
  }

  #expiry(loginId: string, expiresAt: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(
      () => void this.#end(loginId, "expired"),
      Math.max(0, expiresAt - this.#now),
    );
    (timer as { unref?: () => void }).unref?.();
    return timer;
  }

  async #startCodex(userId: string, loginId: string, expiresAt: number): Promise<Flow> {
    const ctx = await runnerContext(
      this.#opts.runner,
      userId,
      this.#opts.officeUrl,
      () => this.#now,
    );
    const plan = this.#opts.adapters.get("codex").loginFlow(ctx);
    if (plan.kind !== "device_code") throw new Error("codex login is not a device code flow");
    const login = await plan.begin();
    if (!/^https:\/\//.test(login.verificationUrl)) {
      await login.cancel();
      throw new AuthHttpError(502, "login_unavailable");
    }
    return {
      userId,
      info: {
        loginId,
        provider: "codex",
        kind: "device_code",
        state: "pending",
        verificationUrl: login.verificationUrl,
        userCode: login.userCode,
        expiresAt: Math.min(expiresAt, login.expiresAt ?? expiresAt),
      },
      cancel: () => login.cancel(),
      completion: login.completion.then(
        (outcome) => (outcome.ok ? "succeeded" : "failed"),
        () => "failed" as const,
      ),
      expiry: this.#expiry(loginId, expiresAt),
    };
  }

  async #startClaude(userId: string, loginId: string, expiresAt: number): Promise<Flow> {
    const { runner, logins } = this.#opts;
    const ctx = await runnerContext(runner, userId, this.#opts.officeUrl, () => this.#now);
    const plan = this.#opts.adapters.get("claude-code").loginFlow(ctx);
    if (plan.kind !== "pty_paste_code") throw new Error("claude login is not a terminal flow");
    // A missing CLI would only show up as a login terminal that closes at once.
    await requireCli(ctx, plan.plan.argv[0] ?? "claude");
    const terminalId = plan.plan.agentId;
    const session = { userId, name: plan.plan.tmuxSession };
    const agentRef = { userId, agentId: terminalId };
    // A leftover login session of this human (earlier flow, office restart) is replaced.
    logins.unregister(terminalId);
    await runner.kill(agentRef).catch(() => {});
    await runner.exec({ userId }, { ...plan.plan, argv: [...plan.plan.argv, "auth", "login"] });
    logins.register({ terminalId, ownerUserId: userId, session, runner });
    const cleanup = async () => {
      logins.unregister(terminalId);
      await runner.kill(agentRef).catch(() => {});
    };
    return {
      userId,
      info: {
        loginId,
        provider: "claude-code",
        kind: "pty_paste_code",
        state: "pending",
        terminalId,
        instructions: CLAUDE_AUTH_LOGIN_INSTRUCTIONS,
        expiresAt,
      },
      cancel: cleanup,
      expiry: this.#expiry(loginId, expiresAt),
      check: async () => {
        const loggedIn = await cliLoggedIn(
          "claude-code",
          ctx,
          this.#commands,
          this.#opts.statusTimeoutMs,
        );
        if (loggedIn) {
          const { outcome } = await ensureClaudeOnboarding(ctx);
          this.#log.info({ loginId, outcome }, "claude onboarding step after sign-in");
          return "succeeded";
        }
        // The login command exited without a login: nothing left to wait for.
        if (!(await runner.sessionExists(session).catch(() => true))) return "failed";
        return null;
      },
    };
  }

  async #end(loginId: string, state: Exclude<LoginFlowState, "pending">): Promise<void> {
    const flow = this.#flows.get(loginId);
    if (!flow || flow.info.state !== "pending") return;
    flow.info.state = state;
    const reason = GENERIC_REASONS[state];
    if (reason) flow.info.reason = reason;
    clearTimeout(flow.expiry);
    // Codex has already stopped on success/failure; its cancel is then a no-op.
    await flow.cancel().catch(() => {});
    this.#status.delete(`${flow.userId}:${flow.info.provider}`);
    writeAudit(this.#opts.db, {
      userId: flow.userId,
      action: AUDIT_ACTIONS.providerLoginFinish,
      targetKind: "provider_login",
      targetId: loginId,
      meta: { provider: flow.info.provider, outcome: state },
    });
    this.#log.info(
      { loginId, provider: flow.info.provider, outcome: state },
      "provider login ended",
    );
    const keep = setTimeout(() => this.#flows.delete(loginId), this.#opts.keepMs ?? 5 * 60_000);
    (keep as { unref?: () => void }).unref?.();
  }
}
