/**
 * Claude Code tool names → desk animation (`AgentAction`) and ACP-style tool
 * kind. Tool names and `tool_input` fields are the ones documented for
 * PreToolUse at https://code.claude.com/docs/en/hooks#pretooluse-input.
 */
import type { AgentAction, ToolKind } from "@regulus/protocol";
import { clip, type Json, str } from "./payload.ts";

export interface ToolClass {
  action: AgentAction;
  kind: ToolKind;
}

const READ_TOOLS = new Set(["Read", "NotebookRead", "LS"]);
const SEARCH_TOOLS = new Set(["Glob", "Grep", "ToolSearch"]);
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell", "BashOutput", "Monitor"]);
const THINK_TOOLS = new Set(["Agent", "Task", "TodoWrite", "ExitPlanMode", "EnterPlanMode"]);

/**
 * Commands that look like a test run. Deliberately loose: a false positive
 * only changes which animation plays.
 */
const TEST_COMMAND =
  /(^|[\s;&|(])(bun test|(npm|pnpm|yarn|bun)( run)? test\b|npx (jest|vitest|playwright)|jest|vitest|pytest|go test|cargo (test|nextest)|mvn test|gradle test|rspec|phpunit|mocha|ctest|tox|playwright test|make (test|check))/;

export function classifyTool(name: string, input: Json | undefined): ToolClass {
  if (READ_TOOLS.has(name)) return { action: "reading", kind: "read" };
  if (SEARCH_TOOLS.has(name)) return { action: "reading", kind: "search" };
  if (EDIT_TOOLS.has(name)) return { action: "editing", kind: "edit" };
  if (name === "WebFetch") return { action: "browsing", kind: "fetch" };
  if (name === "WebSearch") return { action: "browsing", kind: "search" };
  if (SHELL_TOOLS.has(name)) {
    const command = str(input, "command") ?? "";
    return { action: TEST_COMMAND.test(command) ? "running_tests" : "typing", kind: "execute" };
  }
  if (THINK_TOOLS.has(name)) return { action: "thinking", kind: "think" };
  if (name.startsWith("mcp__")) return { action: "typing", kind: "other" };
  return { action: "typing", kind: "other" };
}

/** One-line human summary of a tool call (file path, command, URL, query). */
export function summarizeTool(name: string, input: Json | undefined): string | undefined {
  const text =
    str(input, "command") ??
    str(input, "file_path") ??
    str(input, "notebook_path") ??
    str(input, "url") ??
    str(input, "query") ??
    str(input, "pattern") ??
    str(input, "description") ??
    str(input, "path");
  if (text === undefined) return undefined;
  return clip(text, 500) || name;
}

/** Files a tool call touches, when the input names them. */
export function toolLocations(input: Json | undefined): string[] | undefined {
  const path = str(input, "file_path") ?? str(input, "notebook_path");
  return path ? [path.slice(0, 1024)] : undefined;
}
