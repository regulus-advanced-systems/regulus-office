/**
 * Events emitted by agent adapters (SPEC §7 `AgentControl.events`) and the
 * usage / limit samples returned by `readUsage`. The server tags each event
 * with the agent id before persisting it to `agent_events` (SPEC §5).
 *
 * Events never carry credentials: adapters must strip env and tokens before
 * emitting (SPEC §8 rule 2).
 */
import { z } from "zod";
import { Count, TimestampMs } from "./common.ts";
import {
  AGENT_ACTIONS,
  AGENT_STATUSES,
  LIMIT_WINDOW_KINDS,
  PERMISSION_DECISIONS,
  USAGE_SOURCES,
} from "./enums.ts";

export const AGENT_EVENT_KINDS = [
  "status",
  "action",
  "message",
  "tool_call",
  "permission_request",
  "usage",
  "limit",
  "exit",
] as const;
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

export const MESSAGE_ROLES = ["assistant", "user", "system", "thought"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** Tool categories (ACP `tool_call.kind` plus `other`), used for desk animations. */
export const TOOL_KINDS = [
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "other",
] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const TOOL_CALL_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

/** Token usage observed for one agent turn or transcript chunk. */
export const UsageSample = z.object({
  ts: TimestampMs,
  inputTokens: Count,
  outputTokens: Count,
  cacheReadTokens: Count,
  cacheWriteTokens: Count,
  costUsdEstimate: z.number().nonnegative().optional(),
  source: z.enum(USAGE_SOURCES),
  /** Provider model id when known (transcripts), for price estimates. */
  model: z.string().max(128).optional(),
  /** Provider session the usage belongs to (Claude session id), to find the robot. */
  sessionId: z.string().max(128).optional(),
  /**
   * Stable id of the model request within its source (Claude message + request
   * id, Codex thread total), so re-reading the same data never counts twice.
   */
  dedupeKey: z.string().max(256).optional(),
});
export type UsageSample = z.infer<typeof UsageSample>;

/** Plan-limit reading (e.g. Claude statusline `rate_limits`, Codex `account/rateLimits`). */
export const LimitSample = z.object({
  windowKind: z.enum(LIMIT_WINDOW_KINDS),
  usedPct: z.number().min(0).max(100),
  resetsAt: TimestampMs.optional(),
  observedAt: TimestampMs,
  source: z.enum(USAGE_SOURCES),
});
export type LimitSample = z.infer<typeof LimitSample>;

const base = { ts: TimestampMs };

export const StatusEvent = z.object({
  ...base,
  kind: z.literal("status"),
  status: z.enum(AGENT_STATUSES),
  reason: z.string().max(500).optional(),
});

export const ActionEvent = z.object({
  ...base,
  kind: z.literal("action"),
  action: z.enum(AGENT_ACTIONS),
  detail: z.string().max(200).optional(),
});

/** A chunk of conversation text; `partial` is true for streaming deltas. */
export const MessageEvent = z.object({
  ...base,
  kind: z.literal("message"),
  role: z.enum(MESSAGE_ROLES),
  messageId: z.string().max(128).optional(),
  text: z.string(),
  partial: z.boolean(),
});

export const ToolCallEvent = z.object({
  ...base,
  kind: z.literal("tool_call"),
  callId: z.string().max(128),
  name: z.string().max(200),
  toolKind: z.enum(TOOL_KINDS),
  status: z.enum(TOOL_CALL_STATUSES),
  /** Short human-readable summary such as the file path or command line. */
  summary: z.string().max(500).optional(),
  /** Files touched, when known. */
  locations: z.array(z.string().max(1024)).optional(),
});

export const PermissionRequestEvent = z.object({
  ...base,
  kind: z.literal("permission_request"),
  requestId: z.string().max(128),
  toolName: z.string().max(200),
  description: z.string().max(2000),
  options: z.array(z.enum(PERMISSION_DECISIONS)).min(1),
});

export const UsageEvent = UsageSample.extend({ kind: z.literal("usage") });
export const LimitEvent = LimitSample.extend({ ...base, kind: z.literal("limit") });

export const ExitEvent = z.object({
  ...base,
  kind: z.literal("exit"),
  /** Process exit code; absent when killed by a signal. */
  code: z.number().int().optional(),
  signal: z.string().max(16).optional(),
  reason: z.string().max(500).optional(),
});

export const AgentEvent = z.discriminatedUnion("kind", [
  StatusEvent,
  ActionEvent,
  MessageEvent,
  ToolCallEvent,
  PermissionRequestEvent,
  UsageEvent,
  LimitEvent,
  ExitEvent,
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
export type StatusEvent = z.infer<typeof StatusEvent>;
export type ActionEvent = z.infer<typeof ActionEvent>;
export type MessageEvent = z.infer<typeof MessageEvent>;
export type ToolCallEvent = z.infer<typeof ToolCallEvent>;
export type PermissionRequestEvent = z.infer<typeof PermissionRequestEvent>;
export type UsageEvent = z.infer<typeof UsageEvent>;
export type LimitEvent = z.infer<typeof LimitEvent>;
export type ExitEvent = z.infer<typeof ExitEvent>;

export function parseAgentEvent(input: unknown) {
  return AgentEvent.safeParse(input);
}
