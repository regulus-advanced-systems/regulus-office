/**
 * Notifications (SPEC §10 Ops, D15; #42): team webhook channels (Slack,
 * Discord, Telegram) with their URL or bot token envelope-encrypted by the
 * secrets module, per-user notification preferences, and marks that make
 * one-time events (a PR merged) fire once across restarts.
 */
import { WEBHOOK_KINDS } from "@regulus/protocol";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, jsonText, timestampMs, timestamps } from "./_columns.ts";
import { users } from "./users.ts";

export const notificationChannels = sqliteTable(
  "notification_channels",
  {
    id: id(),
    kind: enumText("kind", WEBHOOK_KINDS).notNull(),
    label: text("label").notNull(),
    /** Envelope (AAD `notification_channel:<id>|webhook_secret`): the webhook URL or bot token. */
    encryptedSecret: text("encrypted_secret").notNull(),
    /** Telegram chat id; not a secret. */
    chatId: text("chat_id"),
    /** JSON array of operation ids, or null for every operation. */
    operationIdsJson: jsonText("operation_ids_json"),
    eventsJson: jsonText("events_json").notNull().default("[]"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastDeliveryAt: timestampMs("last_delivery_at"),
    lastDeliveryOk: integer("last_delivery_ok", { mode: "boolean" }),
    /** `sent` or a short error code; never provider response text. */
    lastDeliveryCode: text("last_delivery_code"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  () => [check("notification_channels_kind_check", inEnum("kind", WEBHOOK_KINDS))],
);

export const notificationPrefs = sqliteTable("notification_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  prefsJson: jsonText("prefs_json").notNull(),
  ...timestamps(),
});

/** A one-time notification already sent, e.g. `pr_merged:<repoId>#<n>`. */
export const notificationMarks = sqliteTable("notification_marks", {
  key: text("key").primaryKey(),
  ...timestamps(),
});
