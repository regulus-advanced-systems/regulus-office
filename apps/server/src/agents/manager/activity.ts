/**
 * The words in the bubble over a henchman (SPEC §9.3, D29; #256), from the
 * adapter events the office already receives (Claude Code hooks, Codex items).
 *
 * What may appear, and nothing else (SPEC §8):
 * - fixed phrases chosen by tool kind, status and action;
 * - a file's base name (never its directory), when it looks like a file name;
 * - a program's name (the first word of a command, never its arguments);
 * - an issue or PR number.
 * Command lines, prompts, messages, terminal output, file contents and
 * permission details never reach the text. The result still goes through
 * {@link safeReason} (secrets/redact.ts), so a file or program that happens to
 * be named like a token is replaced too.
 */
import { CLAUDE_SIGN_IN_REASON, CLAUDE_TRUST_REASON } from "@regulus/agent-adapters";
import {
  AGENT_BUBBLE_MAX_TEXT,
  type AgentBubble,
  type AgentEvent,
  type AgentStatus,
  NO_AGENT_BUBBLE,
} from "@regulus/protocol";
import { safeReason } from "./failure.ts";

type ToolCall = Extract<AgentEvent, { kind: "tool_call" }>;

const TEST_COMMAND =
  /\b(test|tests|jest|vitest|pytest|rspec|mocha|playwright|cargo test|go test|bun test)\b/i;
const FILE_NAME = /^(?!\.{1,2}$)[\w.@+-]{1,40}$/;
const PROGRAM_NAME = /^[a-z][a-z0-9._-]{0,19}$/i;
/** Shell words that are not the program being run. */
const NOT_A_PROGRAM = new Set(["cd", "sudo", "env", "exec", "time", "then", "do", "if", "for"]);

const clipText = (text: string) => safeReason(text, AGENT_BUBBLE_MAX_TEXT);

/** The base name of the first file a tool call touches, when it reads as a file name. */
export function fileOf(event: ToolCall): string | undefined {
  const path = event.locations?.[0];
  if (!path) return undefined;
  const base =
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "";
  return FILE_NAME.test(base) ? base : undefined;
}

/** The program a command line runs: its first word that is a program, never an argument. */
export function programOf(command: string | undefined): string | undefined {
  if (!command) return undefined;
  for (const word of command.trim().split(/\s+/).slice(0, 6)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    const name = word.split("/").pop() ?? "";
    if (NOT_A_PROGRAM.has(name)) {
      // `cd somewhere && …`: what follows is not worth guessing at.
      if (name === "cd") return undefined;
      continue;
    }
    return PROGRAM_NAME.test(name) ? name : undefined;
  }
  return undefined;
}

function withFile(verb: string, event: ToolCall, fallback: string): string {
  const file = fileOf(event);
  return file ? `${verb} ${file}` : fallback;
}

function toolActivity(event: ToolCall): string {
  switch (event.toolKind) {
    case "read":
      return withFile("reading", event, "reading files");
    case "search":
      return "searching the code";
    case "edit":
      return withFile("editing", event, "editing files");
    case "delete":
      return withFile("deleting", event, "deleting files");
    case "move":
      return withFile("moving", event, "moving files");
    case "execute": {
      if (TEST_COMMAND.test(`${event.name} ${event.summary ?? ""}`)) return "running tests";
      const program = programOf(event.summary);
      return program ? `running ${program}` : "running a command";
    }
    case "think":
      return "planning";
    case "fetch":
      return "browsing the web";
    default:
      return "using a tool";
  }
}

/**
 * What the event says the henchman is doing now, or undefined when it says
 * nothing new (a finished tool call, usage, a status the bubble words itself).
 */
export function activityOf(event: AgentEvent): string | undefined {
  switch (event.kind) {
    case "tool_call":
      if (event.status === "failed") return "hit a snag";
      if (event.status === "pending" || event.status === "running") {
        return clipText(toolActivity(event));
      }
      return undefined;
    case "message":
      if (event.role === "assistant") return "writing a reply";
      if (event.role === "thought") return "thinking";
      return undefined;
    case "action":
      // Tool calls word the other actions with more detail.
      if (event.action === "thinking") return "thinking";
      if (event.action === "failing") return "hit a snag";
      return undefined;
    default:
      return undefined;
  }
}

/** What a permission request asks its human for, by the tool's name only. */
export function askOf(toolName: string): string {
  if (/bash|shell|powershell|exec|command/i.test(toolName)) return "approve a command";
  if (/edit|write|patch/i.test(toolName)) return "approve an edit";
  if (/network|fetch|web/i.test(toolName)) return "approve network access";
  return "approve a tool";
}

export interface BubbleInput {
  agentId: string;
  status: AgentStatus;
  /** Latest {@link activityOf}; "" when unknown (e.g. after a restart). */
  activity: string;
  /** Latest {@link askOf} while waiting for a permission; "" when unknown. */
  ask: string;
  /** Something that happened and is worth saying once at rest ("opened PR #12"); "" otherwise. */
  announce: string;
  /** The fixed "waiting for you" reason of an adapter, if any (henchman.ts statusReasonFor). */
  statusReason: string;
}

function waitingFor(reason: string): string {
  if (reason === CLAUDE_SIGN_IN_REASON) return "waiting for you: finish signing in";
  if (reason === CLAUDE_TRUST_REASON) return "waiting for you: trust this folder";
  return "waiting for you: answer a question";
}

/** The bubble a henchman shows for its status and latest activity. */
export function bubbleFor(input: BubbleInput): AgentBubble {
  const terminal = { targetKind: "terminal", targetId: input.agentId } as const;
  const doing = (text: string): AgentBubble => ({
    kind: "doing",
    text: clipText(text),
    targetKind: "none",
    targetId: "",
  });
  switch (input.status) {
    case "starting":
      return doing("starting up");
    case "working":
      return doing(input.activity || "working");
    case "waiting_permission":
      return {
        kind: "needs_you",
        text: clipText(`waiting for you: ${input.ask || "approve a tool"}`),
        targetKind: "permission",
        targetId: input.agentId,
      };
    case "waiting_input":
      return { kind: "needs_you", text: waitingFor(input.statusReason), ...terminal };
    case "done":
      return {
        kind: "answer_ready",
        text: clipText(input.announce || "finished: take a look"),
        ...terminal,
      };
    case "idle":
      return input.announce
        ? { kind: "answer_ready", text: clipText(input.announce), ...terminal }
        : NO_AGENT_BUBBLE;
    case "error":
      return { kind: "needs_you", text: "hit an error: take a look", ...terminal };
    default:
      return NO_AGENT_BUBBLE;
  }
}
