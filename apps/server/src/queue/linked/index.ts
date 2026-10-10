/**
 * One task across several repos (#257; D7): a part in each room's queue, a
 * henchman, a worktree and a draft pull request per part, notes for the owner, and
 * one combined view per viewer.
 *
 * - service.ts    create, list for a viewer, stop; what happens as parts run
 * - views.ts      what one viewer may see of a linked task
 * - store.ts      `linked_tasks` and its parts (`tasks.linked_task_id`)
 * - prompt.ts     what a part tells its henchman; the notes files as text
 * - notes.ts      each part's notes for the owner, and what the owner passed on
 * - pull-links.ts the parts' pull requests naming each other
 * - routes.ts     REST
 *
 * Boot wiring: `createLinkedTasks` after the queue, its `linked.observer` to
 * the AgentManager after the queue's, `bind(manager)` after the AgentManager,
 * `boot()` after the queue's own boot.
 */
import type { AgentManager } from "../../agents/manager/manager.ts";
import type { OfficeAuth } from "../../auth/auth.ts";
import type { OfficeConfig } from "../../config.ts";
import type { Db } from "../../db/index.ts";
import type { RepoAccess } from "../../github/repo-access.ts";
import type { Router } from "../../http/router.ts";
import type { Logger } from "../../logging.ts";
import type { TaskQueue } from "../service.ts";
import { NotesSync } from "./notes.ts";
import { githubPullPages, PullLinker, type PullPages } from "./pull-links.ts";
import { mountLinkedTaskRoutes } from "./routes.ts";
import { type LinkedHenchmen, LinkedTasks } from "./service.ts";
import { LinkedTaskStore } from "./store.ts";

export { LinkedTasks } from "./service.ts";

/** How often the notes of tasks at work are collected and delivered. */
export const NOTES_SYNC_MS = 3_000;

export interface LinkedTasksBootDeps {
  db: Db;
  queue: TaskQueue;
  logger: Logger;
  config: Pick<OfficeConfig, "worktreesDir" | "githubApiBase">;
  repos: RepoAccess;
  /** The office's own unless given (tests). */
  pages?: PullPages;
  henchmen?: LinkedHenchmen;
  notesSyncMs?: number;
}

/** The AgentManager as the linked tasks' henchmen: both calls are authorised as the owner. */
export function managerHenchmen(manager: AgentManager): LinkedHenchmen {
  return {
    openDraftPullRequest: (owner, agentId) =>
      manager.openPullRequest(owner, agentId, { draft: true }),
    stop: (owner, agentId) => manager.stop(owner, agentId),
  };
}

export function createLinkedTasks(deps: LinkedTasksBootDeps) {
  const logger = deps.logger.child({ component: "linked-tasks" });
  const store = new LinkedTaskStore(deps.db);
  let henchmen = deps.henchmen;
  const bound = (): LinkedHenchmen => {
    if (!henchmen) throw new Error("the linked tasks have no AgentManager yet");
    return henchmen;
  };
  const notes = new NotesSync({
    store,
    worktreesDir: deps.config.worktreesDir,
    ownerMayAccess: (userId, operationId) =>
      deps.queue.scheduler.ownerAccess(userId, operationId) !== null,
    logger,
  });
  const pulls = new PullLinker({
    store,
    pages: deps.pages ?? githubPullPages({ repos: deps.repos, apiBase: deps.config.githubApiBase }),
    logger,
  });
  const linked = new LinkedTasks({
    store,
    queue: deps.queue,
    henchmen: {
      openDraftPullRequest: (owner, agentId) => bound().openDraftPullRequest(owner, agentId),
      stop: (owner, agentId) => bound().stop(owner, agentId),
    },
    notes,
    pulls,
    logger,
  });
  deps.queue.extend(linked.hooks);
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    linked,
    store,
    notes,
    bind(manager: AgentManager) {
      henchmen = managerHenchmen(manager);
    },
    mount(
      router: Router,
      auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">,
    ) {
      mountLinkedTaskRoutes(router, { auth, linked, logger });
    },
    /** After the queue booted: late pull requests, then the notes round. */
    boot() {
      linked.recover();
      timer ??= setInterval(() => void notes.syncActive(), deps.notesSyncMs ?? NOTES_SYNC_MS);
      timer.unref?.();
    },
    async close() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await linked.idle();
    },
  };
}
