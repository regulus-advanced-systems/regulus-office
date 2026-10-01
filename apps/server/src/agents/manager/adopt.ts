/**
 * Re-adoption on boot (SPEC §11 Reliability): office restarts must not kill
 * agents, because their tmux sessions live in the human's runner, not in
 * the office process.
 *
 * For every henchman that still holds a desk:
 * - `exited`: shown at its desk as it was.
 * - tmux agents (`exec` launch) whose session is still on the owner's tmux
 *   server: the structured channel is re-attached with `connect` on a plan
 *   rebuilt from the row (no env, no files, nothing re-run; the hook token
 *   hash is persisted, so the agent's hooks keep authenticating).
 * - agents started over piped stdio (`connect` launch, Codex app-server)
 *   died with the office; when the adapter can resume and a provider session
 *   id is stored, they are relaunched on that session.
 * - everything else is marked `offline` (resumable with `agent.resume`).
 * - a workspace from before per-human clones (#114) lives in the operation's
 *   shared mirror: its process is stopped and the henchman marked `offline` with
 *   the reason; it cannot be resumed (the PR button and send-home still work).
 *
 * Henchmen in their own sandboxes (D18, #169) are found the same way: the
 * runner lists each sandbox's sessions with the human's. Afterwards the
 * sandboxes nobody re-adopted are reaped (sandbox-reaper.ts).
 */
import type { RunnerContext } from "@regulus/agent-adapters";
import type { AgentStatus } from "@regulus/protocol";
import { bindRunnerOps, type RunnerHandle } from "../../runners/types.ts";
import { LEGACY_WORKSPACE_MESSAGE } from "../../worktrees/types.ts";
import { adoptionPlan } from "./launch.ts";
import type { AgentManager } from "./manager.ts";
import type { AgentRow } from "./store.ts";

/** Runners that can find their per-human containers again (docker backend). */
interface Recoverable {
  recover(): Promise<RunnerHandle[]>;
}

function canRecover(runner: object): runner is Recoverable {
  return typeof (runner as Partial<Recoverable>).recover === "function";
}

export async function adoptAll(mgr: AgentManager): Promise<void> {
  await adoptSeated(mgr);
  await mgr.reapSandboxes();
}

async function adoptSeated(mgr: AgentManager): Promise<void> {
  const rows = mgr.store.seated();
  if (rows.length === 0) return;
  if (canRecover(mgr.runner)) {
    try {
      await mgr.runner.recover();
    } catch (err) {
      mgr.logger.warn({ err: String(err) }, "runner recovery failed; agents will be offline");
    }
  }

  const byOwner = new Map<string, AgentRow[]>();
  for (const row of rows)
    byOwner.set(row.ownerUserId, [...(byOwner.get(row.ownerUserId) ?? []), row]);

  for (const [userId, owned] of byOwner) {
    let sessions = new Set<string>();
    let handle: RunnerHandle | undefined;
    const needsRunner = owned.some((r) => r.status !== "exited");
    if (needsRunner) {
      try {
        handle = await mgr.runner.provision({ userId });
        sessions = new Set(await mgr.runner.listSessions({ userId }));
      } catch (err) {
        mgr.logger.warn({ userId, err: String(err) }, "runner unavailable while re-adopting");
      }
    }
    for (const row of owned) {
      try {
        await adoptOne(mgr, row, sessions, handle);
      } catch (err) {
        mgr.logger.warn({ agentId: row.id, err: String(err) }, "re-adopting agent failed");
      }
    }
  }
}

async function adoptOne(
  mgr: AgentManager,
  row: AgentRow,
  sessions: ReadonlySet<string>,
  handle: RunnerHandle | undefined,
): Promise<void> {
  const live = mgr.track(row);
  const profile = mgr.profileFor(row);
  const adapter = mgr.adapters.find(row.provider);
  if (mgr.isLegacyWorkspace(row)) {
    if (row.status !== "exited") {
      await mgr.runner.kill({ userId: row.ownerUserId, agentId: row.id }).catch(() => {});
      mgr.publish(row.id, {
        kind: "status",
        ts: mgr.now(),
        status: "offline",
        reason: LEGACY_WORKSPACE_MESSAGE,
      });
      mgr.markOffline(live);
      mgr.logger.warn({ agentId: row.id }, "agent workspace predates per-human clones; offline");
    }
    mgr.publishHenchman(live);
    return;
  }
  if (row.status === "exited" || !adapter) {
    if (!adapter) mgr.markOffline(live);
    mgr.publishHenchman(live);
    return;
  }

  const session = row.tmuxSession ?? "";
  if (profile.mode === "exec" && handle && sessions.has(session)) {
    const ctx: RunnerContext = {
      backend: mgr.runner.backend,
      userId: row.ownerUserId,
      home: handle.home,
      runner: bindRunnerOps(mgr.runner, { userId: row.ownerUserId }),
      officeUrl: mgr.officeUrl,
      now: mgr.now,
    };
    if (row.status === "offline") {
      // It was offline at the last boot and its session is back: treat as idle.
      mgr.publish(row.id, { kind: "status", ts: mgr.now(), status: "idle", reason: "re-adopted" });
    }
    const control = adapter.connect(adoptionPlan(row), ctx);
    live.ctx = ctx;
    mgr.attach(live, control, !adapter.capabilities.structured);
    mgr.publishHenchman(live);
    mgr.logger.info({ agentId: row.id }, "agent re-adopted");
    return;
  }

  const resumable =
    profile.mode === "connect" &&
    handle !== undefined &&
    adapter.capabilities.resume &&
    Boolean(row.providerSessionId) &&
    isRunningStatus(row.status);
  if (resumable) {
    mgr.publishHenchman(live);
    try {
      await mgr.relaunch(live);
      mgr.logger.info({ agentId: row.id }, "agent resumed on its provider session");
      return;
    } catch {
      // relaunch marked it `error`; fall through to offline
    }
  }
  mgr.markOffline(live);
  mgr.publishHenchman(live);
}

function isRunningStatus(status: AgentStatus): boolean {
  return status !== "exited" && status !== "offline" && status !== "error";
}
