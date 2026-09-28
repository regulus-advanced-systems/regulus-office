/**
 * Status derivation ladder (SPEC §7; research 04 "Integration strategy" 4):
 *
 *   1. structured events (AgentControl.events)      pushed, adapter-specific
 *   2. hooks / notify (Claude http hooks → ingest)  pushed, via the hook routes
 *   3. OSC pane title                               polled
 *   4. capture-pane regex                           polled
 *   5. activity (pane output changing)              polled; stands in for transcript mtime
 *
 * Rungs 1 and 2 arrive through the manager's sink. Rungs 3 to 5 are polled
 * only for agents whose adapter has no structured channel. Every tmux agent
 * gets a cheap liveness check (`sessionExists`) so a process that exits
 * without telling anyone still turns into `exited`.
 */
import type { AgentStatus } from "@regulus/protocol";
import type { Runner, TmuxSessionRef } from "../../runners/types.ts";

export type HeuristicRung = "title" | "pane" | "activity";

export interface PaneSignals {
  title: string;
  /** Last lines of the pane. */
  pane: string;
  /** The pane text differs from the previous poll. */
  paneChanged: boolean;
  /** Milliseconds since the pane text last changed. */
  quietMs: number;
}

export const DEFAULT_IDLE_AFTER_MS = 10_000;

const TITLE_RULES: readonly [RegExp, AgentStatus][] = [
  [/permission|approv|confirm/i, "waiting_permission"],
  [/\b(error|failed|crash)/i, "error"],
  [/\b(waiting|input|ask(ing)?)\b/i, "waiting_input"],
  [/\b(working|running|busy|thinking)\b|[⠁-⣿]/i, "working"],
  [/\b(done|finished|complete)\b/i, "done"],
  [/\b(idle|ready)\b/i, "idle"],
];

const PANE_RULES: readonly [RegExp, AgentStatus][] = [
  [
    /\(y\/n\)|\[y\/n\]|do you want to (proceed|allow|make|run)|allow (this|once)|approve\?/i,
    "waiting_permission",
  ],
  [/esc to interrupt|ctrl\+c to (interrupt|cancel)|press esc to stop/i, "working"],
];

/** The highest rung that says something, or undefined. Pure; unit tested. */
export function deriveHeuristicStatus(
  s: PaneSignals,
  idleAfterMs = DEFAULT_IDLE_AFTER_MS,
): { status: AgentStatus; rung: HeuristicRung } | undefined {
  for (const [re, status] of TITLE_RULES) if (re.test(s.title)) return { status, rung: "title" };
  const tail = s.pane.split("\n").slice(-15).join("\n");
  for (const [re, status] of PANE_RULES) if (re.test(tail)) return { status, rung: "pane" };
  if (s.paneChanged) return { status: "working", rung: "activity" };
  if (s.quietMs >= idleAfterMs) return { status: "idle", rung: "activity" };
  return undefined;
}

export interface WatchedAgent {
  agentId: string;
  runner: Runner;
  session: TmuxSessionRef;
  /** Poll title/pane (rungs 3 to 5): only for adapters without a structured channel. */
  heuristics: boolean;
}

export interface SessionWatcherOptions {
  intervalMs?: number;
  idleAfterMs?: number;
  now?: () => number;
  /** The session is gone (process exited, killed outside the office). */
  onGone(agentId: string): void | Promise<void>;
  /** A heuristic rung derived a new status. */
  onStatus(agentId: string, status: AgentStatus, rung: HeuristicRung): void | Promise<void>;
  onError?(agentId: string, err: unknown): void;
}

interface WatchState {
  agent: WatchedAgent;
  lastPane?: string;
  lastChange: number;
  lastDerived?: AgentStatus;
}

export class SessionWatcher {
  readonly #agents = new Map<string, WatchState>();
  readonly #opts: SessionWatcherOptions;
  #timer: ReturnType<typeof setInterval> | undefined;
  #polling = false;

  constructor(opts: SessionWatcherOptions) {
    this.#opts = opts;
  }

  watch(agent: WatchedAgent): void {
    this.#agents.set(agent.agentId, { agent, lastChange: this.#now() });
    if (!this.#timer) {
      this.#timer = setInterval(() => void this.poll(), this.#opts.intervalMs ?? 2000);
      this.#timer.unref?.();
    }
  }

  unwatch(agentId: string): void {
    this.#agents.delete(agentId);
    if (this.#agents.size === 0) this.stop();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** One polling round (also called directly by tests). */
  async poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      await Promise.all([...this.#agents.values()].map((w) => this.#pollOne(w)));
    } finally {
      this.#polling = false;
    }
  }

  async #pollOne(w: WatchState): Promise<void> {
    const { agent } = w;
    try {
      if (!(await agent.runner.sessionExists(agent.session))) {
        this.unwatch(agent.agentId);
        await this.#opts.onGone(agent.agentId);
        return;
      }
      if (!agent.heuristics) return;
      const [title, pane] = await Promise.all([
        agent.runner.paneTitle(agent.session),
        agent.runner.capturePane(agent.session, 40),
      ]);
      const now = this.#now();
      const paneChanged = w.lastPane !== undefined && w.lastPane !== pane;
      if (paneChanged || w.lastPane === undefined) w.lastChange = now;
      w.lastPane = pane;
      const derived = deriveHeuristicStatus(
        { title, pane, paneChanged, quietMs: now - w.lastChange },
        this.#opts.idleAfterMs,
      );
      if (derived && derived.status !== w.lastDerived) {
        w.lastDerived = derived.status;
        await this.#opts.onStatus(agent.agentId, derived.status, derived.rung);
      }
    } catch (err) {
      this.#opts.onError?.(agent.agentId, err);
    }
  }

  #now(): number {
    return (this.#opts.now ?? Date.now)();
  }
}
