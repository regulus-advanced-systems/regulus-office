/**
 * GitHub workflows (#155): per-floor workflow definitions, their runs (the
 * run history and the queue), and a short window of recent GitHub events for
 * dry runs. Nothing here holds a token, key or the rendered prompt.
 */
import { WORKFLOW_PROVIDERS, WORKFLOW_RUN_STATUSES } from "@regulus/protocol";
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
import { floors } from "./floors.ts";
import { users } from "./users.ts";

export const workflows = sqliteTable(
  "workflows",
  {
    id: id(),
    floorId: text("floor_id")
      .notNull()
      .references(() => floors.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    /** trigger, filters, robot, actions, limits (protocol `WorkflowInput`), validated on read. */
    specJson: jsonText("spec_json").notNull(),
    /** Last cron slot a schedule trigger fired for (ms), so a restart does not refire it. */
    lastScheduledAt: timestampMs("last_scheduled_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("workflows_floor_idx").on(t.floorId)],
);

export const workflowRuns = sqliteTable(
  "workflow_runs",
  {
    id: id(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    floorId: text("floor_id")
      .notNull()
      .references(() => floors.id, { onDelete: "cascade" }),
    /** GitHub delivery id (or `schedule:<slot>`); one run per workflow and delivery. */
    deliveryId: text("delivery_id").notNull(),
    trigger: text("trigger").notNull(),
    /** `owner/name#12` or `owner/name@sha`: the per-target cooldown key. */
    targetKey: text("target_key"),
    targetJson: jsonText("target_json"),
    /** The trimmed trigger context the run executes with (survives restarts while queued). */
    contextJson: jsonText("context_json").notNull(),
    status: enumText("status", WORKFLOW_RUN_STATUSES).notNull(),
    reason: text("reason"),
    provider: enumText("provider", WORKFLOW_PROVIDERS).notNull(),
    model: text("model"),
    /** UTC day `YYYY-MM-DD` the run was queued on (daily budget). */
    day: text("day").notNull(),
    queuedAt: timestampMs("queued_at").notNull(),
    startedAt: timestampMs("started_at"),
    finishedAt: timestampMs("finished_at"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    linksJson: jsonText("links_json").notNull().default("[]"),
    logJson: jsonText("log_json").notNull().default("[]"),
    summary: text("summary"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("workflow_runs_delivery_unique").on(t.workflowId, t.deliveryId),
    index("workflow_runs_floor_queued_idx").on(t.floorId, t.queuedAt),
    index("workflow_runs_workflow_day_idx").on(t.workflowId, t.day),
    index("workflow_runs_status_idx").on(t.status),
    index("workflow_runs_target_idx").on(t.workflowId, t.targetKey),
    check("workflow_runs_status_check", inEnum("status", WORKFLOW_RUN_STATUSES)),
    check("workflow_runs_provider_check", inEnum("provider", WORKFLOW_PROVIDERS)),
  ],
);

/** Recent verified GitHub events of followed repos, for dry runs (pruned by count and age). */
export const workflowEvents = sqliteTable(
  "workflow_events",
  {
    id: id(),
    deliveryId: text("delivery_id").notNull(),
    name: text("name").notNull(),
    action: text("action"),
    repo: text("repo"),
    floorIdsJson: jsonText("floor_ids_json").notNull().default("[]"),
    summary: text("summary").notNull(),
    sender: text("sender"),
    /** The event as the engine saw it, with large text fields capped. */
    eventJson: jsonText("event_json").notNull(),
    receivedAt: timestampMs("received_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("workflow_events_delivery_unique").on(t.deliveryId),
    index("workflow_events_received_idx").on(t.receivedAt),
  ],
);
