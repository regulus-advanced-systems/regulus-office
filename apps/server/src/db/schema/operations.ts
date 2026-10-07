/**
 * Levels, operations (= projects, one repo and one room each), their repo and
 * membership (SPEC §5, §9.1; D7, D26). Desks are in desks.ts because they
 * reference agents.
 */
import {
  DECOR_STYLES,
  DOOR_SIDES,
  HOLDING_LEVEL_ID,
  LEVEL_KINDS,
  OPERATION_ACCESSES,
  REPO_CLONE_STATUSES,
  ROOM_BUILD_STATES,
} from "@regulus/protocol";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, timestampMs, timestamps } from "./_columns.ts";
import { users } from "./users.ts";

/**
 * Levels of the lair (D26, #268): one per GitHub organisation or personal
 * account that owns an operation repo, created on first use, plus two fixed
 * rows the migration seeds: `lobby` (the shared level, no project rooms) and
 * `holding` (operations whose repo owner is not known). Each level has its
 * own grid of rooms; the grid's size and the lobby's footprint are the one
 * `compound` row, shared by all levels.
 */
export const levels = sqliteTable(
  "levels",
  {
    id: id(),
    /**
     * `org` or `account` is confirmed only once `githubId` is set (the office
     * asks GitHub, levels/owner-lookup.ts); until then an owner's level is an
     * `account`.
     */
    kind: enumText("kind", LEVEL_KINDS).notNull(),
    /** GitHub's numeric id of the organisation or account; null until looked up. */
    githubId: integer("github_id"),
    /** Lowercase GitHub login; null for the lobby and holding levels. */
    login: text("login"),
    /** Display name: the owner's name on GitHub once known, else the login as first typed. */
    name: text("name").notNull(),
    /** Order in level lists and the lift; the lobby is 0. */
    position: integer("position").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("levels_login_unique").on(t.login),
    check("levels_kind_check", inEnum("kind", LEVEL_KINDS)),
  ],
);

export const operations = sqliteTable(
  "operations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /**
     * The level the room is on: its repo owner's (D7, D26). Rows written
     * without one land on the holding level and are moved to their owner's
     * level by `ensureOneRepoPerRoom` (db/one-repo-per-room.ts).
     */
    levelId: text("level_id")
      .notNull()
      .default(HOLDING_LEVEL_ID)
      .references(() => levels.id),
    /**
     * Directory name of the operation under the projects and worktrees roots
     * when it is not `slug`: a room split off a multi-repo operation (#268)
     * keeps using the original operation's directories, so mirrors, clones and
     * worktrees stay where they are. Null = `slug`. See operations/dirs.ts.
     */
    dirSlug: text("dir_slug"),
    /** Elevator order; operation 0 is the lobby and is not a row here. */
    index: integer("index").notNull(),
    paletteId: text("palette_id").notNull(),
    layoutTemplateId: text("layout_template_id").notNull(),
    /**
     * Placement in the compound (SPEC §9.1, #181), in tiles. `gridX`/`gridY`
     * are null only until the compound places the room (boot migration of
     * pre-compound operations). Enums are checked in code: adding a CHECK here
     * would make SQLite rebuild `operations`, and dropping it cascades.
     */
    gridX: integer("grid_x"),
    gridY: integer("grid_y"),
    width: integer("width").notNull().default(10),
    depth: integer("depth").notNull().default(10),
    doorSide: enumText("door_side", DOOR_SIDES).notNull().default("south"),
    buildState: enumText("build_state", ROOM_BUILD_STATES).notNull().default("ready"),
    buildStartedAt: timestampMs("build_started_at"),
    /**
     * Room settings (#182): desks in the generated interior and its lair decor
     * style. Operations migrated from a template get enough desks for its seats.
     */
    deskCount: integer("desk_count").notNull().default(1),
    decorStyle: enumText("decor_style", DECOR_STYLES).notNull().default("ops_room"),
    archivedAt: timestampMs("archived_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("operations_slug_unique").on(t.slug),
    index("operations_index_idx").on(t.index),
    index("operations_level_id_idx").on(t.levelId),
  ],
);

/**
 * The compound (SPEC §5, §9.1): one row, id `main`. Grid bounds and the
 * lobby's footprint; special rooms and corridors derive from these and the
 * rooms' placements. The blast door's state is live-only.
 */
export const compound = sqliteTable(
  "compound",
  {
    id: text("id").primaryKey(),
    width: integer("width").notNull(),
    depth: integer("depth").notNull(),
    lobbyGridX: integer("lobby_grid_x").notNull(),
    lobbyGridY: integer("lobby_grid_y").notNull(),
    lobbyWidth: integer("lobby_width").notNull(),
    lobbyDepth: integer("lobby_depth").notNull(),
    ...timestamps(),
  },
  () => [check("compound_single_row_check", sql.raw(`"id" = 'main'`))],
);

/**
 * The operation's repo: exactly one per operation (D7 as changed 2026-10-07;
 * `operation_repos_operation_unique`). Desks, worktrees and boards belong to it.
 */
export const operationRepos = sqliteTable(
  "operation_repos",
  {
    id: id(),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    /** Clone location on the host, e.g. `/srv/office/projects/<operation>/<repo>` (SPEC §8). */
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
    uniqueIndex("operation_repos_operation_owner_name_unique").on(t.operationId, t.owner, t.name),
    /**
     * Created by `ensureOneRepoPerRoom` after it has split multi-repo
     * operations, not by the SQL migration (which runs before the split).
     */
    uniqueIndex("operation_repos_operation_unique").on(t.operationId),
    check("operation_repos_clone_status_check", inEnum("clone_status", REPO_CLONE_STATUSES)),
  ],
);

export const operationMembers = sqliteTable(
  "operation_members",
  {
    id: id(),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    access: enumText("access", OPERATION_ACCESSES).notNull().default("view"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("operation_members_operation_user_unique").on(t.operationId, t.userId),
    index("operation_members_user_id_idx").on(t.userId),
    check("operation_members_access_check", inEnum("access", OPERATION_ACCESSES)),
  ],
);
