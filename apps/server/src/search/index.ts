/**
 * Search across chat and persisted terminal scrollback (SPEC D10, #41).
 *
 * Boot wiring:
 *   const search = createSearch({ db, logger, dataDir });
 *   search.mount(server.router, auth);
 *   search.start();                     // shutdown: search.stop()
 *
 * text.ts strips ANSI and scrubs credentials, chunks.ts cuts scrollback into
 * diffable chunks, indexer.ts keeps the FTS5 index (schema.ts) in step with
 * chat and the snapshots, query.ts turns user input into a safe MATCH
 * expression, searcher.ts applies the floor / terminal ACL, routes.ts serves it.
 */
import { join } from "node:path";
import type { OfficeAuth } from "../auth/auth.ts";
import type { Db } from "../db/index.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import { dbFloorVisibility, type FloorVisibility } from "../terminals/acl.ts";
import { SearchIndexer } from "./indexer.ts";
import { mountSearchRoutes } from "./routes.ts";
import { Searcher } from "./searcher.ts";

export { chunkScrollback } from "./chunks.ts";
export { SearchIndexer } from "./indexer.ts";
export { parseSearchQuery } from "./query.ts";
export { mountSearchRoutes, SEARCH_RATE_LIMIT } from "./routes.ts";
export { Searcher } from "./searcher.ts";
export { indexableText, scrubSecrets, stripAnsi } from "./text.ts";

export interface SearchOptions {
  db: Db;
  logger: Logger;
  /** OFFICE_DATA_DIR; snapshots are read from `<dataDir>/terminals/scrollback`. */
  dataDir: string;
  canViewFloor?: FloorVisibility;
  intervalMs?: number;
}

export interface Search {
  indexer: SearchIndexer;
  searcher: Searcher;
  mount(router: Router, auth: Pick<OfficeAuth, "getSessionFromRequest">): void;
  start(): void;
  stop(): Promise<void>;
}

export function createSearch(options: SearchOptions): Search {
  const logger = options.logger.child({ component: "search" });
  const indexer = new SearchIndexer({
    db: options.db,
    scrollbackDir: join(options.dataDir, "terminals", "scrollback"),
    logger,
    intervalMs: options.intervalMs,
  });
  const searcher = new Searcher({
    db: options.db,
    canViewFloor: options.canViewFloor ?? dbFloorVisibility(options.db),
  });
  return {
    indexer,
    searcher,
    mount: (router, auth) =>
      mountSearchRoutes(router, {
        auth,
        searcher,
        logger,
        beforeQuery: () => {
          try {
            indexer.syncChat();
          } catch (err) {
            logger.warn({ err: String(err) }, "chat indexing failed");
          }
        },
      }),
    start: () => indexer.start(),
    stop: () => indexer.stop(),
  };
}
