/**
 * Boot wiring for henchman skins (#184): the rule store, its REST routes,
 * and the OperationRooms' skin resolver, which republishes every henchman's skin
 * whenever a rule changes.
 */
import type { OfficeAuth } from "../auth/auth.ts";
import type { Db } from "../db/index.ts";
import type { Router } from "../http/router.ts";
import type { OperationRooms } from "../rooms/index.ts";
import { mountSkinRoutes } from "./routes.ts";
import { SkinRuleStore } from "./store.ts";

export interface Skins {
  rules: SkinRuleStore;
  mount(
    router: Router,
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">,
  ): void;
  /** Resolve the henchmen's skins on these OperationRooms, now and after every rule change. */
  publishTo(operations: Pick<OperationRooms, "setSkins">): () => void;
}

export function createSkins(deps: { db: Db }): Skins {
  const rules = new SkinRuleStore(deps.db);
  return {
    rules,
    mount(router, auth) {
      mountSkinRoutes(router, { auth, db: deps.db, rules });
    },
    publishTo(operations) {
      const resolver = (henchman: Parameters<SkinRuleStore["skinFor"]>[0]) =>
        rules.skinFor(henchman);
      operations.setSkins(resolver);
      const off = rules.onChange(() => operations.setSkins(resolver));
      return () => {
        off();
        operations.setSkins(undefined);
      };
    },
  };
}
