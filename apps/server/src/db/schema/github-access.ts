/**
 * A person's own GitHub access (SPEC D27; #267): the linked GitHub account and
 * the snapshot of what it can see. The office answers "may this person see
 * this repo" from these tables, never by calling GitHub on a request.
 *
 * The user token is an envelope from apps/server/src/secrets with the AAD
 * bound to the office user and the column (SPEC §8). It never leaves the
 * server: not to a client, not to a henchman.
 */
import { GITHUB_REPO_PERMISSIONS } from "@regulus/protocol";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, timestampMs, timestamps } from "./_columns.ts";
import { operationRepos } from "./operations.ts";
import { users } from "./users.ts";

export const GITHUB_USER_LINK_STATUSES = ["linked", "revoked"] as const;
export type GitHubUserLinkStatus = (typeof GITHUB_USER_LINK_STATUSES)[number];

/**
 * One row per office user who linked a GitHub account. `revoked` keeps the
 * row (so Settings can say why the rooms closed) with every token column null.
 */
export const githubUserLinks = sqliteTable(
  "github_user_links",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** GitHub's numeric account id: stable across renames. */
    githubUserId: integer("github_user_id").notNull(),
    login: text("login").notNull(),
    status: enumText("status", GITHUB_USER_LINK_STATUSES).notNull().default("linked"),
    encryptedToken: text("encrypted_token"),
    /** GitHub App user tokens expire and come with a refresh token; OAuth App tokens do not. */
    encryptedRefreshToken: text("encrypted_refresh_token"),
    tokenExpiresAt: timestampMs("token_expires_at"),
    refreshTokenExpiresAt: timestampMs("refresh_token_expires_at"),
    linkedAt: timestampMs("linked_at").notNull(),
    lastCheckedAt: timestampMs("last_checked_at"),
    /** Redacted reason the last check did not complete, or null. */
    lastError: text("last_error"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("github_user_links_user_unique").on(t.userId),
    uniqueIndex("github_user_links_github_user_unique").on(t.githubUserId),
    check("github_user_links_status_check", inEnum("status", GITHUB_USER_LINK_STATUSES)),
  ],
);

/**
 * The permission snapshot: one row per (user, office repo) the user can see.
 * No row means `none`; a `none` permission is never stored.
 */
export const githubRepoPermissions = sqliteTable(
  "github_repo_permissions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => operationRepos.id, { onDelete: "cascade" }),
    permission: enumText("permission", GITHUB_REPO_PERMISSIONS).notNull(),
    checkedAt: timestampMs("checked_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("github_repo_permissions_user_repo_unique").on(t.userId, t.repoId),
    index("github_repo_permissions_repo_idx").on(t.repoId),
    check(
      "github_repo_permissions_permission_check",
      inEnum("permission", GITHUB_REPO_PERMISSIONS),
    ),
  ],
);

/** Organisations the linked account is an active member of; `orgLogin` is lower case. */
export const githubOrgMemberships = sqliteTable(
  "github_org_memberships",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgLogin: text("org_login").notNull(),
    orgId: integer("org_id"),
    /** `admin` or `member`, as GitHub reports it. */
    role: text("role").notNull().default("member"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("github_org_memberships_user_org_unique").on(t.userId, t.orgLogin)],
);
