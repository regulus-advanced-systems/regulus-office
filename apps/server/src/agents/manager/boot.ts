/**
 * Boot wiring for agents: adapter registry
 * (the Claude Code instance is shared with the hook routes so held
 * permission requests resolve), the AgentManager, its registration with the
 * terminal bridge (#24) and the FloorRoom, and the hook routes' sink/tokens.
 */
import { AdapterRegistry, ClaudeCodeAdapter, CodexAdapter } from "@regulus/agent-adapters";
import type { OfficeConfig } from "../../config.ts";
import type { Db } from "../../db/index.ts";
import type { Router } from "../../http/router.ts";
import type { Logger } from "../../logging.ts";
import type { Rooms } from "../../rooms/index.ts";
import type { Runner } from "../../runners/types.ts";
import type { MasterKeyring } from "../../secrets/index.ts";
import type { Terminals } from "../../terminals/index.ts";
import type { Workspaces } from "../../worktrees/types.ts";
import { mountClaudeHookRoutes } from "../hooks/index.ts";
import { floorAgentCommands } from "./commands.ts";
import { AgentManager, type AgentWorktreeTools } from "./manager.ts";

export interface AgentsBootOptions {
  db: Db;
  config: OfficeConfig;
  logger: Logger;
  rooms: Rooms;
  terminals: Terminals;
  router: Router;
  keyring: MasterKeyring | undefined;
  runner: Runner;
  /** Per-agent git worktrees (#31). */
  workspaces: Workspaces;
  /** Worktree status and the one-click PR (#31) for `agent.worktree` / `agent.pr`. */
  worktreeTools?: AgentWorktreeTools;
}

export async function createAgents(opts: AgentsBootOptions): Promise<AgentManager> {
  const runner = opts.runner;
  const claude = new ClaudeCodeAdapter();
  const manager = new AgentManager({
    db: opts.db,
    runner,
    adapters: new AdapterRegistry([claude, new CodexAdapter()]),
    robots: opts.rooms.floors,
    workspaces: opts.workspaces,
    worktreeTools: opts.worktreeTools,
    refreshFloors: () => opts.rooms.refreshFloors(),
    keyring: opts.keyring,
    // TODO(#104): use OFFICE_RUNNER_OFFICE_URL once it exists; publicUrl is
    // only right when runners reach the office on its public origin.
    officeUrl: opts.config.publicUrl,
    logger: opts.logger,
    scrollback: opts.terminals.scrollback,
  });
  opts.terminals.runners.setDefault(runner);
  opts.rooms.floors.setAgentCommands(floorAgentCommands(manager));
  mountClaudeHookRoutes(opts.router, {
    sink: manager,
    tokens: manager.tokens,
    adapter: claude,
    contextFor: (agentId) => manager.contextFor(agentId),
    logger: opts.logger,
  });
  return manager;
}
