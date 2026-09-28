/**
 * Floors (= projects), their repos and membership (SPEC §5, §9.1). Desks are
 * in desks.ts because they reference agents.
 */
import { FLOOR_ACCESSES, REPO_CLONE_STATUSES } from "@regulus/protocol";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, timestampMs, timestamps } from "./_columns.ts";
import { users } from "./users.ts";

export const floors = sqliteTable(
  "floors",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Elevator order; floor 0 is the lobby and is not a row here. */
    index: integer("index").notNull(),
    paletteId: text("palette_id").notNull(),
    layoutTemplateId: text("layout_template_id").notNull(),
    archivedAt: timestampMs("archived_at"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("floors_slug_unique").on(t.slug), index("floors_index_idx").on(t.index)],
);

/** A floor has 1..n repos; desks, worktrees and boards bind to one repo. */
export const floorRepos = sqliteTable(
  "floor_repos",
  {
    id: id(),
    floorId: text("floor_id")
      .notNull()
      .references(() => floors.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    /** Clone location on the host, e.g. `/srv/office/projects/<floor>/<repo>` (SPEC §8). */
    workdir: text("workdir").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    /** Clone progress on the host; `cloneError` holds a redacted reason when it failed. */
    cloneStatus: enumText("clone_status", REPO_CLONE_STATUSES).notNull().default("cloning"),
    cloneError: text("clone_error"),
    /**
     * Project credential (SPEC §8, D14 fallback): a fine-grained PAT scoped to
     * this repo, envelope-encrypted by apps/server/src/secrets with the AAD
     * bound to this row's id. Null for public repos. Never leaves the server.
     */
    encryptedCredential: text("encrypted_credential"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("floor_repos_floor_owner_name_unique").on(t.floorId, t.owner, t.name),
    check("floor_repos_clone_status_check", inEnum("clone_status", REPO_CLONE_STATUSES)),
  ],
);

export const floorMembers = sqliteTable(
  "floor_members",
  {
    id: id(),
    floorId: text("floor_id")
      .notNull()
      .references(() => floors.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    access: enumText("access", FLOOR_ACCESSES).notNull().default("view"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("floor_members_floor_user_unique").on(t.floorId, t.userId),
    index("floor_members_user_id_idx").on(t.userId),
    check("floor_members_access_check", inEnum("access", FLOOR_ACCESSES)),
  ],
);
