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
import { mountMcp } from "./mcp.ts";
import { HumanRequests } from "./requests.ts";
import { mountOfficeAgentRoutes } from "./routes.ts";
import { AgentRuntime } from "./runtime.ts";
import { OfficeAgentService } from "./service.ts";
import { OfficeAgentStore } from "./store.ts";
import { OfficeAgentTokens } from "./tokens.ts";
import { mountToolRoutes } from "./tool-routes.ts";
import { OfficeTools } from "./tools/call.ts";
import { type CommentTarget, type OfficePorts, ToolError } from "./tools/context.ts";

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

const unavailable = (what: string) => () => {
  throw new ToolError("unavailable", `${what} is not available right now`);
};

export function createOfficeAgents(opts: OfficeAgentsOptions): OfficeAgents {
  const { db } = opts;
  const now = opts.now ?? Date.now;
  const logger = opts.logger.child({ module: "office-agents" });
  const store = new OfficeAgentStore(db, now);
  const tokens = new OfficeAgentTokens(db, now);
  const conversations = new Conversations(db, now);
  const requests = new HumanRequests(db, now);
  const credentials = new AgentCredentials(db, opts.keyring);
  const runtime = new AgentRuntime({
    store,
    tokens,
    conversations,
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
    { store, access: new AgentAccess(store), conversations, requests, ports, now },
    logger,
  );
  const service = new OfficeAgentService({
    store,
    tokens,
    runtime,
    conversations,
    requests,
    credentials,
  });

  return {
    store,
    tokens,
    runtime,
    service,
    tools,
    conversations,
    requests,
    mount(router, auth) {
      mountMcp(router, { store, tokens, tools, version: opts.version });
      mountToolRoutes(router, { store, tokens, tools });
      mountOfficeAgentRoutes(router, { auth, service });
    },
    bind(next) {
      bound = { ...bound, ...next };
    },
    boot: () => runtime.boot(),
    close: () => runtime.close(),
  };
}
