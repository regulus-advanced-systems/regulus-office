/**
 * `AgentControl` for a TUI-primary Claude Code session in tmux (SPEC §7:
 * "tmux TUI is primary with hooks + statusline forwarder").
 *
 * Status, tool calls and permission requests arrive out of band through the
 * hook and statusline routes (`ClaudeCodeAdapter.ingest`), which publish
 * straight into the server's `AgentEventSink`. This control's own `events`
 * therefore carries only what it causes itself: `starting` on connect, the
 * `working` that follows an office approval, and `exit` on close.
 *
 * - `prompt` types into the pane (attachments as `@path` mentions).
 * - `respondPermission` answers a held `PermissionRequest` hook (see
 *   permissions.ts); it throws when the hook already expired, in which case
 *   the request must be answered in the terminal.
 * - `interrupt` sends Escape, Claude Code's documented interrupt key.
 * - `close` detaches: it releases held hooks and ends `events`; stopping the
 *   process is the runner's job (tmux session kill).
 * - Until the first hook of this run arrives, the pane is checked for the
 *   screens that wait for the human before hooks can fire (sign-in,
 *   onboarding, workspace trust; sign-in-screen.ts). One of them turns the
 *   robot to `waiting_input` with a fixed reason (#158).
 */
import type { AgentEvent, PermissionDecision } from "@regulus/protocol";
import { AsyncQueue } from "../async-queue.ts";
import type {
  AgentControl,
  PermissionResolvedListener,
  PromptAttachment,
  RunnerContext,
  SpawnPlan,
} from "../types.ts";
import type { PermissionBroker } from "./permissions.ts";
import {
  blockingScreenReason,
  type ClaudeBlockingScreen,
  detectBlockingScreen,
} from "./sign-in-screen.ts";

const ESCAPE = "\u001b";

/** How the control looks for blocking screens after a spawn. */
export interface ScreenWatchOptions {
  intervalMs: number;
  /** Stop looking after this long without a hook. */
  maxMs: number;
  /** Changes whenever a hook of this agent arrives (the adapter's counter). */
  hookMark: () => number;
}

export class ClaudeControl implements AgentControl {
  readonly #queue = new AsyncQueue<AgentEvent>();
  #closed = false;

  constructor(
    private readonly plan: SpawnPlan,
    private readonly ctx: RunnerContext,
    private readonly broker: PermissionBroker,
    private readonly observedSessionId: () => string | undefined,
    screens?: ScreenWatchOptions,
  ) {
    this.#queue.push({ kind: "status", ts: ctx.now(), status: "starting" });
    // A re-adopted agent (no argv: nothing was started) is past its first screens.
    if (screens && plan.argv.length > 0) void this.#watchScreens(screens);
  }

  get events(): AsyncIterable<AgentEvent> {
    return this.#queue;
  }

  async prompt(text: string, attachments: readonly PromptAttachment[] = []): Promise<void> {
    this.#assertOpen();
    const mentions = attachments.map((a) => `@${a.path}`);
    const line = [text.replace(/\r?\n/g, " "), ...mentions].join(" ").trim();
    if (!line) return;
    await this.ctx.runner.sendKeys(this.plan.tmuxSession, line, { enter: true });
  }

  async respondPermission(id: string, decision: PermissionDecision): Promise<void> {
    this.#assertOpen();
    if (!this.broker.resolve(this.plan.agentId, id, decision)) {
      throw new Error(
        `Permission request ${id} is no longer pending; answer it in the agent's terminal`,
      );
    }
    this.#queue.push({
      kind: "status",
      ts: this.ctx.now(),
      status: "working",
      reason: decision === "reject" ? "permission rejected" : "permission granted",
    });
  }

  async interrupt(): Promise<void> {
    this.#assertOpen();
    await this.ctx.runner.sendKeys(this.plan.tmuxSession, ESCAPE);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.broker.cancelAgent(this.plan.agentId);
    this.#queue.end();
  }

  providerSessionId(): string | undefined {
    return this.observedSessionId() ?? this.plan.providerSessionId;
  }

  /** Held hooks resolve one by one (answer, hold expiry, Claude giving up, turn end). */
  onPermissionResolved(listener: PermissionResolvedListener): () => void {
    return this.broker.onResolved(this.plan.agentId, listener);
  }

  /** Poll the pane until the first hook of this run, the time limit, or close. */
  async #watchScreens(opts: ScreenWatchOptions): Promise<void> {
    const mark = opts.hookMark();
    const deadline = Date.now() + opts.maxMs;
    let reported: ClaudeBlockingScreen | null = null;
    const hooked = () => opts.hookMark() !== mark;
    while (!this.#closed && !hooked() && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, opts.intervalMs);
        (timer as { unref?: () => void }).unref?.();
      });
      if (this.#closed || hooked()) return;
      let pane: string;
      try {
        pane = await this.ctx.runner.capturePane(this.plan.tmuxSession, 40);
      } catch {
        continue; // the session is not there yet, or already gone
      }
      const screen = detectBlockingScreen(pane);
      if (!screen || screen === reported || this.#closed || hooked()) continue;
      reported = screen;
      this.#queue.push({
        kind: "status",
        ts: this.ctx.now(),
        status: "waiting_input",
        reason: blockingScreenReason(screen),
      });
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Agent control is closed");
  }
}
