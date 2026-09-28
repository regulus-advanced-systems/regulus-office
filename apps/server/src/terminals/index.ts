/**
 * Terminals (SPEC §4.3 `terminals/`, §6 channel 3): the tmux + PTY bridge
 * behind `/ws/term/<agentId>`, its ACL, and periodic scrollback snapshots.
 *
 * Boot wiring:
 *   const terminals = createTerminals({ db, auth, logger, dataDir, originPolicy, runners });
 *   new WsRouter().use(terminals.bridge).use(rooms.transport.attachment)
 */
import { join } from "node:path";
import type { OriginPolicy } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import type { Logger } from "../logging.ts";
import { dbFloorVisibility } from "./acl.ts";
import { TerminalBridge, type TerminalSessionLookup } from "./bridge.ts";
import { ScrollbackRecorder } from "./scrollback.ts";
import { DbTerminalTargets, RunnerRegistry } from "./targets.ts";

export {
  dbFloorVisibility,
  decideTerminalAccess,
  type FloorVisibility,
  mayUseTerminal,
  type TerminalDecision,
  type TerminalUser,
} from "./acl.ts";
export {
  TERMINAL_ROUTE,
  TerminalBridge,
  type TerminalBridgeOptions,
  type TerminalSessionLookup,
} from "./bridge.ts";
export { hasBunPty, openPipe, PtyUnavailableError, type TerminalPipe } from "./pipe.ts";
export { capTail, ScrollbackRecorder, type ScrollbackRecorderOptions } from "./scrollback.ts";
export {
  AGENT_ID_PATTERN,
  DbTerminalTargets,
  type RunnerLookup,
  RunnerRegistry,
  type TerminalTarget,
  type TerminalTargets,
} from "./targets.ts";

export interface TerminalsOptions {
  db: Db;
  sessions: TerminalSessionLookup;
  logger: Logger;
  /** OFFICE_DATA_DIR; snapshots go to `<dataDir>/terminals/scrollback`. */
  dataDir: string;
  originPolicy: OriginPolicy;
  /** Runner backends by human; empty until the AgentManager (#26) registers one. */
  runners?: RunnerRegistry;
}

export interface Terminals {
  bridge: TerminalBridge;
  runners: RunnerRegistry;
  scrollback: ScrollbackRecorder;
  shutdown(): Promise<void>;
}

export function createTerminals(options: TerminalsOptions): Terminals {
  const logger = options.logger.child({ component: "terminals" });
  const runners = options.runners ?? new RunnerRegistry();
  const scrollback = new ScrollbackRecorder({
    dir: join(options.dataDir, "terminals", "scrollback"),
    logger,
  });
  const bridge = new TerminalBridge({
    targets: new DbTerminalTargets(options.db, runners),
    sessions: options.sessions,
    canViewFloor: dbFloorVisibility(options.db),
    originPolicy: options.originPolicy,
    logger,
    scrollback,
  });
  return {
    bridge,
    runners,
    scrollback,
    async shutdown() {
      bridge.shutdown();
      await scrollback.stop();
    },
  };
}
