/**
 * Humans: Better Auth `users`, office-specific `user_profiles`, and `invites`
 * (SPEC §5, §13; roles in SPEC §2).
 */
import { USER_ROLES } from "@regulus/protocol";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, timestampMs, timestamps } from "./_columns.ts";

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
    /** Robot colour set chosen for the human's avatar (protocol `AvatarLook.colorSet`). */
    avatarColorSet: text("avatar_color_set").notNull().default("default"),
    /** Accessory (antenna, visor, cap, ...) for the human's avatar (`AvatarLook.accessory`). */
    avatarAccessory: text("avatar_accessory").notNull().default("none"),
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
