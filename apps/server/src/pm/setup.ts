/**
 * Boot wiring for office agents (#271): stores, engines, the tool dispatcher
 * with the office's services behind it, the MCP endpoint and the REST routes.
 *
 * The office services reach the tools as `OfficePorts` (tools/context.ts),
 * bound here to the real queue, boards, usage, chat and AgentManager once
 * they exist (`bind`). Until then a tool that needs one answers `unavailable`.
 */
import { and, eq } from "drizzle-orm";
import type { OfficeAuth } from "../auth/auth.ts";
import type { Db } from "../db/index.ts";
import { githubIssues, githubPulls, operationRepos } from "../db/schema/index.ts";
import type { BoardGitHub } from "../github/board-actions.ts";
import { buildOperationBoard } from "../github/board-summary.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import type { MasterKeyring } from "../secrets/index.ts";
import type { UsageRecorder } from "../usage/index.ts";
import { AgentAccess } from "./access.ts";
import { Conversations } from "./conversations.ts";
import { CliSessionEngine } from "./engines/cli-session.ts";
import { AgentCredentials } from "./engines/credentials.ts";
import type { OfficeAgentEngine } from "./engines/types.ts";
import type { HermesClientOptions } from "./hermes/client.ts";
import { HermesConnections } from "./hermes/connections.ts";
import { type HermesEngineOptions, HermesExternalEngine } from "./hermes/engine.ts";
import { HermesManagedEngine, type HermesManagedOptions } from "./hermes/managed/engine.ts";
import type { ManagedHermesHost } from "./hermes/managed/host.ts";
import { mountHermesRoutes } from "./hermes/routes.ts";
import { HermesAgentService } from "./hermes/service.ts";
import { mountMcp } from "./mcp.ts";
import { AgentMind } from "./mind/mind.ts";
import { MindService } from "./mind/people.ts";
import { engineMind } from "./mind/port.ts";
import { MindCipher } from "./mind/seal.ts";
import { sealAtStart } from "./mind/seal-existing.ts";
import { MindStore } from "./mind/store.ts";
import { HumanRequests } from "./requests.ts";
import { mountOfficeAgentRoutes } from "./routes.ts";
import { runsOnOf } from "./runs-on.ts";
import { AgentRuntime } from "./runtime.ts";
import { RoomScopes } from "./scope.ts";
import { OfficeAgentService } from "./service.ts";
import { OfficeAgentStore } from "./store.ts";
import { OfficeAgentTokens } from "./tokens.ts";
import { mountToolRoutes } from "./tool-routes.ts";
import { OfficeTools } from "./tools/call.ts";
import { type CommentTarget, type OfficePorts, ToolError } from "./tools/context.ts";
import {
  AgentAttention,
  AgentWorld,
  AgentWorldService,
  mountAgentWorldRoutes,
  PmRounds,
  type RoundHenchman,
} from "./world/index.ts";

export interface OfficeAgentsOptions {
  db: Db;
  logger: Logger;
  keyring: MasterKeyring | undefined;
  /** The office as engines running in runners reach it (`config.runnerOfficeUrl`). */
  officeUrl: string;
  version: string;
  /** Absent: no CLI session engine (tests register their own engines). */
  runner?: Pick<Runner, "provision" | "spawnPiped" | "backend">;
  usage?: UsageRecorder;
  /** Extra engines (tests: the fake engine; later the Hermes engines of #57 and #58). */
  engines?: readonly OfficeAgentEngine[];
  /** Timings of the `hermes-external` engine and its client (tests shorten them). */
  hermes?: Pick<
    HermesEngineOptions,
    "healthIntervalMs" | "backoffBaseMs" | "backoffMaxMs" | "sendAttempts"
  > & { client?: HermesClientOptions };
  /**
   * The office PM's rounds (#60): who waits or has finished at a desk, and the
   * existing "needs you" notice for a henchman's owner (`NotificationCenter.remind`).
   */
  rounds?: {
    henchmen(): RoundHenchman[];
    remind(henchmanId: string, via: string): void;
    /** Time between two rounds, ms. */
    everyMs?: number;
  };
  /**
   * Where the office runs Hermes agents of its own (#57): given, the
   * `hermes-managed` engine is offered. Absent: the office has no Hermes image.
   */
  managedHermes?: { host: ManagedHermesHost } & Pick<
    HermesManagedOptions,
    "startTimeoutMs" | "startPollMs" | "stableMs"
  >;
  /** CLI override for the session engine (tests: the fake `claude`). */
  cliCommand?: string;
  now?: () => number;
}

/** The office services the tools use; everything but `board` arrives through `bind`. */
export type BoundPorts = Omit<OfficePorts, "board" | "comment"> & {
  /** `GitHubConnection.tokenFor`: the office credential for a repo, or null. */
  officeToken(owner: string, name: string): Promise<string | null>;
  github: Pick<BoardGitHub, "comment">;
};

export interface OfficeAgents {
  store: OfficeAgentStore;
  tokens: OfficeAgentTokens;
  runtime: AgentRuntime;
  service: OfficeAgentService;
  tools: OfficeTools;
  conversations: Conversations;
  requests: HumanRequests;
  /** The agents' bodies (#252): the BuildingRoom steps it (`building.attachWorld`). */
  world: AgentWorld;
  /** Tell one person's clients that what their agents want from them changed (#252). */
  onAttention(notify: (userId: string) => void): void;
  hermes: HermesAgentService;
  /** Souls, memories and notes (#136). */
  mind: AgentMind;
  mount(
    router: Router,
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">,
  ): void;
  /** Hand the tools the office services once they exist. */
  bind(ports: Partial<BoundPorts>): void;
  /** Call once at boot, after the migrations: no engine run survived the restart. */
  boot(): void;
  close(): Promise<void>;
}

/** On the card of a shared agent that ran on Hermes before #301; an engine cannot be changed afterwards. */
export const SHARED_HERMES_STOPPED =
  "Stopped by the office: a shared agent cannot run on Hermes for now (Hermes keeps its own memory across everyone it talks to). Make a new shared agent that runs as a Claude Code session; this one can be read here until you remove it.";

const unavailable = (what: string) => () => {
  throw new ToolError("unavailable", `${what} is not available right now`);
};

export function createOfficeAgents(opts: OfficeAgentsOptions): OfficeAgents {
  const { db } = opts;
  const now = opts.now ?? Date.now;
  const logger = opts.logger.child({ module: "office-agents" });
  // Souls, memories and notes are encrypted in the database under the master key (#301).
  const cipher = new MindCipher(opts.keyring);
  const store = new OfficeAgentStore(db, now, cipher);
  const tokens = new OfficeAgentTokens(db, now);
  const conversations = new Conversations(db, now);
  const requests = new HumanRequests(db, now);
  const credentials = new AgentCredentials(db, opts.keyring);
  const mind = new AgentMind(new MindStore(db, now, cipher));
  // What a shared agent may pass on to whom (#301).
  const scopes = new RoomScopes(db);
  const runtime = new AgentRuntime({
    store,
    tokens,
    conversations,
    mind: (agentId) =>
      engineMind(
        db,
        mind,
        agentId,
        store.get(agentId)?.ownerUserId === null
          ? {
              scopes,
              person: (userId) => store.person(userId),
              grants: () => store.grants(agentId).map((g) => g.operationId),
            }
          : undefined,
      ),
    scopes,
    officeUrl: opts.officeUrl.replace(/\/+$/, ""),
    usage: opts.usage,
    logger,
    now,
  });
  for (const engine of opts.engines ?? []) runtime.register(engine);
  if (opts.runner && !runtime.engine("cli-session")) {
    runtime.register(
      new CliSessionEngine({
        runner: opts.runner,
        credentials,
        logger,
        command: opts.cliCommand,
      }),
    );
  }

  // A person's own Hermes, running elsewhere (#58). The managed one (#57) registers beside it.
  const connections = new HermesConnections(db, opts.keyring);
  if (!runtime.engine("hermes-external")) {
    runtime.register(new HermesExternalEngine({ connections, logger, ...opts.hermes }));
  }

  // A Hermes the office runs itself (#57): the same conversation, on a gateway the office starts.
  let managed: HermesManagedEngine | undefined;
  if (opts.managedHermes && !runtime.engine("hermes-managed")) {
    managed = new HermesManagedEngine({
      ...opts.hermes,
      ...opts.managedHermes,
      credentials,
      keyKind: (agent) => runsOnOf(db, agent, false).kind,
      logger,
    });
    runtime.register(managed);
  }

  let bound: Partial<BoundPorts> = {};
  const comment = async (target: CommentTarget, body: string) => {
    if (!bound.officeToken || !bound.github) return unavailable("GitHub")();
    const repo = db
      .select({ owner: operationRepos.owner, name: operationRepos.name })
      .from(operationRepos)
      .where(
        and(
          eq(operationRepos.id, target.repoId),
          eq(operationRepos.operationId, target.operationId),
        ),
      )
      .get();
    // As on the board panel: only a card the office already shows can be commented on.
    const table = target.kind === "pr" ? githubPulls : githubIssues;
    const card = db
      .select({ number: table.number })
      .from(table)
      .where(and(eq(table.repoId, target.repoId), eq(table.number, target.number)))
      .get();
    if (!repo || !card) throw new ToolError("not_found", "no such card on this operation");
    const token = await bound.officeToken(repo.owner, repo.name);
    if (!token) {
      throw new ToolError("unavailable", "no office GitHub connection covers this repo");
    }
    const posted = await bound.github.comment(token, repo, target.number, body);
    return { id: posted.id, url: posted.url };
  };
  const ports: OfficePorts = {
    board: (operationId) => buildOperationBoard(db, operationId, now()),
    comment,
    queue: (operationId) => (bound.queue ?? unavailable("the task queue"))(operationId),
    enqueue: (actor, input) => (bound.enqueue ?? unavailable("the task queue"))(actor, input),
    myUsage: (userId) => (bound.myUsage ?? unavailable("usage"))(userId),
    officeUsage: () => (bound.officeUsage ?? unavailable("usage"))(),
    postChat: (line) => (bound.postChat ?? unavailable("the chat"))(line),
    spawn: (actor, input) => (bound.spawn ?? unavailable("spawning henchmen"))(actor, input),
    stop: (actor, henchmanId) =>
      (bound.stop ?? unavailable("stopping henchmen"))(actor, henchmanId),
  };
  const tools = new OfficeTools(
    {
      store,
      access: new AgentAccess(store),
      conversations,
      requests,
      mind,
      scopes,
      ports,
      now,
    },
    logger,
  );
  const mindService = new MindService({ store, mind, scopes, runtime });
  const service = new OfficeAgentService({
    store,
    tokens,
    runtime,
    conversations,
    requests,
    credentials,
    scopes,
    hermes: connections,
    minds: mindService,
    now,
  });
  const hermes = new HermesAgentService({
    store,
    service,
    runtime,
    connections,
    client: opts.hermes?.client,
    now,
  });

  // Bodies in the world (#252). A body is looks only: where it may stand is the access gate's answer.
  const access = new AgentAccess(store);
  // The office PM (D28): at reception, and on its rounds by the clock (#60). Movement only.
  const rounds = new PmRounds({
    henchmen: () => opts.rounds?.henchmen() ?? [],
    everyMs: opts.rounds?.everyMs,
  });
  const world = new AgentWorld({
    // An agent a person stopped has no body (#301): it is left out, and is back within a sync
    // once started. One that merely is not running (the office restarted, its document was
    // saved) keeps its body: the PM is at reception and walks its rounds all the same.
    agents: () =>
      store
        .list()
        .filter((row) => !row.stoppedByPerson)
        .map((row) => ({
          id: row.id,
          name: row.name,
          ownerUserId: row.ownerUserId,
          ownerName: row.ownerUserId ? (store.person(row.ownerUserId)?.displayName ?? "") : "",
          appearance: row.appearance,
          status: row.status,
          dismissed: row.ownerUserId !== null && row.dismissed,
          // A personal PM is a companion: it follows its owner and does no rounds.
          post: row.ownerUserId === null && row.role === "pm" ? "reception" : "none",
        })),
    mayEnter: (agentId, operationId) => {
      const row = store.get(agentId);
      return row !== undefined && access.operation(row, operationId) !== null;
    },
    duty: (agent, context) => rounds.duty(agent, context),
    // Its owner is in the office but not in that room: they get the "needs you" notice, once.
    standingBy: (agent, visit, owner) => {
      if (owner === "elsewhere") opts.rounds?.remind(visit.henchmanId, agent.name);
    },
  });
  let notify: (userId: string) => void = () => {};
  conversations.onAppend = (_agentId, userId) => notify(userId);
  requests.onChange = (userId) => notify(userId);
  const worldService = new AgentWorldService({
    store,
    // A question about a room the person can no longer see is not shown over the agent (#301).
    attention: new AgentAttention(db, conversations, requests, now, (userId, requestId) => {
      const person = store.person(userId);
      return person !== undefined && scopes.canSeeAll(person, requests.roomsOf(requestId));
    }),
    view: (actor, row) => service.view(actor, row),
    changed: () => world.refresh(),
    notify: (userId) => notify(userId),
  });

  return {
    store,
    tokens,
    runtime,
    service,
    tools,
    conversations,
    requests,
    world,
    onAttention(fn) {
      notify = fn;
    },
    hermes,
    mind,
    mount(router, auth) {
      // Before the agent routes: `/attention` is not an agent id.
      mountAgentWorldRoutes(router, { auth, service: worldService });
      mountMcp(router, { store, tokens, tools, version: opts.version });
      mountToolRoutes(router, { store, tokens, tools });
      mountHermesRoutes(router, { auth, hermes });
      mountOfficeAgentRoutes(router, {
        auth,
        service,
        hermes,
        mind: mindService,
        onRemoved: async (agentId) => {
          await managed?.forget(agentId).catch(() => {
            logger.warn({ agentId }, "could not remove what a managed Hermes left behind");
          });
        },
      });
    },
    bind(next) {
      bound = { ...bound, ...next };
    },
    boot: () => {
      sealAtStart(db, cipher, logger);
      runtime.boot();
      // A shared agent on a Hermes the office runs is not started any more (#301): its card says why.
      for (const row of store.list()) {
        if (row.ownerUserId === null && row.engine === "hermes-managed") {
          store.setStatus(row.id, "error", SHARED_HERMES_STOPPED);
        }
      }
      void managed?.reap();
    },
    close: () => runtime.close(),
  };
}
