/**
 * Board helpers (SPEC §10 M5, D10; #56): where each kiosk agent stands, and
 * the tasks helpers proposed to people. The agent itself is an
 * `office_agents` row with the `kiosk` job; a placement row binds it to one
 * board of one project room. Shapes are in `@regulus/protocol`
 * office-agent-kiosk.ts.
 */
import { KIOSK_BOARDS, TASK_PROPOSAL_STATUSES } from "@regulus/protocol";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, jsonText, timestampMs, timestamps } from "./_columns.ts";
import { officeAgents } from "./office-agents.ts";
import { operations } from "./operations.ts";
import { users } from "./users.ts";

export const officeAgentKiosks = sqliteTable(
  "office_agent_kiosks",
  {
    agentId: text("agent_id")
      .primaryKey()
      .references(() => officeAgents.id, { onDelete: "cascade" }),
    /** Its room. A helper is removed with its room (pm/kiosk/rooms.ts). */
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    board: enumText("board", KIOSK_BOARDS).notNull(),
    /** Run on the office PM's key and model while the office has a PM that runs as a session. */
    viaPm: integer("via_pm", { mode: "boolean" }).notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    // One helper per board.
    uniqueIndex("office_agent_kiosks_operation_board_unique").on(t.operationId, t.board),
    check("office_agent_kiosks_board_check", inEnum("board", KIOSK_BOARDS)),
  ],
);

/**
 * A task a board helper wants to queue for one person (#56). The agent queues
 * nothing: the person is shown exactly what is in `inputJson` and queues it
 * themselves, from their own browser. A proposal not confirmed in time is dead.
 */
export const officeAgentTaskProposals = sqliteTable(
  "office_agent_task_proposals",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => officeAgents.id, { onDelete: "cascade" }),
    forUserId: text("for_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    /** The task as it would be queued (protocol `TaskProposalTask`). */
    inputJson: jsonText("input_json").notNull(),
    status: enumText("status", TASK_PROPOSAL_STATUSES).notNull().default("pending"),
    /** The queued task, once confirmed. */
    taskId: text("task_id"),
    expiresAt: timestampMs("expires_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("office_agent_task_proposals_agent_user_idx").on(t.agentId, t.forUserId, t.status),
    check("office_agent_task_proposals_status_check", inEnum("status", TASK_PROPOSAL_STATUSES)),
  ],
);
