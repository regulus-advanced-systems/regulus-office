/**
 * Admin-set henchman skins (SPEC §5 `skin_rules`, §9.3 D22; #184): a rule
 * matches robots by `role:pm`, `office_agent:<id>` or `provider:<id>` and
 * gives them a skin from the built-in set; the best rule wins by priority
 * (protocol `resolveSkin`).
 */
import { HENCHMAN_SKIN_IDS } from "@regulus/protocol";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, timestamps } from "./_columns.ts";
import { users } from "./users.ts";

export const skinRules = sqliteTable(
  "skin_rules",
  {
    id: id(),
    /** `role:pm`, `office_agent:<id>` or `provider:<id>` (validated by the protocol). */
    match: text("match").notNull(),
    skinId: enumText("skin_id", HENCHMAN_SKIN_IDS).notNull(),
    /** Higher wins; ties go to the more specific match, then the older rule. */
    priority: integer("priority").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  () => [check("skin_rules_skin_id_check", inEnum("skin_id", HENCHMAN_SKIN_IDS))],
);
