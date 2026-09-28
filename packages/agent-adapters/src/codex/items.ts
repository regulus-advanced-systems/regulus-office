/**
 * `ThreadItem` (item/started, item/completed) → desk animation (`AgentAction`)
 * and `tool_call` events.
 *
 * Mapping (issue #28): command execution → `running_tests` when the command
 * looks like a test run, `reading` when Codex parsed it as read/list/search
 * only, otherwise `typing`; file change → `editing`; web search → `browsing`;
 * reasoning → `thinking`; agent message → `typing`.
 */
import type {
  ActionEvent,
  AgentAction,
  ToolCallEvent,
  ToolCallStatus,
  ToolKind,
} from "@regulus/protocol";
import type { CommandAction, ThreadItem } from "./generated/v2/index.ts";

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const TEST_TOOLS =
  /(^|[\s;&|(])(npx\s+|bunx\s+)?(pytest|jest|vitest|mocha|rspec|phpunit|ctest|tox|nox|playwright\s+test)\b/;
const TEST_SUBCOMMANDS =
  /(^|[\s;&|(])(cargo|go|bun|npm|pnpm|yarn|deno|make|mix|dotnet|gradle|\.\/gradlew|mvn|python3?\s+-m)\s+(run\s+)?(test|tests|check|verify|pytest|unittest)\b/;

/** Heuristic: does this shell command run a test suite? */
export function looksLikeTests(command: string): boolean {
  return TEST_TOOLS.test(command) || TEST_SUBCOMMANDS.test(command);
}

const READ_ONLY_ACTIONS = new Set<CommandAction["type"]>(["read", "listFiles", "search"]);

function commandAction(command: string, actions: readonly CommandAction[]): AgentAction {
  if (looksLikeTests(command)) return "running_tests";
  if (actions.length > 0 && actions.every((a) => READ_ONLY_ACTIONS.has(a.type))) return "reading";
  return "typing";
}

/** Desk animation for an item that just started; null when it should not change. */
export function itemAction(item: ThreadItem): { action: AgentAction; detail?: string } | null {
  switch (item.type) {
    case "commandExecution":
      return {
        action: commandAction(item.command, item.commandActions ?? []),
        detail: clip(item.command, 200),
      };
    case "fileChange": {
      const first = item.changes[0]?.path;
      return { action: "editing", ...(first ? { detail: clip(first, 200) } : {}) };
    }
    case "webSearch":
      return { action: "browsing", ...(item.query ? { detail: clip(item.query, 200) } : {}) };
    case "reasoning":
      return { action: "thinking" };
    case "agentMessage":
      return { action: "typing" };
    case "imageView":
      return { action: "reading" };
    case "mcpToolCall":
    case "dynamicToolCall":
      return { action: "typing", detail: clip(item.tool, 200) };
    default:
      return null;
  }
}

export function actionEvent(item: ThreadItem, ts: number): ActionEvent | null {
  const mapped = itemAction(item);
  return mapped ? { kind: "action", ts, ...mapped } : null;
}

function toolStatus(status: string | undefined, completed: boolean): ToolCallStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
    case "declined":
      return "failed";
    case "inProgress":
      return completed ? "completed" : "running";
    default:
      return completed ? "completed" : "running";
  }
}

function commandToolKind(actions: readonly CommandAction[]): ToolKind {
  if (actions.length > 0 && actions.every((a) => a.type === "read")) return "read";
  if (actions.length > 0 && actions.every((a) => READ_ONLY_ACTIONS.has(a.type))) return "search";
  return "execute";
}

interface ToolShape {
  name: string;
  toolKind: ToolKind;
  status?: string;
  summary?: string;
  locations?: string[];
}

function toolShape(item: ThreadItem): ToolShape | null {
  switch (item.type) {
    case "commandExecution":
      return {
        name: "shell",
        toolKind: commandToolKind(item.commandActions ?? []),
        status: item.status,
        summary: item.command,
      };
    case "fileChange": {
      const paths = item.changes.map((c) => c.path);
      return {
        name: "apply_patch",
        toolKind: item.changes.some((c) => c.kind.type === "delete") ? "delete" : "edit",
        status: item.status,
        summary: paths.join(", "),
        locations: paths,
      };
    }
    case "webSearch":
      return { name: "web_search", toolKind: "fetch", summary: item.query };
    case "mcpToolCall":
      return {
        name: `${item.server}.${item.tool}`,
        toolKind: "other",
        status: item.status,
      };
    case "dynamicToolCall":
      return { name: item.tool, toolKind: "other", status: item.status };
    case "imageView":
      return { name: "view_image", toolKind: "read", summary: item.path, locations: [item.path] };
    default:
      return null;
  }
}

/** `tool_call` event for tool-like items; null for messages, reasoning, etc. */
export function toolCallEvent(
  item: ThreadItem,
  phase: "started" | "completed",
  ts: number,
): ToolCallEvent | null {
  const shape = toolShape(item);
  if (!shape) return null;
  const event: ToolCallEvent = {
    kind: "tool_call",
    ts,
    callId: clip(item.id, 128),
    name: clip(shape.name, 200),
    toolKind: shape.toolKind,
    status: toolStatus(shape.status, phase === "completed"),
  };
  if (shape.summary) event.summary = clip(shape.summary, 500);
  if (shape.locations?.length) event.locations = shape.locations.map((l) => clip(l, 1024));
  return event;
}
