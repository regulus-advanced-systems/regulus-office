/**
 * The meeting room (#50; SPEC §10 M3, D9): 2-5 henchmen of one human working
 * on one task in a pattern, in a shared worktree, within round and token
 * budgets, ending in a draft PR, a PR review or notes.
 *
 * - store.ts     meetings, members, turns (transcript and resume cursor)
 * - service.ts   who may start, watch and control; start admission
 * - engine.ts    runs, halts, resume, boot, AgentManager observers
 * - run.ts       convene, agenda, one turn; close.ts output and adjourning
 * - turns.ts     waiting for a henchman's turn to end
 * - prompt.ts    turn prompts and the `.meeting/` notes layout
 * - henchmen.ts, workspace.ts, output.ts  the ports (ports.ts) over the
 *                AgentManager, the per-human worktrees and the PR path
 * - routes.ts    REST; live changes go out as `meeting.changed` on the OperationRoom
 *
 * Boot wiring: `createMeetings` before the AgentManager (it takes
 * `observer` / `usage`), `bind(manager)` after it, `boot()` once henchmen
 * are re-adopted.
 */
import { MEETING_CHANGED_MESSAGE, type UserRole } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import type { AgentManager } from "../agents/manager/manager.ts";
import type { OfficeAuth } from "../auth/auth.ts";
import type { Db } from "../db/index.ts";
import { userProfiles } from "../db/schema/index.ts";
import type { PullRequestClient } from "../github/pulls.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import type { GitWorktreeWorkspaces } from "../worktrees/workspaces.ts";
import { MeetingEngine } from "./engine.ts";
import { managerHenchmen } from "./henchmen.ts";
import { officeMeetingOutputs } from "./output.ts";
import type { MeetingHenchmen, MeetingOutputs, MeetingWorkspaces } from "./ports.ts";
import { mountMeetingRoutes } from "./routes.ts";
import { MeetingService } from "./service.ts";
import { MeetingStore } from "./store.ts";
import { gitMeetingWorkspaces } from "./workspace.ts";

export { MeetingEngine } from "./engine.ts";
export { MeetingError, MeetingService } from "./service.ts";
export { MeetingStore } from "./store.ts";

/** How often finished meetings' worktrees are checked for removal. */
const SWEEP_INTERVAL_MS = 60_000;

/** An object whose methods are looked up on `get()` at call time (bound after boot order). */
export function late<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get(_target, key) {
      const target = get() as Record<PropertyKey, unknown>;
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export interface MeetingsDeps {
  db: Db;
  logger: Logger;
  rooms: { broadcast(operationId: string, type: string, payload: unknown): boolean };
  /** Ports; the office's own unless given (tests). */
  henchmen?: MeetingHenchmen;
  workspaces?: MeetingWorkspaces;
  outputs?: MeetingOutputs;
  /** For the office's own ports. */
  office?: {
    repos: RepoAccess;
    worktrees: GitWorktreeWorkspaces;
    runner: Pick<Runner, "readTextFile">;
    github: PullRequestClient;
  };
  pollMs?: number;
  readyTimeoutMs?: number;
  now?: () => number;
}

export function createMeetings(deps: MeetingsDeps) {
  const { db } = deps;
  const logger = deps.logger.child({ module: "meetings" });
  const store = new MeetingStore(db, deps.now);
  let manager: AgentManager | undefined;
  const bound = () => {
    if (!manager) throw new Error("meetings have no AgentManager yet");
    return manager;
  };
  const office = deps.office;
  const henchmen =
    deps.henchmen ??
    late(() => managerHenchmen({ manager: bound(), runner: need(office).runner, db }));
  const workspaces =
    deps.workspaces ??
    gitMeetingWorkspaces({ db, repos: need(office).repos, workspaces: need(office).worktrees });
  const outputs =
    deps.outputs ??
    late(() =>
      officeMeetingOutputs({
        manager: bound(),
        repos: need(office).repos,
        github: need(office).github,
      }),
    );

  let service: MeetingService | undefined;
  const publish = (meetingId: string) => {
    const row = store.get(meetingId);
    if (!row || !service) return;
    try {
      deps.rooms.broadcast(row.operationId, MEETING_CHANGED_MESSAGE, service.summary(row));
    } catch (err) {
      logger.warn({ meetingId, err: String(err) }, "meeting publish failed");
    }
  };
  const engine = new MeetingEngine({
    store,
    henchmen,
    workspaces,
    outputs,
    logger,
    publish,
    actorFor(userId) {
      const row = db
        .select({ role: userProfiles.role })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .get();
      return row ? { id: userId, role: row.role as UserRole } : null;
    },
    pollMs: deps.pollMs,
    readyTimeoutMs: deps.readyTimeoutMs,
    now: deps.now,
  });
  service = new MeetingService({ db, store, engine, henchmen, workspaces });
  let sweeper: ReturnType<typeof setInterval> | undefined;

  return {
    store,
    engine,
    service,
    observer: engine.observer,
    usage: engine.usage,
    bind(next: AgentManager) {
      manager = next;
    },
    mount(router: Router, auth: MeetingRoutesAuth) {
      mountMeetingRoutes(router, { auth, meetings: service, logger });
    },
    /** Continue live meetings (after henchmen are re-adopted) and start the sweep. */
    boot() {
      engine.boot();
      sweeper ??= setInterval(() => {
        engine.sweep().catch((err) => logger.warn({ err: String(err) }, "meeting sweep failed"));
      }, SWEEP_INTERVAL_MS);
      sweeper.unref?.();
    },
    close() {
      if (sweeper) clearInterval(sweeper);
      engine.close();
    },
  };
}

type MeetingRoutesAuth = Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;

function need<T>(value: T | undefined): T {
  if (!value)
    throw new Error("meetings need the office's repos, worktrees, runner and GitHub client");
  return value;
}

export type Meetings = ReturnType<typeof createMeetings>;
