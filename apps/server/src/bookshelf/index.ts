/**
 * The room's bookshelf: the repo's Markdown docs, read from the office's
 * mirror (SPEC §8, D17, D27; #264).
 *
 * Boot wiring:
 *   const bookshelf = createBookshelf({ db, logger, repos: operations.repos, refresh });
 *   bookshelf.mount(server.router, auth);
 */
import type { OfficeAuth } from "../auth/auth.ts";
import type { Router } from "../http/router.ts";
import { mountBookshelfRoutes } from "./routes.ts";
import { Bookshelf, type BookshelfDeps } from "./service.ts";

export { BOOKSHELF_ROUTE } from "./routes.ts";
export { Bookshelf, REFRESH_AFTER_MS } from "./service.ts";

export function createBookshelf(deps: BookshelfDeps) {
  const bookshelf = new Bookshelf({ ...deps, logger: deps.logger.child({ module: "bookshelf" }) });
  return {
    bookshelf,
    mount: (router: Router, auth: Pick<OfficeAuth, "getSessionFromRequest">) =>
      mountBookshelfRoutes(router, { auth, bookshelf }),
  };
}
