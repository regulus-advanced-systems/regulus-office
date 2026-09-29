/**
 * Cached GitHub board data per floor repo (SPEC §5 `github_issues`,
 * `github_pulls`; §9.4 boards). Rows are refreshed by the sync job / webhooks;
 * `raw` keeps the full API payload for fields the boards do not model yet.
 *
 * GitHub's own `updated_at` is stored as `ghUpdatedAt` so the row-level
 * `updatedAt` keeps its meaning (SPEC §5 "every table has ... updatedAt").
 */
import { CHECKS_STATES, REVIEW_STATES } from "@regulus/protocol";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, jsonText, timestampMs, timestamps } from "./_columns.ts";
import { floorRepos } from "./floors.ts";

const cardColumns = () => ({
  id: id(),
  repoId: text("repo_id")
    .notNull()
    .references(() => floorRepos.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  /** GitHub state as reported (`open`, `closed`, ...). */
  state: text("state").notNull(),
  labelsJson: jsonText("labels_json").notNull().default("[]"),
  assigneesJson: jsonText("assignees_json").notNull().default("[]"),
  ghUpdatedAt: timestampMs("gh_updated_at").notNull(),
  bodyMd: text("body_md"),
  raw: jsonText("raw").notNull().default("{}"),
  ...timestamps(),
});

export const githubIssues = sqliteTable("github_issues", cardColumns(), (t) => [
  uniqueIndex("github_issues_repo_number_unique").on(t.repoId, t.number),
  index("github_issues_repo_state_idx").on(t.repoId, t.state),
]);

export const githubPulls = sqliteTable(
  "github_pulls",
  {
    ...cardColumns(),
    checksState: enumText("checks_state", CHECKS_STATES).notNull().default("none"),
    reviewState: enumText("review_state", REVIEW_STATES).notNull().default("none"),
    headRef: text("head_ref"),
    baseRef: text("base_ref"),
    isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("github_pulls_repo_number_unique").on(t.repoId, t.number),
    index("github_pulls_repo_state_idx").on(t.repoId, t.state),
    check("github_pulls_checks_state_check", inEnum("checks_state", CHECKS_STATES)),
    check("github_pulls_review_state_check", inEnum("review_state", REVIEW_STATES)),
  ],
);

/**
 * The office's GitHub connection (SPEC §4.2, §8, D14; #141): at most one row,
 * id `office`. Either a GitHub App made with the manifest flow (id, private
 * key, webhook secret) or an org fine-grained PAT. Every secret column is an
 * envelope from apps/server/src/secrets with the AAD bound to the row and the
 * column, and never leaves the server.
 */
export const githubConnection = sqliteTable(
  "github_connection",
  {
    id: text("id").primaryKey(),
    kind: enumText("kind", ["app", "pat"] as const).notNull(),
    appId: integer("app_id"),
    appClientId: text("app_client_id"),
    appSlug: text("app_slug"),
    appName: text("app_name"),
    appHtmlUrl: text("app_html_url"),
    appOwner: text("app_owner"),
    encryptedPrivateKey: text("encrypted_private_key"),
    encryptedWebhookSecret: text("encrypted_webhook_secret"),
    encryptedToken: text("encrypted_token"),
    tokenLogin: text("token_login"),
    ...timestamps(),
  },
  () => [check("github_connection_kind_check", inEnum("kind", ["app", "pat"]))],
);
