/**
 * Humans: Better Auth `users`, office-specific `user_profiles`, and `invites`
 * (SPEC §5, §13; roles in SPEC §2).
 */
import { DEFAULT_GENIUS_LOOK, USER_ROLES } from "@regulus/protocol";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, jsonText, timestampMs, timestamps } from "./_columns.ts";

/** Pre-#185 profiles and new ones start as the default genius until the picker saves one. */
export const DEFAULT_AVATAR_JSON = JSON.stringify(DEFAULT_GENIUS_LOOK);

/**
 * Better Auth's core user table. Columns and names follow Better Auth's
 * expected shape exactly so #11 can plug the library in without a mapping;
 * anything office-specific lives in `user_profiles`.
 */
export const users = sqliteTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const userProfiles = sqliteTable(
  "user_profiles",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    role: enumText("role", USER_ROLES).notNull().default("member"),
    /**
     * The human's genius as JSON (protocol `GeniusLook`: archetype, colour ids,
     * accessory), validated on write by apps/server/src/profile; read through
     * `resolveGeniusLook` so a stale value falls back field by field.
     */
    avatar: jsonText("avatar").notNull().default(DEFAULT_AVATAR_JSON),
    /** When the human confirmed a genius in the picker; null until then (first-login picker). */
    avatarChosenAt: timestampMs("avatar_chosen_at"),
    /** Runner identity this human's agents execute as (SPEC §8); null until provisioned. */
    runnerId: text("runner_id"),
    /** Linux uid of the runner user for the `linux-user` backend; null for `docker`. */
    linuxUid: integer("linux_uid"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("user_profiles_user_id_unique").on(t.userId),
    check("user_profiles_role_check", inEnum("role", USER_ROLES)),
  ],
);

/**
 * Where a person last stood (#262): one row per person, rewritten as they
 * walk and when they leave, so they come back there on any device. It is a
 * wish only: on return the BuildingRoom asks the access gate whether they may
 * be there now (rooms/building/return-place.ts) and deletes the row when not.
 * `levelId` and `operationId` are plain text, not references: a level or room
 * that is gone must not be told apart from one that is closed to them.
 */
export const userPlaces = sqliteTable("user_places", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  levelId: text("level_id").notNull(),
  /** The project room they stood in; the lobby id anywhere else on the level. */
  operationId: text("operation_id").notNull(),
  /** Compound metres on that level, and the way they faced (radians). */
  x: real("x").notNull(),
  z: real("z").notNull(),
  heading: real("heading").notNull(),
  ...timestamps(),
});

export const invites = sqliteTable(
  "invites",
  {
    id: id(),
    token: text("token").notNull(),
    role: enumText("role", USER_ROLES).notNull().default("member"),
    expiresAt: timestampMs("expires_at").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    usedBy: text("used_by").references(() => users.id, { onDelete: "set null" }),
    usedAt: timestampMs("used_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("invites_token_unique").on(t.token),
    index("invites_expires_at_idx").on(t.expiresAt),
    check("invites_role_check", inEnum("role", USER_ROLES)),
  ],
);
