/**
 * Boot wiring for the lobby jukebox (#47): the library (bundled tracks
 * seeded at boot), its REST routes, and the player the BuildingRoom runs
 * (`BuildingRoomDeps.jukebox`), saved in `jukebox_state`.
 */
import type { OfficeAuth } from "../auth/auth.ts";
import type { Db } from "../db/index.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import { JukeboxLibrary } from "./library.ts";
import { createJukeboxPlayer, type JukeboxPlayer } from "./player.ts";
import { mountJukeboxRoutes } from "./routes.ts";
import { JukeboxStateStore } from "./state-store.ts";

export interface Jukebox {
  library: JukeboxLibrary;
  player: JukeboxPlayer;
  mount(
    router: Router,
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">,
  ): void;
}

export interface JukeboxDeps {
  db: Db;
  dataDir: string;
  logger: Logger;
  /** Override the bundled files' directory (tests). */
  bundledDir?: string;
  now?: () => number;
}

export function createJukebox(deps: JukeboxDeps): Jukebox {
  const library = new JukeboxLibrary({
    db: deps.db,
    dataDir: deps.dataDir,
    bundledDir: deps.bundledDir,
  });
  library.seedBundled();
  const store = new JukeboxStateStore(deps.db);
  const player = createJukeboxPlayer({
    track: (id) => library.get(id),
    bundled: () => library.list().filter((t) => t.bundled),
    setDuration: (id, ms) => library.setDuration(id, ms),
    load: () => store.load(),
    save: (state) => {
      try {
        store.save(state);
      } catch (err) {
        deps.logger.error({ err }, "saving the jukebox failed");
      }
    },
    now: deps.now,
  });
  return {
    library,
    player,
    mount(router, auth) {
      mountJukeboxRoutes(router, { auth, library, logger: deps.logger });
    },
  };
}
