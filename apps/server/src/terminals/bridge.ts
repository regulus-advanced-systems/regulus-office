/**
 * Terminal bridge (SPEC §6 channel 3, #24): `/ws/term/<agentId>?mode=watch|control`.
 *
 * Every upgrade is checked server-side before a socket exists: Origin (SPEC
 * §11), the Better Auth session cookie, then the D12 ACL against the henchman's
 * operation and owner. Each accepted viewer gets its own tmux client; tmux fans
 * the agent's output out to all of them. Plugs into the office `Bun.serve`
 * as a `WsRoute` (http/ws-router.ts) next to the Colyseus transport.
 *
 * Open sockets are registered with the office's live access (#244): a viewer
 * who can no longer see the operation is closed with `ACCESS_CLOSE_CODES.revoked`,
 * one who may now only watch with `changed` (the client comes back in watch mode).
 */
import {
  TERMINAL_DEFAULT_SIZE,
  TERMINAL_MAX_PEERS,
  TERMINAL_MODES,
  TERMINAL_SCROLLBACK_LINES,
  TERMINAL_TYPING_THROTTLE_MS,
  TERMINAL_WS_PREFIX,
  type TerminalMode,
  type TerminalPeer,
} from "@regulus/protocol";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { type AccessVerdict, type LiveAccess, sessionRefOf } from "../auth/live-access.ts";
import { checkOrigin, type OriginPolicy } from "../auth/origin.ts";
import type { WsRoute } from "../http/ws-router.ts";
import type { Logger } from "../logging.ts";
import { UPGRADED } from "../rooms/transport.ts";
import type { TtySize } from "../runners/types.ts";
import { decideTerminalAccess, type OperationVisibility, type TerminalUser } from "./acl.ts";
import { isLoginTerminalId, mayUseLoginTerminal } from "./login-sessions.ts";
import type { ScrollbackRecorder } from "./scrollback.ts";
import { AGENT_ID_PATTERN, type TerminalTarget, type TerminalTargets } from "./targets.ts";
import { TerminalViewer } from "./viewer.ts";

/** Route label for logs and metrics; the agent id never goes into a path label (#90). */
export const TERMINAL_ROUTE = `${TERMINAL_WS_PREFIX}:agentId`;

/** The part of `OfficeAuth` the bridge needs. */
export interface TerminalSessionLookup {
  getSessionFromRequest(request: Request): Promise<TerminalUser | null>;
}

export interface TerminalBridgeOptions {
  targets: TerminalTargets;
  /** Login sessions (`/ws/term/login-<id>`, #32): owner-only, outside the D12 agent ACL. */
  logins?: TerminalTargets;
  sessions: TerminalSessionLookup;
  canViewOperation: OperationVisibility;
  originPolicy: OriginPolicy;
  logger: Logger;
  /** Ends open terminals whose viewer lost the operation or control (#244). */
  liveAccess?: LiveAccess;
  /** Periodic on-disk snapshots of watched agents (optional). */
  scrollback?: ScrollbackRecorder;
  size?: TtySize;
  scrollbackLines?: number;
  maxBufferedBytes?: number;
  /** Clock for the typing throttle (tests). */
  now?: () => number;
}

interface TermSocketData {
  target: TerminalTarget;
  mode: TerminalMode;
  userId: string;
  /** The viewer as they were at the upgrade. */
  user: TerminalUser;
  name: string;
  /** Stop live access tracking. */
  release?: () => void;
  lastTypingAt?: number;
  viewer?: TerminalViewer;
  releaseScrollback?: () => void;
}

const isMode = (value: string): value is TerminalMode =>
  (TERMINAL_MODES as readonly string[]).includes(value);

const reject = (status: number, error: string): Response =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export class TerminalBridge implements WsRoute {
  readonly #opts: TerminalBridgeOptions;
  readonly #logger: Logger;
  readonly #viewers = new Map<string, Set<ServerWebSocket<TermSocketData>>>();
  #onViewed: ((agentId: string, userId: string) => void) | undefined;

  constructor(options: TerminalBridgeOptions) {
    this.#opts = options;
    this.#logger = options.logger;
  }

  routeOf(url: URL): string | undefined {
    return url.pathname.startsWith(TERMINAL_WS_PREFIX) ? TERMINAL_ROUTE : undefined;
  }

  /**
   * Called when someone opens a henchman's terminal and when they type in it (at most
   * once a second): the agent manager lowers a done henchman's hand for its owner (#235).
   */
  onViewed(listener: (agentId: string, userId: string) => void): void {
    this.#onViewed = listener;
  }

  #viewed(ws: ServerWebSocket<TermSocketData>): void {
    const { target, userId } = ws.data;
    if (target.kind === "login") return;
    try {
      this.#onViewed?.(target.agentId, userId);
    } catch (err) {
      this.#logger.warn({ err: String(err) }, "terminal view listener failed");
    }
  }

  /** Viewers currently connected to `agentId`'s terminal. */
  viewerCount(agentId: string): number {
    return this.#viewers.get(agentId)?.size ?? 0;
  }

  /** Disconnect every viewer (server shutdown); agents keep running in tmux. */
  shutdown(): void {
    for (const sockets of this.#viewers.values()) {
      for (const ws of sockets) ws.close(1001, "server shutdown");
    }
  }

  fetch = async (
    request: Request,
    url: URL,
    server: Server<unknown>,
  ): Promise<Response | typeof UPGRADED | undefined> => {
    if (!url.pathname.startsWith(TERMINAL_WS_PREFIX)) return undefined;
    const log = this.#logger.child({ route: TERMINAL_ROUTE });
    const agentId = url.pathname.slice(TERMINAL_WS_PREFIX.length);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return reject(426, "websocket_required");
    }
    const origin = checkOrigin(request, this.#opts.originPolicy.publicUrl, this.#opts.originPolicy);
    if (!origin.ok) {
      log.warn({ origin: origin.origin, reason: origin.reason }, "rejected cross-origin terminal");
      return reject(403, "origin_rejected");
    }
    const mode = url.searchParams.get("mode") ?? "watch";
    if (!isMode(mode)) return reject(400, "invalid_mode");

    const user = await this.#opts.sessions.getSessionFromRequest(request);
    if (!user) return reject(401, "unauthenticated");
    if (!AGENT_ID_PATTERN.test(agentId)) return reject(404, "not_found");

    const login = isLoginTerminalId(agentId);
    const target = login
      ? ((await this.#opts.logins?.resolve(agentId)) ?? null)
      : await this.#opts.targets.resolve(agentId);
    if (!target) return reject(404, "not_found");
    if (login) {
      // A login terminal is its owner's alone (admins too are refused), and its existence is not revealed.
      if (target.kind !== "login" || !mayUseLoginTerminal(user, target.ownerUserId)) {
        log.info({ userId: user.id, mode }, "login terminal denied");
        return reject(404, "not_found");
      }
    }
    const decision = login
      ? ({ ok: true } as const)
      : decideTerminalAccess(user, target, mode, this.#opts.canViewOperation);
    if (!decision.ok) {
      log.info({ agentId, userId: user.id, mode, reason: decision.reason }, "terminal denied");
      return decision.reason === "forbidden" ? reject(403, "forbidden") : reject(404, "not_found");
    }
    let exists: boolean;
    try {
      exists = await target.runner.sessionExists(target.session);
    } catch (err) {
      log.warn({ err, agentId }, "runner unreachable");
      return reject(502, "runner_unavailable");
    }
    if (!exists) return reject(404, "session_not_found");

    const name = (user.displayName ?? user.id).slice(0, 64);
    const data: TermSocketData = { target, mode, userId: user.id, user, name };
    if (!server.upgrade(request, { data })) return reject(400, "upgrade_failed");
    log.info({ agentId: login ? "login" : agentId, userId: user.id, mode }, "terminal attached");
    return UPGRADED;
  };

  readonly websocket: WebSocketHandler<unknown> = {
    open: (ws) => this.#open(ws as ServerWebSocket<TermSocketData>),
    message: (ws, message) =>
      (ws as ServerWebSocket<TermSocketData>).data.viewer?.onMessage(message),
    close: (ws) => this.#close(ws as ServerWebSocket<TermSocketData>),
  };

  #open(ws: ServerWebSocket<TermSocketData>): void {
    const { target, mode, userId } = ws.data;
    const size = this.#opts.size ?? TERMINAL_DEFAULT_SIZE;
    const viewer = new TerminalViewer(ws as ServerWebSocket<unknown>, {
      target,
      mode,
      userId,
      size,
      scrollbackLines: this.#opts.scrollbackLines ?? TERMINAL_SCROLLBACK_LINES,
      maxBufferedBytes: this.#opts.maxBufferedBytes ?? 4 * 1024 * 1024,
      logger: this.#logger,
      onInput: () => this.#typing(ws),
    });
    ws.data.viewer = viewer;
    // Login terminals show the human's own sign-in: never snapshotted to disk.
    if (target.kind !== "login") ws.data.releaseScrollback = this.#opts.scrollback?.track(target);
    let sockets = this.#viewers.get(target.agentId);
    if (!sockets) {
      sockets = new Set();
      this.#viewers.set(target.agentId, sockets);
    }
    sockets.add(ws);
    viewer.sendControl({
      type: "hello",
      mode,
      cols: size.cols,
      rows: size.rows,
      viewers: sockets.size,
      peers: this.#peers(sockets),
    });
    this.#announce(target.agentId, ws);
    this.#viewed(ws);
    ws.data.release = this.#opts.liveAccess?.register({
      kind: "terminal",
      user: { id: userId, role: ws.data.user.role },
      session: sessionRefOf(ws.data.user),
      operationId: target.kind === "login" ? null : target.operationId,
      check: (now) => this.#stillAllowed(now, target, mode),
      close: (code, reason) => {
        // Detach first: no more output goes out and no more input is taken.
        viewer.dispose();
        ws.close(code, reason);
      },
    });
    void viewer.start();
  }

  /** The upgrade's decision again, for the viewer as they are now. */
  #stillAllowed(user: TerminalUser, target: TerminalTarget, mode: TerminalMode): AccessVerdict {
    if (target.kind === "login") {
      return mayUseLoginTerminal(user, target.ownerUserId) ? "keep" : "revoked";
    }
    const decision = decideTerminalAccess(user, target, mode, this.#opts.canViewOperation);
    if (decision.ok) return "keep";
    return decision.reason === "forbidden" ? "changed" : "revoked";
  }

  #close(ws: ServerWebSocket<TermSocketData>): void {
    const { target, viewer, releaseScrollback } = ws.data;
    ws.data.release?.();
    viewer?.dispose();
    releaseScrollback?.();
    const sockets = this.#viewers.get(target.agentId);
    if (!sockets?.delete(ws)) return;
    if (sockets.size === 0) this.#viewers.delete(target.agentId);
    this.#announce(target.agentId);
  }

  /** Tell the other viewers of `agentId` how many are watching now. */
  #announce(agentId: string, except?: ServerWebSocket<TermSocketData>): void {
    const sockets = this.#viewers.get(agentId);
    if (!sockets) return;
    const peers = this.#peers(sockets);
    for (const ws of sockets) {
      if (ws !== except)
        ws.data.viewer?.sendControl({ type: "viewers", viewers: sockets.size, peers });
    }
  }

  #peers(sockets: Set<ServerWebSocket<TermSocketData>>): TerminalPeer[] {
    return [...sockets]
      .slice(0, TERMINAL_MAX_PEERS)
      .map((ws) => ({ userId: ws.data.userId, name: ws.data.name, mode: ws.data.mode }));
  }

  /** A control viewer typed: tell the others who (never what), at most once a second. */
  #typing(from: ServerWebSocket<TermSocketData>): void {
    const now = (this.#opts.now ?? Date.now)();
    const last = from.data.lastTypingAt;
    if (last !== undefined && now - last < TERMINAL_TYPING_THROTTLE_MS) return;
    from.data.lastTypingAt = now;
    this.#viewed(from);
    const sockets = this.#viewers.get(from.data.target.agentId);
    if (!sockets) return;
    const message = { type: "typing", userId: from.data.userId, name: from.data.name } as const;
    for (const ws of sockets) if (ws !== from) ws.data.viewer?.sendControl(message);
  }
}
