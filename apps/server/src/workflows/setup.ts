/**
 * Boot wiring for GitHub workflows (#155):
 *
 *   const workflows = createWorkflows({ db, keyring, config, logger, connection, repos, runner });
 *   workflows.follow(githubSync.events);
 *   workflows.mount(server.router, auth);
 *   workflows.start();
 */
import type { OfficeAuth } from "../auth/auth.ts";
import type { OfficeConfig } from "../config.ts";
import type { Db } from "../db/index.ts";
import type { GitHubConnection } from "../github/connection.ts";
import type { GitHubEventBus } from "../github/events.ts";
import { type GitRunner, runGit } from "../github/git.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import type { MasterKeyring } from "../secrets/index.ts";
import { WorkflowEngine } from "./engine.ts";
import { EventLog } from "./event-log.ts";
import { WorkflowExecutor } from "./executor.ts";
import { mountWorkflowRoutes } from "./routes.ts";
import { RunStore } from "./runs.ts";
import { WorkflowStore } from "./store.ts";
import { dbUsageRecorder, type UsageRecorder } from "./usage.ts";

export interface WorkflowsDeps {
  db: Db;
  keyring: MasterKeyring | undefined;
  config: Pick<OfficeConfig, "worktreesDir">;
  logger: Logger;
  connection: Pick<GitHubConnection, "app" | "tokenFor" | "api">;
  repos: Pick<RepoAccess, "getRepo" | "listFloorRepos">;
  runner: Runner;
  git?: GitRunner;
  usage?: UsageRecorder;
  now?: () => number;
  maxParallel?: number;
  tickMs?: number;
  commands?: { "claude-code"?: string; codex?: string };
}

export interface Workflows {
  engine: WorkflowEngine;
  store: WorkflowStore;
  runs: RunStore;
  events: EventLog;
  follow(bus: Pick<GitHubEventBus, "on">): void;
  mount(
    router: Router,
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">,
  ): void;
  start(): void;
  close(): Promise<void>;
}

export function createWorkflows(deps: WorkflowsDeps): Workflows {
  const logger = deps.logger.child({ module: "workflows" });
  const now = deps.now ?? Date.now;
  const store = new WorkflowStore(deps.db);
  const runs = new RunStore(deps.db);
  const events = new EventLog(deps.db);
  const executor = new WorkflowExecutor({
    db: deps.db,
    runs,
    connection: deps.connection,
    repos: deps.repos,
    runner: deps.runner,
    git: deps.git ?? runGit,
    keyring: deps.keyring,
    worktreesDir: deps.config.worktreesDir,
    usage: deps.usage ?? dbUsageRecorder(deps.db),
    logger,
    now,
    commands: deps.commands,
  });
  const engine = new WorkflowEngine({
    store,
    runs,
    events,
    repos: deps.repos,
    execute: (row, wf, signal) => executor.execute(row, wf, signal),
    cleanup: (runId, floorId) => executor.cleanup(runId, floorId),
    logger,
    now,
    maxParallel: deps.maxParallel,
    tickMs: deps.tickMs,
  });
  let unsubscribe: (() => void) | undefined;
  return {
    engine,
    store,
    runs,
    events,
    follow(bus) {
      unsubscribe?.();
      unsubscribe = engine.follow(bus);
    },
    mount(router, auth) {
      mountWorkflowRoutes(router, {
        auth,
        db: deps.db,
        store,
        runs,
        events,
        engine,
        repos: deps.repos,
        connection: deps.connection,
        now,
      });
    },
    start() {
      engine.start();
    },
    async close() {
      unsubscribe?.();
      await engine.stop();
    },
  };
}
