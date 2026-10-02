/**
 * The meeting orchestrator (#50): one async run per live meeting (run.ts),
 * halting (pause, stop, budget, failed turns), resuming, re-starting live
 * meetings on boot, and the AgentManager observers that tell it when a member
 * henchman's status changes and how many tokens it used.
 *
 * Halting aborts the run, marks its running turns failed (a resume asks them
 * again) and interrupts the members that are busy. The henchmen stay at their
 * desks; only a finished meeting adjourns (close.ts).
 */
import type { AgentEvent, MeetingStatus } from "@regulus/protocol";
import type { AgentObserver, AgentUsageObserver } from "../agents/manager/runtime.ts";
import type { OperationActor } from "../operations/access.ts";
import { releaseIfEmpty } from "./close.ts";
import { budgetReason, convene, message, type RunContext, runAgenda } from "./run.ts";
import { BUSY, MeetingAborted, TurnError, TurnWatch } from "./turns.ts";

export interface EngineOptions
  extends Omit<RunContext, "watch" | "now" | "pollMs" | "readyTimeoutMs"> {
  /** The starter as an actor (their current office role), or null when they are gone. */
  actorFor(userId: string): OperationActor | null;
  pollMs?: number;
  readyTimeoutMs?: number;
  now?: () => number;
}

export class MeetingEngine {
  readonly ctx: RunContext;
  readonly #runs = new Map<string, AbortController>();
  readonly #actorFor: (userId: string) => OperationActor | null;
  #closed = false;

  constructor(opts: EngineOptions) {
    const { actorFor, ...rest } = opts;
    this.#actorFor = actorFor;
    this.ctx = {
      ...rest,
      watch: new TurnWatch(),
      pollMs: opts.pollMs ?? 3000,
      readyTimeoutMs: opts.readyTimeoutMs ?? 5 * 60_000,
      now: opts.now ?? Date.now,
    };
  }

  /** Is a run going for this meeting in this process? */
  running(meetingId: string): boolean {
    return this.#runs.has(meetingId);
  }

  /** Start (or continue) a `starting` or `running` meeting in the background. */
  launch(meetingId: string): void {
    if (this.#closed || this.#runs.has(meetingId)) return;
    const abort = new AbortController();
    this.#runs.set(meetingId, abort);
    void this.#run(meetingId, abort).finally(() => {
      if (this.#runs.get(meetingId) === abort) this.#runs.delete(meetingId);
    });
  }

  async #run(meetingId: string, abort: AbortController): Promise<void> {
    const { store, logger } = this.ctx;
    const row = store.get(meetingId);
    if (!row) return;
    const starter = this.#actorFor(row.startedBy);
    if (!starter) {
      await this.halt(meetingId, "failed", "the meeting's starter is no longer in the office");
      return;
    }
    try {
      if (row.status === "starting") await convene(this.ctx, row, starter, abort.signal);
      await runAgenda(this.ctx, meetingId, starter, abort.signal, (status, reason) =>
        this.halt(meetingId, status, reason),
      );
    } catch (err) {
      if (err instanceof MeetingAborted || abort.signal.aborted) return;
      const current = store.get(meetingId)?.status;
      if (err instanceof TurnError && current === "running") {
        await this.halt(meetingId, "paused", `${err.message}; resume to try the turn again`);
        return;
      }
      logger.warn({ meetingId, err: message(err) }, "meeting failed");
      await this.halt(meetingId, "failed", message(err));
    }
  }

  /**
   * Stop the run and record why. Running turns are marked failed (a resume
   * asks them again) and busy members are interrupted, as the starter.
   */
  async halt(
    meetingId: string,
    status: MeetingStatus,
    reason: string,
    opts: { interrupt?: boolean } = {},
  ): Promise<void> {
    const { store, henchmen, logger } = this.ctx;
    this.#runs.get(meetingId)?.abort();
    this.#runs.delete(meetingId);
    const row = store.get(meetingId);
    if (!row) return;
    const running = store.turns(meetingId).filter((t) => t.status === "running");
    store.setStatus(meetingId, status, reason);
    for (const t of running)
      store.finishTurn(meetingId, t.step, t.position, "failed", `(${reason})`);
    const starter = this.#actorFor(row.startedBy);
    const members = store.members(meetingId);
    for (const t of opts.interrupt === false ? [] : running) {
      const agentId = members[t.position]?.agentId;
      const s = agentId ? henchmen.status(agentId) : undefined;
      if (!starter || !agentId || !s || !BUSY.includes(s)) continue;
      await henchmen.interrupt(starter, agentId).catch((err) => {
        logger.debug({ meetingId, agentId, err: String(err) }, "interrupt failed");
      });
    }
    this.ctx.publish(meetingId);
    if (status === "failed" || status === "stopped") await releaseIfEmpty(this.ctx, meetingId);
  }

  /** Re-start every meeting that was starting or running when the office stopped. */
  boot(): void {
    for (const row of this.ctx.store.withStatus(["starting", "running"])) this.launch(row.id);
    void this.sweep();
  }

  /** Remove the worktrees of finished meetings whose henchmen all went home. */
  async sweep(): Promise<number> {
    let released = 0;
    for (const row of this.ctx.store.finishedWithWorktree()) {
      if (await releaseIfEmpty(this.ctx, row.id)) released++;
    }
    return released;
  }

  /** AgentManager observer: member status changes end turns and refresh the meeting. */
  readonly observer: AgentObserver = {
    statusChanged: (view) => {
      this.ctx.watch.statusChanged(view.agentId, view.status);
      const member = this.ctx.store.meetingOfAgent(view.agentId);
      if (member) this.ctx.publish(member.meeting.id);
    },
    pullRequestOpened: () => {},
  };

  /** Usage tracker hook: count members' tokens, halt a meeting past its budget. */
  readonly usage: AgentUsageObserver = {
    agentEvent: (agentId: string, event: AgentEvent) => {
      if (event.kind !== "usage") return;
      const tokens = event.inputTokens + event.outputTokens;
      if (tokens <= 0) return;
      const member = this.ctx.store.meetingOfAgent(agentId);
      if (!member || member.meeting.status !== "running") return;
      const id = member.meeting.id;
      const used = this.ctx.store.addTokens(id, tokens, [member.position]);
      if (used >= member.meeting.tokenBudget) {
        void this.halt(id, "stopped", budgetReason(used, member.meeting.tokenBudget));
      } else {
        this.ctx.publish(id);
      }
    },
  };

  /** Stop every run without changing any meeting (office shutdown): they resume on boot. */
  close(): void {
    this.#closed = true;
    for (const abort of this.#runs.values()) abort.abort();
    this.#runs.clear();
  }
}
