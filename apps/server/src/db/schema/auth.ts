/**
 * Better Auth's remaining core tables (sessions, accounts, verifications).
 * `users` lives in ./users.ts next to `user_profiles`. Column keys follow
 * Better Auth's field names exactly; the Drizzle adapter (apps/server/src/auth)
 * maps by key, so the SQL names can stay snake_case like the rest of SPEC §5.
 */
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, timestampMs, timestamps } from "./_columns.ts";
import { users } from "./users.ts";

/** One row per signed-in browser; the `token` is what the session cookie carries. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("sessions_token_unique").on(t.token),
    index("sessions_user_id_idx").on(t.userId),
  ],
);

/**
 * How a user can sign in: `providerId` is `credential` (password hash in
 * `password`) or a social provider such as `github` (OAuth tokens for the
 * *human's* GitHub identity; never agent provider credentials, SPEC §8).
 */
export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestampMs("access_token_expires_at"),
    refreshTokenExpiresAt: timestampMs("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    ...timestamps(),
  },
  (t) => [
    index("accounts_user_id_idx").on(t.userId),
    uniqueIndex("accounts_provider_account_unique").on(t.providerId, t.accountId),
  ],
);

/** Short-lived verification values (email verification, password reset, OAuth state). */
export const verifications = sqliteTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    ...timestamps(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);
