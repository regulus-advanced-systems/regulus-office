/**
 * The workflow engine (#155): GitHub events in, queued runs out, runs
 * started within their limits.
 *
 * For each verified event from the #35 bus (webhook or poll):
 *  1. it is kept in the event log (for dry runs);
 *  2. loop protection: events the office's App caused (`fromOfficeApp`),
 *     comments carrying the office's hidden marker, and stale replays are
 *     ignored;
 *  3. every enabled workflow of the event's operations is matched (trigger, then
 *     the filters the event can answer);
 *  4. guards: the daily run limit and token budget, and the per-target
 *     cooldown (commands excepted) → a `skipped` run with the reason;
 *  5. a `queued` run is inserted; (workflow, delivery id) is unique, so a
 *     redelivered or re-polled event never runs twice.
 *
 * The pump starts queued runs oldest first, at most `concurrency` per
 * workflow and `maxParallel` in the office. Schedules are checked every
 * `tickMs`. Runs that were `running` when the office stopped are failed at
 * boot; queued ones survive and start.
 */

import type { AnyGitHubEvent, GitHubEventBus } from "../github/events.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import { contextFromEvent, type WorkflowContext } from "./context.ts";
import { dueSlot, parseCron } from "./cron.ts";
import type { EventLog } from "./event-log.ts";
import { matchWorkflow } from "./match.ts";
import type { RunRow, RunStore } from "./runs.ts";
import type { StoredWorkflow, WorkflowStore } from "./store.ts";
import { targetFromContext, targetKey } from "./target.ts";

export interface EngineDeps {
  store: WorkflowStore;
  runs: RunStore;
  events: EventLog;
  repos: Pick<RepoAccess, "listOperationRepos">;
  execute(row: RunRow, wf: StoredWorkflow, signal: AbortSignal): Promise<void>;
  /** Remove what a run left behind (sandbox, checkout) when the office stopped mid-run. */
  cleanup?(runId: string, operationId: string): Promise<void>;
  logger: Logger;
  now?: () => number;
  /** Runs at once across the office (default 3; the 8 vCPU VM, D11). */
  maxParallel?: number;
  tickMs?: number;
}

/** Why an event is ignored before any workflow looks at it; null when it may trigger. */
export function loopReason(ctx: WorkflowContext): string | null {
  if (ctx.fromOfficeApp) return "caused by the office's own GitHub App";
  if (ctx.comment?.fromOffice) return "a comment the office posted";
  if (ctx.stale) return "a stale replay of an old delivery";
  return null;
}

export class WorkflowEngine {
  readonly #d: EngineDeps;
  readonly #now: () => number;
  readonly #active = new Map<
    string,
    { workflowId: string; abort: AbortController; done: Promise<void> }
  >();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: EngineDeps) {
    this.#d = deps;
    this.#now = deps.now ?? Date.now;
  }

  /** Subscribe to the GitHub event bus; returns the unsubscribe function. */
  follow(bus: Pick<GitHubEventBus, "on">): () => void {
    return bus.on("*", (event) => this.onEvent(event));
  }

  onEvent(event: AnyGitHubEvent): void {
    if (event.name === "installation" || event.name === "installation_repositories") return;
    if (event.operationIds.length === 0) return;
    const ctx = contextFromEvent(event);
    try {
      this.#d.events.record(ctx);
    } catch (err) {
      this.#d.logger.warn({ err }, "recording a workflow event failed");
    }
    this.consider(ctx);
  }

  /** Queue runs for the workflows this context triggers; returns the new run ids. */
  consider(ctx: WorkflowContext, only?: StoredWorkflow[]): string[] {
    const loop = loopReason(ctx);
    if (loop) {
      this.#d.logger.debug({ deliveryId: ctx.deliveryId, reason: loop }, "workflow event ignored");
      return [];
    }
    const queued: string[] = [];
    for (const wf of only ?? this.#d.store.enabledOn(ctx.operationIds)) {
      if (!matchWorkflow(wf.spec, ctx).matched) continue;
      const skip = this.guard(wf, ctx);
      const row = this.#d.runs.insert({
        workflowId: wf.id,
        operationId: wf.operationId,
        deliveryId: ctx.deliveryId,
        trigger: ctx.event,
        target: targetFromContext(ctx),
        targetKey: targetKey(ctx),
        context: ctx,
        provider: wf.spec.henchman.provider,
        model: wf.spec.henchman.model ?? null,
        status: skip ? "skipped" : "queued",
        reason: skip,
        now: this.#now(),
      });
      if (!row) {
        this.#d.logger.debug(
          { workflowId: wf.id, deliveryId: ctx.deliveryId },
          "duplicate delivery",
        );
        continue;
      }
      if (!skip) queued.push(row.id);
    }
    if (queued.length > 0) this.pump();
    return queued;
  }

  /** Null when the workflow may run for this context now, else why not. */
  guard(wf: StoredWorkflow, ctx: WorkflowContext): string | null {
    const limits = wf.spec.limits;
    const today = this.#d.runs.today(wf.id, this.#now());
    if (today.runs >= limits.dailyMaxRuns) {
      return `daily_run_limit: ${limits.dailyMaxRuns} runs today already`;
    }
    if (today.tokens >= limits.dailyTokenBudget) {
      return `daily_token_budget: ${today.tokens} of ${limits.dailyTokenBudget} tokens used today`;
    }
    const key = targetKey(ctx);
    if (wf.spec.trigger.kind !== "command" && key && limits.cooldownMinutes > 0) {
      const last = this.#d.runs.lastForTarget(wf.id, key);
      if (last !== null && this.#now() - last < limits.cooldownMinutes * 60_000) {
        return `cooldown: ran for ${key} less than ${limits.cooldownMinutes} min ago`;
      }
    }
    return null;
  }

  /** Start queued runs while limits allow. */
  pump(): void {
    const max = this.#d.maxParallel ?? 3;
    for (const row of this.#d.runs.queued()) {
      if (this.#active.size >= max) return;
      const wf = this.#d.store.get(row.workflowId);
      if (!wf || !wf.spec.enabled) {
        this.#d.runs.finish(row.id, {
          status: "cancelled",
          reason: "workflow_disabled: the workflow was turned off or deleted",
          now: this.#now(),
          log: [],
        });
        continue;
      }
      const running = [...this.#active.values()].filter((a) => a.workflowId === wf.id).length;
      if (running >= wf.spec.limits.concurrency) continue;
      if (!this.#d.runs.start(row.id, this.#now())) continue;
      const abort = new AbortController();
      const done = this.#d
        .execute(row, wf, abort.signal)
        .catch((err) => this.#d.logger.error({ err, runId: row.id }, "workflow run crashed"))
        .finally(() => {
          this.#active.delete(row.id);
          this.pump();
        });
      this.#active.set(row.id, { workflowId: wf.id, abort, done });
    }
  }

  /** Cancel a queued or running run; false when it already finished. */
  cancel(runId: string): boolean {
    const active = this.#active.get(runId);
    if (active) {
      active.abort.abort();
      return true;
    }
    const row = this.#d.runs.get(runId);
    if (row?.status !== "queued") return false;
    this.#d.runs.finish(runId, {
      status: "cancelled",
      reason: "cancelled",
      now: this.#now(),
      log: [],
    });
    return true;
  }

  /** Check schedules; fire each due workflow once per cron slot and repo. */
  tick(): void {
    const now = this.#now();
    for (const wf of this.#d.store.scheduled()) {
      if (wf.spec.trigger.kind !== "schedule") continue;
      if (wf.lastScheduledAt === null) {
        // First look after it was enabled: start counting from now.
        this.#d.store.markScheduled(wf.id, now);
        continue;
      }
      let slot: number | null;
      try {
        slot = dueSlot(parseCron(wf.spec.trigger.cron), wf.lastScheduledAt, now);
      } catch {
        continue;
      }
      if (slot === null) continue;
      this.#d.store.markScheduled(wf.id, slot);
      for (const ctx of this.scheduleContexts(wf, slot)) this.consider(ctx, [wf]);
    }
  }

  scheduleContexts(wf: StoredWorkflow, slot: number): WorkflowContext[] {
    const repos = this.#d.repos.listOperationRepos(wf.operationId);
    const chosen =
      wf.spec.filters.repoIds.length > 0
        ? repos.filter((r) => wf.spec.filters.repoIds.includes(r.repoId))
        : repos.filter((r) => r.isPrimary).slice(0, 1);
    return chosen.map((r) => ({
      deliveryId: `schedule:${new Date(slot).toISOString()}:${r.repoId}`,
      event: "schedule",
      name: "schedule",
      action: null,
      source: "schedule",
      receivedAt: slot,
      repo: { owner: r.owner, name: r.name, fullName: `${r.owner}/${r.name}` },
      repoIds: [r.repoId],
      operationIds: [wf.operationId],
      sender: null,
      fromOfficeApp: false,
      stale: false,
    }));
  }

  /** Boot: fail runs a previous process left running, then start the loop. */
  start(): void {
    for (const row of this.#d.runs.running()) {
      this.#d.runs.finish(row.id, {
        status: "failed",
        reason: "office_restarted: the office stopped during this run",
        now: this.#now(),
        log: [],
      });
      this.#d
        .cleanup?.(row.id, row.operationId)
        .catch((err) => this.#d.logger.warn({ err, runId: row.id }, "run cleanup failed"));
    }
    this.pump();
    this.#timer = setInterval(() => {
      try {
        this.tick();
        this.pump();
      } catch (err) {
        this.#d.logger.error({ err }, "workflow tick failed");
      }
    }, this.#d.tickMs ?? 30_000);
    this.#timer.unref?.();
  }

  /** Stop the loop and cancel what is running (the henchmen's sandboxes are removed). */
  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const running = [...this.#active.values()];
    for (const a of running) a.abort.abort();
    await Promise.allSettled(running.map((a) => a.done));
  }

  /** Resolves when nothing is running (tests). */
  async idle(): Promise<void> {
    while (this.#active.size > 0) {
      await Promise.allSettled([...this.#active.values()].map((a) => a.done));
    }
  }

  get activeCount(): number {
    return this.#active.size;
  }
}
