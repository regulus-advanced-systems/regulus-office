/**
 * Boot wiring for henchman skins (#184): the rule store, its REST routes,
 * and the FloorRooms' skin resolver, which republishes every robot's skin
 * whenever a rule changes.
 */
import type { OfficeAuth } from "../auth/auth.ts";
import type { Db } from "../db/index.ts";
import type { Router } from "../http/router.ts";
import type { FloorRooms } from "../rooms/index.ts";
import { mountSkinRoutes } from "./routes.ts";
import { SkinRuleStore } from "./store.ts";

export interface Skins {
  rules: SkinRuleStore;
  mount(
    router: Router,
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">,
  ): void;
  /** Resolve the robots' skins on these FloorRooms, now and after every rule change. */
  publishTo(floors: Pick<FloorRooms, "setSkins">): () => void;
}

export function createSkins(deps: { db: Db }): Skins {
  const rules = new SkinRuleStore(deps.db);
  return {
    rules,
    mount(router, auth) {
      mountSkinRoutes(router, { auth, db: deps.db, rules });
    },
    publishTo(floors) {
      const resolver = (robot: Parameters<SkinRuleStore["skinFor"]>[0]) => rules.skinFor(robot);
      floors.setSkins(resolver);
      const off = rules.onChange(() => floors.setSkins(resolver));
      return () => {
        off();
        floors.setSkins(undefined);
      };
    },
  };
}
