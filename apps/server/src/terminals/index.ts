/**
 * Terminals (SPEC §4.3 `terminals/`, §6 channel 3): the tmux + PTY bridge
 * behind `/ws/term/<agentId>`, its ACL, and periodic scrollback snapshots.
 *
 * Boot wiring:
 *   const terminals = createTerminals({ db, auth, logger, dataDir, originPolicy, runners });
 *   new WsRouter().use(terminals.bridge).use(terminals.screens).use(rooms.transport.attachment)
 *
 * `screens` is the laptop screen feed (`/ws/screens/<operationId>`, #25).
 */
import { join } from "node:path";
import type { OriginPolicy } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import type { Logger } from "../logging.ts";
import { dbOperationVisibility } from "./acl.ts";
import { TerminalBridge, type TerminalSessionLookup } from "./bridge.ts";
import { LoginSessionTargets } from "./login-sessions.ts";
import { ScreenFeed } from "./screens.ts";
import { ScrollbackRecorder } from "./scrollback.ts";
import { DbTerminalTargets, RunnerRegistry } from "./targets.ts";

export {
  dbOperationVisibility,
  decideTerminalAccess,
  mayUseTerminal,
  type OperationVisibility,
  type TerminalDecision,
  type TerminalUser,
} from "./acl.ts";
export {
  TERMINAL_ROUTE,
  TerminalBridge,
  type TerminalBridgeOptions,
  type TerminalSessionLookup,
} from "./bridge.ts";
export {
  isLoginTerminalId,
  LOGIN_TERMINAL_ID_PATTERN,
  type LoginSession,
  LoginSessionTargets,
  mayUseLoginTerminal,
} from "./login-sessions.ts";
export { hasBunPty, openPipe, PtyUnavailableError, type TerminalPipe } from "./pipe.ts";
export { ScreenPoller, type ScreenSubscriber } from "./screen-poller.ts";
export { SCREENS_ROUTE, ScreenFeed, type ScreenFeedOptions } from "./screens.ts";
export { capTail, ScrollbackRecorder, type ScrollbackRecorderOptions } from "./scrollback.ts";
export {
  AGENT_ID_PATTERN,
  DbTerminalTargets,
  type OperationTerminalTargets,
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
  screens: ScreenFeed;
  runners: RunnerRegistry;
  /** Login sessions reachable as `/ws/term/login-<id>` (#32). */
  logins: LoginSessionTargets;
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
  const targets = new DbTerminalTargets(options.db, runners);
  const canViewOperation = dbOperationVisibility(options.db);
  const logins = new LoginSessionTargets();
  const bridge = new TerminalBridge({
    targets,
    logins,
    sessions: options.sessions,
    canViewOperation,
    originPolicy: options.originPolicy,
    logger,
    scrollback,
  });
  const screens = new ScreenFeed({
    sources: targets,
    sessions: options.sessions,
    canViewOperation,
    originPolicy: options.originPolicy,
    logger,
  });
  return {
    bridge,
    screens,
    runners,
    logins,
    scrollback,
    async shutdown() {
      bridge.shutdown();
      screens.shutdown();
      await scrollback.stop();
    },
  };
}
