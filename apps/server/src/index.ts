/**
 * office-server entry point (docs/SPEC.md §4). Boots config, logging, the
 * HTTP server, the multiplayer rooms and graceful shutdown; later milestones
 * attach agents and the rest to the same process.
 */
import { mkdir } from "node:fs/promises";
import { LOBBY_WHITEBOARD_ID } from "@regulus/protocol";
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
import { createCelebrations, watchQueueEmptied } from "./celebrations/index.ts";
import { ChangesService, mountChangesRoutes } from "./changes/index.ts";
import {
  CompoundConfigError,
  CompoundService,
  loadCompoundConfig,
  mountCompoundRoutes,
} from "./compound/index.ts";
import { ConfigError, loadConfig, redactConfig } from "./config.ts";
import { mountCredentialPanel } from "./credentials/panel.ts";
import { closeDatabase, databasePathFor, openDatabase, runMigrations } from "./db/index.ts";
import { deprecatedEnvMessage } from "./deprecated-env.ts";
import { createBoardGitHub } from "./github/board-actions.ts";
import { mountBoardRoutes } from "./github/board-routes.ts";
import { createPullRequestClient } from "./github/pulls.ts";
import { mountGitHubRoutes } from "./github/routes.ts";
import { createGitHubConnection } from "./github/setup.ts";
import { createGitHubSync, type GitHubSync, mountGitHubSyncRoutes } from "./github/sync.ts";
import { createOfficeServer } from "./http/server.ts";
import { WsRouter } from "./http/ws-router.ts";
import { createJukebox } from "./jukebox/setup.ts";
import { createShutdownController, installSignalHandlers } from "./lifecycle.ts";
import { createLogger } from "./logging.ts";
import {
  describeMediaConfig,
  loadMediaConfig,
  MediaConfigError,
  mountMediaRoutes,
} from "./media/index.ts";
import { createMeetings } from "./meetings/index.ts";
import { createNotifications } from "./notifications/setup.ts";
import { createOperations, mountOperationRoutes } from "./operations/index.ts";
import { createWallPictures } from "./pictures/index.ts";
import { mountProfileRoutes } from "./profile/routes.ts";
import { allObservers, createTaskQueue } from "./queue/index.ts";
import {
  composeRoomAuth,
  createDevHeaderAuth,
  createRooms,
  createSessionRoomAuth,
  type RoomAuth,
} from "./rooms/index.ts";
import { mountRoomSettingsRoutes, RoomSettingsService } from "./rooms/settings/index.ts";
import { createSearch } from "./search/index.ts";
import { loadMasterKeyring, type MasterKeyring } from "./secrets/index.ts";
import { createServices, type Services } from "./services/index.ts";
import { createSkins } from "./skins/setup.ts";
import { createTerminals } from "./terminals/index.ts";
import { createUsage } from "./usage/index.ts";
import { createWhiteboards } from "./whiteboard/index.ts";
import { createWorkflows } from "./workflows/setup.ts";
import {
  createWorktrees,
  migrateLegacyLayout,
  mountWorktreeRoutes,
  operationDirRemover,
} from "./worktrees/index.ts";

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
  let compoundConfig: ReturnType<typeof loadCompoundConfig>;
  let mediaConfig: ReturnType<typeof loadMediaConfig>;
  try {
    config = loadConfig();
    compoundConfig = loadCompoundConfig();
    mediaConfig = loadMediaConfig(process.env, config.publicUrl);
  } catch (err) {
    if (
      err instanceof ConfigError ||
      err instanceof CompoundConfigError ||
      err instanceof MediaConfigError
    ) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }

  const logger = createLogger({ level: config.logLevel });
  const version = await readVersion();
  logger.info(
    { version, config: redactConfig(config), media: describeMediaConfig(mediaConfig) },
    "office-server starting",
  );
  for (const use of config.deprecatedEnv ?? []) logger.warn(deprecatedEnvMessage(use));
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
  // The lobby jukebox (#47): library (bundled tracks seeded), playhead and queue in the building room.
  const jukebox = createJukebox({
    db,
    dataDir: config.dataDir,
    logger: logger.child({ module: "jukebox" }),
  });
  const rooms = createRooms({
    jukebox: jukebox.player,
    db,
    logger,
    auth: selectRoomAuth(production, logger, auth),
    publicUrl: config.publicUrl,
    production,
    blastDoorMs: compoundConfig.blastDoorMs,
    mediaEnabled: mediaConfig !== null,
  });
  // Terminal bridge (#24). The AgentManager registers its runner below.
  const terminals = createTerminals({
    db,
    sessions: auth,
    logger,
    dataDir: config.dataDir,
    originPolicy: originPolicyFor(config.publicUrl, production),
  });
  // Whiteboards (#45): Yjs at /ws/wb/<boardId>; a new wall snapshot goes out in the room state.
  const whiteboards = createWhiteboards({
    db,
    sessions: auth,
    logger,
    dataDir: config.dataDir,
    originPolicy: originPolicyFor(config.publicUrl, production),
    onSnapshot: (boardId, version) =>
      boardId === LOBBY_WHITEBOARD_ID
        ? rooms.building.setLobbyWhiteboard(version)
        : rooms.operations.publishWhiteboard(boardId, version),
  });
  rooms.building.setLobbyWhiteboard(whiteboards.store.load(LOBBY_WHITEBOARD_ID)?.version ?? 0);
  whiteboards.pruneSnapshots().catch((err) => logger.warn({ err }, "snapshot prune failed"));
  // Wall pictures (#46): uploads under the data dir, decor.* through the operation rooms.
  const pictures = createWallPictures({
    db,
    dataDir: config.dataDir,
    logger,
    operations: rooms.operations,
  });
  // Running apps proxy (#39): first in the router, so app hosts never reach the office's routes.
  let services: Services;
  try {
    services = createServices({
      db,
      operations: rooms.operations,
      sessions: auth,
      originPolicy: originPolicyFor(config.publicUrl, production),
      officePort: config.port,
      appDomain: process.env.OFFICE_SERVICES_DOMAIN,
      logger,
    });
  } catch (err) {
    console.error(`Invalid services configuration: ${(err as Error).message}`);
    process.exit(2);
  }
  const server = createOfficeServer({
    config,
    logger,
    version,
    attach: new WsRouter()
      .use(services.route)
      .use(terminals.bridge)
      .use(terminals.screens)
      .use(whiteboards.endpoint)
      .use(rooms.transport.attachment),
  });
  mountAuthRoutes(server.router, auth);
  jukebox.mount(server.router, auth);
  whiteboards.mount(server.router, auth);
  // Voice and the lounge TV (#48): LiveKit tokens only; media never passes through this process.
  mountMediaRoutes(server.router, {
    auth,
    config: mediaConfig,
    presence: (sessionId) => rooms.building.presence(sessionId),
    logger: logger.child({ module: "media" }),
  });
  pictures.mount(server.router, auth);
  // Genius avatars (#185): the picker saves here; the building room shows the change at once.
  mountProfileRoutes(server.router, {
    auth,
    onAvatarChanged: (userId, look) => rooms.building.setAvatar(userId, look),
  });

  let keyring: MasterKeyring | undefined;
  if (config.masterKey) {
    try {
      keyring = loadMasterKeyring(process.env);
    } catch (err) {
      console.error(`Invalid master key configuration: ${(err as Error).message}`);
      process.exit(2);
    }
  }
  // Notifications (#42): desktop + tab badge through the BuildingRoom, team webhooks.
  const notifications = createNotifications({
    db,
    keyring,
    logger,
    config,
    personal: rooms.building,
  });
  notifications.mount(server.router, auth);
  // Henchman skins (#184): admin rules, resolved onto every henchman by the OperationRooms.
  const skins = createSkins({ db });
  skins.mount(server.router, auth);
  skins.publishTo(rooms.operations);
  // Usage tracker (#40): henchmen's usage/limit events, transcript scans, the viewer's summary.
  const usage = createUsage({ db, logger });
  usage.mount(server.router, auth);
  usage.publishTo(rooms.building);
  // Search (#41): chat and henchmen's scrollback snapshots, under the operation/terminal ACL.
  const search = createSearch({ db, logger, dataDir: config.dataDir });
  search.mount(server.router, auth);
  search.start();
  // Office GitHub connection (#141): App or org PAT; clones and PRs use it for repos it covers.
  let github: ReturnType<typeof createGitHubConnection>;
  try {
    github = createGitHubConnection({ db, keyring, config, logger });
  } catch (err) {
    console.error(`Invalid GitHub App configuration: ${(err as Error).message}`);
    process.exit(2);
  }
  // Board sync (#35): created after the operations (it needs their repo access); set below.
  let githubSync: GitHubSync | undefined;
  mountGitHubRoutes(server.router, {
    auth,
    db,
    logger,
    ...github,
    onConnectionChanged: () => githubSync?.connectionChanged(),
  });
  // Runner backend from OFFICE_RUNNER_BACKEND (SPEC §8): agents run only in their human's runner.
  const runner = await createRunner(config, production, logger);
  logger.info({ backend: config.runnerBackend }, "agent runner backend selected");
  // The compound (#181): room placement, build phase, layout in the BuildingRoom.
  const compound = new CompoundService({
    db,
    logger: logger.child({ module: "compound" }),
    config: compoundConfig,
    publish: (snapshot) => rooms.building.setCompound(snapshot),
    onRoomsChanged: (operationIds) => {
      for (const operationId of operationIds) {
        rooms
          .operationChanged(operationId)
          .catch((err) => logger.error({ err }, "room refresh failed"));
      }
    },
  });
  // First boot after the upgrade: operations become ready rooms in rows off the main corridor.
  compound.boot();
  shutdown.register("compound", () => compound.close());
  const operations = createOperations({
    db,
    logger,
    config,
    keyring,
    connection: github.connection,
    // A deleted operation's files: the linux-user helper, else the office itself (#150).
    dirs: operationDirRemover({
      projectsDir: config.projectsDir,
      worktreesDir: config.worktreesDir,
      runner,
      logger,
    }),
    placer: compound,
    onChange: (operationId) => {
      compound.operationChanged(operationId);
      rooms
        .operationChanged(operationId)
        .catch((err) => logger.error({ err }, "operation refresh failed"));
      githubSync?.operationChanged(operationId);
    },
  });
  // Webhooks (signed, no session), polling fallback, board cache → OperationRoom summaries (#35).
  githubSync = createGitHubSync({
    db,
    connection: github.connection,
    repos: operations.repos,
    boards: rooms.operations,
    publicUrl: config.publicUrl,
    apiBase: config.githubApiBase,
    polling: config.githubSync.polling,
    pollIntervalMs: config.githubSync.pollIntervalMs,
    logger: logger.child({ module: "github-sync" }),
  });
  mountGitHubSyncRoutes(server.router, { auth, sync: githubSync });
  // Merge gong (#43): merged PRs, manual bangs and emptied task queues (#37) ring on the operation.
  const celebrations = createCelebrations({
    db,
    operations: rooms.operations,
    logger,
    githubWebBase: config.githubWebBase,
  });
  celebrations.followGitHub(githubSync.events);
  rooms.operations.setGong(celebrations);
  // Board panel (#36): card detail, and assign/comment/merge/close with the office credential.
  mountBoardRoutes(server.router, {
    auth,
    db,
    officeToken: (owner, name) => github.connection.tokenFor(owner, name),
    github: createBoardGitHub({ apiBase: config.githubApiBase }),
    sync: githubSync,
    logger: logger.child({ module: "github-boards" }),
    onMerged: (pull) => celebrations.boardMerged(pull),
  });
  // Merged henchman PRs notify their owners (#42), from webhooks or polling.
  notifications.followGitHub(githubSync.events);
  // GitHub workflows (#155): events → henchmen in the workflow runner → posts as the office's App.
  const workflows = createWorkflows({
    db,
    keyring,
    config,
    logger,
    connection: github.connection,
    repos: operations.repos,
    runner,
    usage: usage.tracker,
  });
  workflows.follow(githubSync.events);
  workflows.mount(server.router, auth);
  mountOperationRoutes(server.router, {
    auth,
    operations: operations.service,
    lifecycle: operations.lifecycle,
  });
  mountCompoundRoutes(server.router, {
    auth,
    compound,
    operations: operations.service,
    lifecycle: operations.lifecycle,
  });
  // Room settings (#182): desk count and decor style, republished to the OperationRoom.
  mountRoomSettingsRoutes(server.router, {
    auth,
    settings: new RoomSettingsService({
      db,
      onChange: (operationId) => {
        rooms
          .operationChanged(operationId)
          .catch((err) => logger.error({ err }, "operation refresh failed"));
      },
    }),
  });
  logger.info({ projectsDir: config.projectsDir }, "operation repos clone here");
  // Per-agent worktrees + one-click PR (#31). The AgentManager (#26) takes
  // `worktrees.workspaces`, the runner does mountProject; `agent.pr` and
  // `agent.worktree` (#33) reach `worktrees` through the manager.
  const worktrees = createWorktrees({ db, logger, config, repos: operations.repos, runner });
  mountWorktreeRoutes(server.router, { auth, db, prune: worktrees.prune });
  // Changes window (#38): git in the owner's runner/sandbox; view for the operation, write for the owner.
  mountChangesRoutes(server.router, {
    auth,
    db,
    logger: logger.child({ module: "changes" }),
    changes: new ChangesService({
      db,
      runner,
      repos: operations.repos,
      clones: worktrees.workspaces,
    }),
  });
  // Room task queues (#37): created before the manager, which reports henchman status to it.
  // A room whose queue empties rings the merge gong three times (#43).
  const tasks = createTaskQueue({
    db,
    rooms: watchQueueEmptied(rooms.operations, (operationId) =>
      celebrations.queueEmptied(operationId),
    ),
    logger,
  });
  tasks.queue.followGitHub(githubSync.events);
  // Meeting room (#50): henchmen of one human in a pattern, driven through the AgentManager.
  const meetings = createMeetings({
    db,
    logger,
    rooms: rooms.operations,
    office: {
      repos: operations.repos,
      worktrees: worktrees.workspaces,
      runner,
      github: createPullRequestClient({ apiBase: config.githubApiBase }),
    },
  });
  meetings.mount(server.router, auth);
  // Agents (#26): the manager, its OperationRoom/terminal registration, Claude hook routes (#27).
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
    observer: allObservers(notifications.center, tasks.queue.observer, meetings.observer),
    usage: {
      agentEvent: (agentId, event) => {
        usage.tracker.agentEvent(agentId, event);
        meetings.usage.agentEvent(agentId, event);
      },
    },
  });
  tasks.bind(agents);
  meetings.bind(agents);
  // "Send all home" before deleting an operation (#150): branches are kept, GitHub is not touched.
  // An office owner/admin clears everyone's henchmen, which is not henchman control (D12, #138).
  operations.lifecycle.henchmen = {
    sendHome: (actor, agentId) => agents.evacuate(actor, agentId),
  };
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
    .catch((err) => logger.error({ err }, "per-human clone migration failed"))
    // Queued tasks start only once henchmen are re-adopted and settled (#37).
    .then(() => tasks.queue.boot())
    .catch((err) => logger.error({ err }, "starting the task queues failed"))
    // Meetings continue where they were once their henchmen are back (#50).
    .then(() => meetings.boot())
    .catch((err) => logger.error({ err }, "resuming meetings failed"));
  const claudeAdapter = agents.adapters.find("claude-code");
  if (claudeAdapter) {
    usage.startScanning({ runner, adapter: claudeAdapter, officeUrl: config.runnerOfficeUrl });
  }
  operations.cloner.resumePending().catch((err) => logger.error({ err }, "resuming clones failed"));
  githubSync.start();
  workflows.start();
  shutdown.register("github-sync", () => githubSync?.stop());
  shutdown.register("workflows", () => workflows.close());
  services.start(runner);
  shutdown.register("services", () => services.stop());
  shutdown.register("rooms", () => rooms.transport.shutdown());
  shutdown.register("terminals", () => terminals.shutdown());
  shutdown.register("whiteboards", () => whiteboards.shutdown());
  shutdown.register("provider-logins", () => credentialPanel.shutdown());
  shutdown.register("notifications", () => notifications.close());
  shutdown.register("celebrations", () => celebrations.close());
  shutdown.register("usage", () => usage.close());
  shutdown.register("search", () => search.stop());
  // Detach only: agents keep running in their runners' tmux (SPEC §11).
  shutdown.register("agents", () => agents.close());
  // Runs before the agents detach (hooks run last-registered-first): no new starts.
  shutdown.register("task-queue", () => tasks.queue.close());
  shutdown.register("meetings", () => meetings.close());
  installSignalHandlers(shutdown, (code) => {
    logger.flush();
    process.exit(code);
  });
}

await main();
