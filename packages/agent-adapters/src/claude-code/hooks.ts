/**
 * Claude Code hook payload (forwarded by hook.sh) → `AgentEvent`s (SPEC §7 status ladder rung
 * "hooks"; mapping from research 04). Payload shapes follow
 * https://code.claude.com/docs/en/hooks#hook-events; unknown events and
 * unexpected shapes map to [] rather than throwing.
 *
 * | Hook event                        | Events                                                 |
 * |-----------------------------------|--------------------------------------------------------|
 * | SessionStart                      | status idle, action none                               |
 * | UserPromptSubmit                  | status working, action thinking                        |
 * | PreToolUse                        | status working, action by tool, tool_call running      |
 * | PreToolUse AskUserQuestion        | status waiting_input, tool_call running                |
 * | PostToolUse                       | tool_call completed                                    |
 * | PostToolUseFailure                | tool_call failed, action failing (not on interrupts)   |
 * | PermissionRequest                 | status waiting_permission, permission_request          |
 * | Notification permission_prompt    | status waiting_permission                              |
 * | Notification idle_prompt, ...     | status waiting_input                                   |
 * | Stop                              | status done, action none (idle if background tasks)    |
 * | StopFailure                       | status error, action failing                           |
 * | SessionEnd                        | idle on clear/resume, offline on logout, else exited   |
 */
import type { AgentEvent, PermissionDecision } from "@regulus/protocol";
import { arr, bool, clip, isObject, type Json, obj, str } from "./payload.ts";
import { classifyTool, summarizeTool, toolLocations } from "./tools.ts";

/** Hook events the generated settings file registers. */
export const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "Stop",
  "StopFailure",
  "SessionEnd",
] as const;
export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

const WAITING_INPUT_NOTIFICATIONS = new Set([
  "idle_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
  "quota_auto_resume_stale",
]);

export interface HookMapOptions {
  now: number;
  /** Id for a new permission request (the hook payload carries none). */
  newRequestId: () => string;
}

/** The documented `hook_event_name`, or undefined for anything else. */
export function hookEventName(payload: unknown): string | undefined {
  return isObject(payload) ? str(payload, "hook_event_name") : undefined;
}

/** `session_id` of a hook or statusline payload. */
export function payloadSessionId(payload: unknown): string | undefined {
  const id = isObject(payload) ? str(payload, "session_id") : undefined;
  return id && id.length <= 128 ? id : undefined;
}

/** The request's `permission_suggestions`, for `allow_always`. */
export function permissionSuggestions(payload: unknown): unknown[] {
  return (isObject(payload) ? arr(payload, "permission_suggestions") : undefined) ?? [];
}

export function mapHookPayload(payload: unknown, opts: HookMapOptions): AgentEvent[] {
  if (!isObject(payload)) return [];
  const ts = opts.now;
  const toolName = clip(str(payload, "tool_name") ?? "", 200);
  const toolInput = obj(payload, "tool_input");

  switch (str(payload, "hook_event_name")) {
    case "SessionStart":
      return [
        { kind: "status", ts, status: "idle", reason: sessionReason(payload) },
        { kind: "action", ts, action: "none" },
      ];
    case "UserPromptSubmit":
      return [
        { kind: "status", ts, status: "working" },
        { kind: "action", ts, action: "thinking" },
      ];
    case "PreToolUse": {
      if (!toolName) return [];
      const cls = classifyTool(toolName, toolInput);
      const call = toolCall(payload, toolName, cls.kind, "running", ts);
      if (toolName === "AskUserQuestion") {
        return [{ kind: "status", ts, status: "waiting_input", reason: "question" }, call];
      }
      const detail = summarizeTool(toolName, toolInput);
      return [
        { kind: "status", ts, status: "working" },
        {
          kind: "action",
          ts,
          action: cls.action,
          ...(detail ? { detail: clip(detail, 200) } : {}),
        },
        call,
      ];
    }
    case "PostToolUse": {
      if (!toolName) return [];
      const cls = classifyTool(toolName, toolInput);
      return [toolCall(payload, toolName, cls.kind, "completed", ts)];
    }
    case "PostToolUseFailure": {
      if (!toolName) return [];
      const cls = classifyTool(toolName, toolInput);
      const call = toolCall(payload, toolName, cls.kind, "failed", ts);
      if (bool(payload, "is_interrupt")) return [call];
      return [call, { kind: "action", ts, action: "failing", detail: firstLine(payload) }];
    }
    case "PermissionRequest": {
      if (!toolName) return [];
      const options: PermissionDecision[] =
        permissionSuggestions(payload).length > 0
          ? ["allow_once", "allow_always", "reject"]
          : ["allow_once", "reject"];
      const summary = summarizeTool(toolName, toolInput);
      return [
        { kind: "status", ts, status: "waiting_permission", reason: toolName },
        {
          kind: "permission_request",
          ts,
          requestId: opts.newRequestId(),
          toolName,
          description: clip(summary ? `${toolName}: ${summary}` : toolName, 2000),
          options,
        },
      ];
    }
    case "Notification": {
      const type = str(payload, "notification_type") ?? "";
      const reason = clip(str(payload, "message") ?? type, 500) || undefined;
      if (type === "permission_prompt") {
        return [{ kind: "status", ts, status: "waiting_permission", reason }];
      }
      if (WAITING_INPUT_NOTIFICATIONS.has(type)) {
        return [{ kind: "status", ts, status: "waiting_input", reason }];
      }
      return [];
    }
    case "Stop": {
      const background = arr(payload, "background_tasks")?.length ?? 0;
      if (background > 0) {
        return [{ kind: "status", ts, status: "idle", reason: "waiting on background tasks" }];
      }
      return [
        { kind: "status", ts, status: "done" },
        { kind: "action", ts, action: "none" },
      ];
    }
    case "StopFailure":
      return [
        { kind: "status", ts, status: "error", reason: clip(str(payload, "error") ?? "", 500) },
        { kind: "action", ts, action: "failing" },
      ];
    case "SessionEnd": {
      const reason = str(payload, "reason") ?? "other";
      if (reason === "clear" || reason === "resume") {
        return [{ kind: "status", ts, status: "idle", reason }];
      }
      if (reason === "logout") {
        return [{ kind: "status", ts, status: "offline", reason: "logged out; run /login" }];
      }
      return [{ kind: "status", ts, status: "exited", reason: clip(reason, 500) }];
    }
    default:
      return [];
  }
}

function sessionReason(payload: Json): string | undefined {
  const source = str(payload, "source");
  return source ? clip(`session ${source}`, 500) : undefined;
}

function toolCall(
  payload: Json,
  name: string,
  toolKind: ReturnType<typeof classifyTool>["kind"],
  status: "running" | "completed" | "failed",
  ts: number,
): AgentEvent {
  const input = obj(payload, "tool_input");
  const summary = summarizeTool(name, input);
  const locations = toolLocations(input);
  return {
    kind: "tool_call",
    ts,
    callId: clip(str(payload, "tool_use_id") ?? `${name}-${ts}`, 128),
    name,
    toolKind,
    status,
    ...(summary ? { summary } : {}),
    ...(locations ? { locations } : {}),
  };
}

/** First line of a PostToolUseFailure `error` (e.g. `Exit code 1`). */
function firstLine(payload: Json): string | undefined {
  const line = (str(payload, "error") ?? "").split("\n", 1)[0] ?? "";
  return line ? clip(line, 200) : undefined;
}
