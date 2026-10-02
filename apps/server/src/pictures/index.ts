/**
 * Wall pictures (SPEC §5 `decor`, §6, §9.4, §11; #46).
 *
 * Boot wiring:
 *   const pictures = createWallPictures({ db, dataDir, logger, operations: rooms.operations });
 *   pictures.mount(server.router, auth);
 */
import type { OfficeAuth } from "../auth/auth.ts";
import type { Db } from "../db/index.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { OperationRooms } from "../rooms/operation/room.ts";
import { mountPictureRoutes } from "./routes.ts";
import { WallPictures } from "./service.ts";

export { inspectImage, sniffKind } from "./image.ts";
export { PICTURE_BODY_MAX_BYTES } from "./routes.ts";
export { WallPictures } from "./service.ts";
export { PICTURE_DIR, PictureStore } from "./store.ts";

export interface WallPicturesSetup {
  pictures: WallPictures;
  mount(
    router: Router,
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">,
  ): void;
}

export function createWallPictures(deps: {
  db: Db;
  dataDir: string;
  logger: Logger;
  operations: Pick<OperationRooms, "publishDecor" | "setDecorCommands">;
}): WallPicturesSetup {
  const logger = deps.logger.child({ module: "pictures" });
  const pictures = new WallPictures({
    db: deps.db,
    dataDir: deps.dataDir,
    logger,
    publish: (operationId, decor) => deps.operations.publishDecor(operationId, decor),
  });
  deps.operations.setDecorCommands(pictures);
  pictures.publishAll();
  pictures.store
    .prune()
    .then((n) => n > 0 && logger.info({ removed: n }, "pruned orphaned picture files"))
    .catch((err) => logger.warn({ err }, "picture prune failed"));
  return {
    pictures,
    mount: (router, auth) => mountPictureRoutes(router, { auth, pictures }),
  };
}
