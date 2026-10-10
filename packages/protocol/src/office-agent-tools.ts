/**
 * The office tools an office agent acts through (SPEC §10 M5, D3; #135, #271),
 * the single list behind both transports:
 *
 * - MCP, streamable HTTP at `/mcp` (`tools/list`, `tools/call`);
 * - REST: `GET /api/agent-tools` and `POST /api/agent-tools/<name>` with the
 *   tool's input as the JSON body, for engines without MCP.
 *
 * Both take the agent's token as `Authorization: Bearer <token>`.
 *
 * Every call is authorised by the server and audited:
 * 1. the preset must include the tool (`presetAllows`);
 * 2. the operation it names must be open to the agent: for a personal agent,
 *    to its owner at that moment (the office's operation access gate); for a
 *    shared agent, by the grants its admins gave it;
 * 3. a shared agent that queues a task or spawns or stops a henchman does it
 *    for a person (`onBehalfOf`) who is waiting for its answer, within that
 *    person's own rights, and on an office key.
 */
import { z } from "zod";
import { ChatText, Effort, GhNumber, Id, ModelName, PROMPT_MAX, ShortText } from "./common.ts";
import { CARD_KINDS, PROVIDER_IDS, TASK_KINDS } from "./enums.ts";
import {
  MemoryText,
  MindQuery,
  MindSource,
  NoteText,
  NoteTitle,
  OFFICE_AGENT_MIND_LIMITS,
} from "./office-agent-mind.ts";
import {
  OFFICE_AGENT_LIMITS,
  type OfficeAgentPreset,
  type OfficeAgentRole,
} from "./office-agents.ts";

export const OFFICE_MCP_PATH = "/mcp";
export const OFFICE_AGENT_TOOLS_API_PATH = "/api/agent-tools";
/** Name the office MCP server announces and CLI engines register it under. */
export const OFFICE_MCP_SERVER_NAME = "office";
/** Prefix of every office agent token, so leaked ones are recognisable (and redactable). */
export const OFFICE_AGENT_TOKEN_PREFIX = "roa_";

const OnBehalfOf = Id.optional().describe(
  "Shared agents only: the id of the person who asked for this and is waiting for your answer. The action runs with that person's rights.",
);
const OperationId = Id.describe("Operation (room) id, from list_operations.");
const RepoId = Id.describe("Repo id on that operation, from list_operations.");

const TaskFields = {
  operationId: OperationId,
  repoId: RepoId,
  provider: z.enum(PROVIDER_IDS).describe("Coding CLI the henchman runs."),
  model: ModelName,
  effort: Effort.optional(),
  profileId: Id.optional().describe(
    "Credential profile for the henchman. Personal agents: one of the owner's profiles, or omit for their CLI login. Shared agents always use the office key.",
  ),
  onBehalfOf: OnBehalfOf,
};

const PageLimit = z
  .number()
  .int()
  .min(1)
  .max(OFFICE_AGENT_MIND_LIMITS.pageMax)
  .optional()
  .describe("How many to return at most (default 20).");

/** Input schemas by tool name. Plain objects, so they publish as JSON Schema. */
export const OFFICE_TOOL_INPUTS = {
  list_operations: z.object({}),
  list_henchmen: z.object({ operationId: OperationId }),
  read_board: z.object({ operationId: OperationId }),
  read_queue: z.object({ operationId: OperationId }),
  read_usage: z.object({}),
  enqueue_task: z.object({
    ...TaskFields,
    kind: z.enum(TASK_KINDS),
    refNumber: GhNumber.optional().describe("Issue or PR number; required unless freeform."),
    title: ShortText.optional(),
    prompt: z.string().trim().max(PROMPT_MAX).optional().describe("Required for freeform tasks."),
  }),
  comment_on_card: z.object({
    operationId: OperationId,
    repoId: RepoId,
    kind: z.enum(CARD_KINDS),
    number: GhNumber,
    body: z.string().trim().min(1).max(8000),
  }),
  post_chat: z.object({
    text: ChatText,
    operationId: Id.optional().describe("Post as being in this operation; omit for the lobby."),
  }),
  ask_human: z.object({
    question: z.string().trim().min(1).max(OFFICE_AGENT_LIMITS.questionMax),
    options: z
      .array(z.string().trim().min(1).max(OFFICE_AGENT_LIMITS.optionMax))
      .max(OFFICE_AGENT_LIMITS.optionsMax)
      .optional(),
    userId: Id.optional().describe(
      "Who to ask. A personal agent can only ask its owner (the default); a shared agent must name someone.",
    ),
    operationId: Id.optional().describe("The operation the question is about, if any."),
  }),
  read_human_request: z.object({ requestId: Id }),
  spawn_henchman: z.object({
    ...TaskFields,
    prompt: z.string().trim().max(PROMPT_MAX).default(""),
    taskTitle: ShortText.optional(),
    issueNumber: GhNumber.optional(),
    prNumber: GhNumber.optional(),
  }),
  stop_henchman: z.object({
    henchmanId: Id.describe("Henchman id, from list_henchmen."),
    onBehalfOf: OnBehalfOf,
  }),
  soul_read: z.object({}),
  memory_save: z.object({
    text: MemoryText.describe("One fact, preference or decision, in a sentence or two."),
    source: MindSource.optional().describe('Where it comes from, e.g. "Ante, in chat".'),
  }),
  memory_search: z.object({
    query: MindQuery.describe("Words to look for; every word must appear."),
    limit: PageLimit,
  }),
  memory_list: z.object({ limit: PageLimit }),
  memory_forget: z.object({ id: Id.describe("Memory id, from memory_list or memory_search.") }),
  note_write: z.object({
    title: NoteTitle.describe("The note's name; writing to an existing title replaces that note."),
    text: NoteText,
    append: z
      .boolean()
      .optional()
      .describe("Add the text to the end of the existing note instead of replacing it."),
  }),
  note_read: z.object({ title: NoteTitle }),
  note_list: z.object({}),
  note_delete: z.object({ title: NoteTitle }),
} as const;

export type OfficeToolName = keyof typeof OFFICE_TOOL_INPUTS;
export type OfficeToolInput<N extends OfficeToolName> = z.output<(typeof OFFICE_TOOL_INPUTS)[N]>;

export interface OfficeToolSpec {
  name: OfficeToolName;
  title: string;
  description: string;
  /** The lowest preset that includes the tool. */
  preset: OfficeAgentPreset;
  /** Reads change nothing in the office. */
  readOnly: boolean;
}

export const OFFICE_TOOLS: readonly OfficeToolSpec[] = [
  {
    name: "list_operations",
    title: "List operations",
    description: "The operations (project rooms) open to you, with their repos and your access.",
    preset: "observer",
    readOnly: true,
  },
  {
    name: "list_henchmen",
    title: "List henchmen",
    description:
      "The coding henchmen on an operation: status, task, provider, issue or PR, and owner.",
    preset: "observer",
    readOnly: true,
  },
  {
    name: "read_board",
    title: "Read the boards",
    description: "The operation's issue and pull request boards (open and recently closed cards).",
    preset: "observer",
    readOnly: true,
  },
  {
    name: "read_queue",
    title: "Read the task queue",
    description: "The operation's task queue and its concurrency settings.",
    preset: "observer",
    readOnly: true,
  },
  {
    name: "read_usage",
    title: "Read usage",
    description:
      "Token usage and estimated spend: your owner's own for a personal agent, the office totals for a shared one.",
    preset: "observer",
    readOnly: true,
  },
  {
    name: "ask_human",
    title: "Ask a human",
    description:
      "Put a question to a person. It shows in the office until they answer; read the answer with read_human_request, and it also arrives as their next message.",
    preset: "observer",
    readOnly: false,
  },
  {
    name: "read_human_request",
    title: "Read a question's answer",
    description: "The state and answer of a question you asked with ask_human.",
    preset: "observer",
    readOnly: true,
  },
  // What the agent is and knows (#136). Its own only; kept by the office across conversations.
  {
    name: "soul_read",
    title: "Read who you are",
    description:
      "Your own standing document: who you are and how you work, as your person wrote it.",
    preset: "observer",
    readOnly: true,
  },
  {
    name: "memory_save",
    title: "Remember something",
    description:
      "Save one thing to remember across conversations. Never a password, key or token: those are refused.",
    preset: "observer",
    readOnly: false,
  },
  {
    name: "memory_search",
    title: "Search what you remember",
    description: "Find memories and notes that contain the words you give.",
    preset: "observer",
    readOnly: true,
  },
  {
    name: "memory_list",
    title: "List what you remember",
    description: "Your memories, newest first.",
    preset: "observer",
    readOnly: true,
  },
  {
    name: "memory_forget",
    title: "Forget a memory",
    description: "Delete one memory for good.",
    preset: "observer",
    readOnly: false,
  },
  {
    name: "note_write",
    title: "Write a note",
    description:
      "Create, replace or add to a titled note (a journal day, a draft, a decision log). Never a password, key or token.",
    preset: "observer",
    readOnly: false,
  },
  {
    name: "note_read",
    title: "Read a note",
    description: "One of your notes, by title.",
    preset: "observer",
    readOnly: true,
  },
  {
    name: "note_list",
    title: "List your notes",
    description: "The titles of your notes, most recently changed first.",
    preset: "observer",
    readOnly: true,
  },
  {
    name: "note_delete",
    title: "Delete a note",
    description: "Delete one note for good, by title.",
    preset: "observer",
    readOnly: false,
  },
  {
    name: "enqueue_task",
    title: "Queue a task",
    description:
      "Put an issue, PR or freeform task on an operation's queue. A henchman picks it up when a desk is free.",
    preset: "coordinator",
    readOnly: false,
  },
  {
    name: "comment_on_card",
    title: "Comment on an issue or PR",
    description: "Post a comment on an issue or pull request of an operation repo, as the office.",
    preset: "coordinator",
    readOnly: false,
  },
  {
    name: "post_chat",
    title: "Post in the office chat",
    description: "Say something in the office chat under your name.",
    preset: "coordinator",
    readOnly: false,
  },
  {
    name: "spawn_henchman",
    title: "Spawn a henchman",
    description: "Start a coding henchman at a free desk now, within the daily cap.",
    preset: "manager",
    readOnly: false,
  },
  {
    name: "stop_henchman",
    title: "Stop a henchman",
    description: "Stop a henchman of the person you act for. Its branch is kept.",
    preset: "manager",
    readOnly: false,
  },
];

const RANK: Readonly<Record<OfficeAgentPreset, number>> = {
  observer: 0,
  coordinator: 1,
  manager: 2,
};

export function officeToolSpec(name: string): OfficeToolSpec | undefined {
  return OFFICE_TOOLS.find((t) => t.name === name);
}

/** Does the preset include the tool? */
export function presetAllows(preset: OfficeAgentPreset, tool: OfficeToolName): boolean {
  const spec = officeToolSpec(tool);
  return spec !== undefined && RANK[preset] >= RANK[spec.preset];
}

/** The tools a preset includes, in list order. */
export function toolsForPreset(preset: OfficeAgentPreset): OfficeToolSpec[] {
  return OFFICE_TOOLS.filter((t) => RANK[preset] >= RANK[t.preset]);
}

/**
 * The only tools a board helper has (#56), whatever its preset: it reads its
 * room and queues tasks. No comments, no chat, no henchmen, no questions to
 * people, no memories or notes (a helper at a board keeps nothing about the
 * people who walk up to it).
 */
export const KIOSK_TOOLS: readonly OfficeToolName[] = [
  "list_operations",
  "list_henchmen",
  "read_board",
  "read_queue",
  "soul_read",
  "enqueue_task",
];

/** What an agent's job leaves of the tools: everything, except for a board helper. */
export function roleAllowsTool(role: OfficeAgentRole, tool: OfficeToolName): boolean {
  return role !== "kiosk" || KIOSK_TOOLS.includes(tool);
}

/** Does this agent have the tool? Its preset must include it and its job must leave it. */
export function agentAllowsTool(
  agent: { role: OfficeAgentRole; preset: OfficeAgentPreset },
  tool: OfficeToolName,
): boolean {
  return presetAllows(agent.preset, tool) && roleAllowsTool(agent.role, tool);
}

/** The tools an agent has, in list order. */
export function toolsForAgent(agent: {
  role: OfficeAgentRole;
  preset: OfficeAgentPreset;
}): OfficeToolSpec[] {
  return toolsForPreset(agent.preset).filter((t) => roleAllowsTool(agent.role, t.name));
}

/** Error codes a refused or failed tool call carries (REST `error`, MCP `structuredContent.error`). */
export const OFFICE_TOOL_ERRORS = [
  "unknown_tool",
  "invalid_input",
  "preset_forbids",
  /** The agent's job does not include the tool: a board helper asked for more than its board (#56). */
  "role_forbids",
  "not_found",
  "forbidden",
  "on_behalf_required",
  "not_waiting",
  "cap_reached",
  /** The text looks like it holds a key, a token or a password (#136). */
  "secret_rejected",
  "unavailable",
  "failed",
] as const;
export type OfficeToolError = (typeof OFFICE_TOOL_ERRORS)[number];

export const OfficeToolResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.enum(OFFICE_TOOL_ERRORS), message: z.string() }),
]);
export type OfficeToolResult = z.infer<typeof OfficeToolResult>;
