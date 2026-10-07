/**
 * Whiteboards (SPEC §4.3 `whiteboard/`, §6 channel 4, §9.4; #45): the Yjs
 * endpoint `/ws/wb/<boardId>`, persistence in `whiteboards`, and the wall
 * snapshot REST.
 *
 * Boot wiring:
 *   const whiteboards = createWhiteboards({ db, sessions: auth, logger, dataDir, originPolicy,
 *     onSnapshot });
 *   new WsRouter().use(whiteboards.endpoint) ...; whiteboards.mount(server.router, auth);
 */
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { LiveAccess } from "../auth/live-access.ts";
import type { OriginPolicy } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import { type BoardUser, dbBoardAccess } from "./access.ts";
import { WhiteboardEndpoint, type WhiteboardSessionLookup } from "./endpoint.ts";
import { mountWhiteboardRoutes } from "./routes.ts";
import { WhiteboardStore } from "./store.ts";

export { BOARD_ID_PATTERN, type BoardAccessCheck, dbBoardAccess } from "./access.ts";
export { type BoardPeer, LiveBoard } from "./board.ts";
export { WHITEBOARD_ROUTE, WhiteboardEndpoint } from "./endpoint.ts";
export { mountWhiteboardRoutes, pngSize } from "./routes.ts";
export { WhiteboardStore } from "./store.ts";

export interface WhiteboardsOptions {
  db: Db;
  sessions: WhiteboardSessionLookup;
  logger: Logger;
  /** OFFICE_DATA_DIR; snapshots go to `<dataDir>/whiteboards`. */
  dataDir: string;
  originPolicy: OriginPolicy;
  /** Ends open board sockets on lost or reduced access (#244). */
  liveAccess?: LiveAccess;
  /** A board has a new wall snapshot: publish its version to the room state. */
  onSnapshot: (boardId: string, version: number) => void;
  saveDelayMs?: number;
  maxSaveDelayMs?: number;
}

export interface Whiteboards {
  endpoint: WhiteboardEndpoint;
  store: WhiteboardStore;
  mount(
    router: Router,
    auth: {
      getSessionFromRequest(request: Request): Promise<BoardUser | null>;
      publicUrl: string;
      allowedOrigins?: readonly string[];
    },
  ): void;
  /** Remove snapshot files no board refers to any more (deleted operations). */
  pruneSnapshots(): Promise<number>;
  shutdown(): void;
}

export function createWhiteboards(options: WhiteboardsOptions): Whiteboards {
  const logger = options.logger.child({ component: "whiteboard" });
  const store = new WhiteboardStore(options.db);
  const access = dbBoardAccess(options.db);
  const snapshotDir = join(options.dataDir, "whiteboards");
  const endpoint = new WhiteboardEndpoint({
    store,
    sessions: options.sessions,
    access,
    originPolicy: options.originPolicy,
    logger,
    liveAccess: options.liveAccess,
    saveDelayMs: options.saveDelayMs,
    maxSaveDelayMs: options.maxSaveDelayMs,
  });
  return {
    endpoint,
    store,
    mount(router, auth) {
      mountWhiteboardRoutes(router, {
        sessions: auth,
        publicUrl: auth.publicUrl,
        allowedOrigins: auth.allowedOrigins,
        store,
        access,
        snapshotDir,
        onSnapshot: options.onSnapshot,
      });
    },
    async pruneSnapshots() {
      let names: string[];
      try {
        names = await readdir(snapshotDir);
      } catch {
        return 0;
      }
      const keep = store.snapshotFiles();
      let removed = 0;
      for (const name of names) {
        if (keep.has(name)) continue;
        await unlink(join(snapshotDir, name)).catch(() => {});
        removed += 1;
      }
      if (removed > 0) logger.info({ removed }, "pruned orphaned whiteboard snapshots");
      return removed;
    },
    shutdown: () => endpoint.shutdown(),
  };
}
