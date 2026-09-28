/**
 * office-server entry point (docs/SPEC.md §4). Boots config, logging, the
 * HTTP server, the multiplayer rooms and graceful shutdown; later milestones
 * attach agents and the rest to the same process.
 */
import { mkdir } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { createAgents } from "./agents/manager/boot.ts";
import { createRunner } from "./agents/manager/runner-backend.ts";
import {
  AuthConfigError,
  createAuth,
  mountAuthRoutes,
  type OfficeAuth,
  originPolicyFor,
} from "./auth/index.ts";
import { ConfigError, loadConfig, redactConfig } from "./config.ts";
import { mountCredentialPanel } from "./credentials/panel.ts";
import { closeDatabase, databasePathFor, openDatabase, runMigrations } from "./db/index.ts";
import { createFloors, mountFloorRoutes } from "./floors/index.ts";
import { createOfficeServer } from "./http/server.ts";
import { WsRouter } from "./http/ws-router.ts";
import { createShutdownController, installSignalHandlers } from "./lifecycle.ts";
import { createLogger } from "./logging.ts";
import {
  composeRoomAuth,
  createDevHeaderAuth,
  createRooms,
  createSessionRoomAuth,
  type RoomAuth,
} from "./rooms/index.ts";
import { loadMasterKeyring, type MasterKeyring } from "./secrets/index.ts";
import { createTerminals } from "./terminals/index.ts";
import { createWorktrees, migrateLegacyLayout, mountWorktreeRoutes } from "./worktrees/index.ts";

async function readVersion(): Promise<string> {
  try {
    const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Room join authentication: the Better Auth session cookie, and outside
 * production also the `x-office-dev-user` header as a fallback for local
 * clients without a browser session.
 */
function selectRoomAuth(
  production: boolean,
  logger: ReturnType<typeof createLogger>,
  auth: OfficeAuth,
): RoomAuth {
  const sessionAuth = createSessionRoomAuth(auth);
  if (production) return sessionAuth;
  logger.warn("development room auth enabled: x-office-dev-user header is trusted");
  return composeRoomAuth([sessionAuth, createDevHeaderAuth()]);
}

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }

  const logger = createLogger({ level: config.logLevel });
  const version = await readVersion();
  logger.info({ version, config: redactConfig(config) }, "office-server starting");
  if (!config.masterKey) {
    logger.warn(
      "OFFICE_MASTER_KEY is not set; encrypted credential storage is unavailable (SPEC §8)",
    );
  }

  await mkdir(config.dataDir, { recursive: true });

  const dbPath = databasePathFor(config.dataDir);
  const db = openDatabase({ path: dbPath });
  runMigrations(db);
  logger.info({ path: dbPath }, "database ready");

  const shutdown = createShutdownController({ logger, timeoutMs: config.shutdownTimeoutMs });
  // Hooks run last-registered-first: rooms disconnect, HTTP drains, then the database closes.
  shutdown.register("db", () => closeDatabase(db));

  let auth: OfficeAuth;
  try {
    auth = createAuth({ db, logger, config });
  } catch (err) {
    if (err instanceof AuthConfigError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }

  const production = process.env.NODE_ENV === "production";
  const rooms = createRooms({
    db,
    logger,
    auth: selectRoomAuth(production, logger, auth),
    publicUrl: config.publicUrl,
    production,
  });
  // Terminal bridge (#24). The AgentManager registers its runner below.
  const terminals = createTerminals({
    db,
    sessions: auth,
    logger,
    dataDir: config.dataDir,
    originPolicy: originPolicyFor(config.publicUrl, production),
  });
  const server = createOfficeServer({
    config,
    logger,
    version,
    attach: new WsRouter()
      .use(terminals.bridge)
      .use(terminals.screens)
      .use(rooms.transport.attachment),
  });
  mountAuthRoutes(server.router, auth);

  let keyring: MasterKeyring | undefined;
  if (config.masterKey) {
    try {
      keyring = loadMasterKeyring(process.env);
    } catch (err) {
      console.error(`Invalid master key configuration: ${(err as Error).message}`);
      process.exit(2);
    }
  }
  const floors = createFloors({
    db,
    logger,
    config,
    keyring,
    onChange: (floorId) => {
      rooms.floorChanged(floorId).catch((err) => logger.error({ err }, "floor refresh failed"));
    },
  });
  mountFloorRoutes(server.router, { auth, floors: floors.service });
  logger.info({ projectsDir: config.projectsDir }, "floor repos clone here");
  // Per-agent worktrees + one-click PR (#31). The AgentManager (#26) takes
  // `worktrees.workspaces`, the runner does mountProject; `agent.pr` and
  // `agent.worktree` (#33) reach `worktrees` through the manager.
  // Runner backend from OFFICE_RUNNER_BACKEND (SPEC §8): agents run only in their human's runner.
  const runner = await createRunner(config, production);
  logger.info({ backend: config.runnerBackend }, "agent runner backend selected");
  const worktrees = createWorktrees({ db, logger, config, repos: floors.repos, runner });
  mountWorktreeRoutes(server.router, { auth, db, prune: worktrees.prune });
  // Agents (#26): the manager, its FloorRoom/terminal registration, Claude hook routes (#27).
  const agents = await createAgents({
    db,
    config,
    logger,
    rooms,
    terminals,
    router: server.router,
    keyring,
    runner,
    workspaces: worktrees.workspaces,
    clones: worktrees.workspaces,
    worktreeTools: {
      status: (agentId) => worktrees.workspaces.status(agentId),
      openPullRequest: (agentId, options) => worktrees.openPullRequest(agentId, options),
    },
  });
  // "Connect providers" (#32): key profiles and CLI logins in the human's own runner (SPEC §8).
  const credentialPanel = mountCredentialPanel(server.router, {
    db,
    auth,
    keyring,
    runner,
    adapters: agents.adapters,
    logins: terminals.logins,
    officeUrl: config.publicUrl,
    logger,
  });
  server.health.register("db", () => {
    db.run(sql`select 1`);
    return true;
  });
  shutdown.register("http", async () => {
    await server.stop(false);
  });
  await rooms.transport.listen();
  // Re-adopt first: it stops agents still in the shared-clone layout, then the
  // layout migration (#114) takes runner access to that layout away.
  agents
    .adopt()
    .catch((err) => logger.error({ err }, "re-adopting agents failed"))
    .then(() =>
      migrateLegacyLayout({
        projectsDir: config.projectsDir,
        worktreesDir: config.worktreesDir,
        runner,
        logger,
      }),
    )
    .catch((err) => logger.error({ err }, "per-human clone migration failed"));
  floors.cloner.resumePending().catch((err) => logger.error({ err }, "resuming clones failed"));
  shutdown.register("rooms", () => rooms.transport.shutdown());
  shutdown.register("terminals", () => terminals.shutdown());
  shutdown.register("provider-logins", () => credentialPanel.shutdown());
  // Detach only: agents keep running in their runners' tmux (SPEC §11).
  shutdown.register("agents", () => agents.close());
  installSignalHandlers(shutdown, (code) => {
    logger.flush();
    process.exit(code);
  });
}

await main();
