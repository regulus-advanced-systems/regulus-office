/**
 * Builders for the documented traces (documented.ts). Traces for flows that need a signed-in account (turns, approvals, token
 * usage, rate limits). They cannot be recorded without logging in, so they
 * are written from the documented protocol
 * (https://learn.chatgpt.com/docs/app-server: "Turns", "Items", "Approvals",
 * "Errors", "6) Rate limits") and type-checked against the generated
 * bindings: every server message below `satisfies` its generated type.
 */
import type { ServerNotification, ServerRequest } from "../generated/index.ts";
import type { CommandAction, Thread, ThreadItem, Turn } from "../generated/v2/index.ts";
import type { CodexMethod, CodexResponses } from "../rpc.ts";
import type { TraceStep } from "../testing/trace.ts";

export const THREAD_ID = "019a0000-0000-7000-8000-00000000c0de";
export const TURN_ID = "019a0000-0000-7000-8000-0000000071a0";
export const CWD = "/srv/office/worktrees/f1/a1";

export const out = (msg: Record<string, unknown>): TraceStep => ({ dir: "out", msg });
export const note = (msg: ServerNotification): TraceStep => ({ dir: "in", msg: msg as never });
export const ask = (msg: ServerRequest): TraceStep => ({ dir: "in", msg: msg as never });
export const reply = <M extends CodexMethod>(_method: M, id: number, result: CodexResponses[M]) =>
  ({ dir: "in", msg: { id, result } }) as TraceStep;
export const fail = (id: number, code: number, message: string): TraceStep => ({
  dir: "in",
  msg: { id, error: { code, message } },
});

export const thread: Thread = {
  id: THREAD_ID,
  sessionId: THREAD_ID,
  forkedFromId: null,
  parentThreadId: null,
  preview: "",
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  projectId: null,
  historyMode: "legacy",
  modelProvider: "openai",
  model: "gpt-6-sol",
  reasoningEffort: null,
  createdAt: 1_730_910_000,
  updatedAt: 1_730_910_000,
  recencyAt: null,
  status: { type: "idle" },
  path: null,
  cwd: CWD,
  cliVersion: "0.158.0",
  originator: null,
  source: "unknown",
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: null,
  turns: [],
};

export const threadResponse = {
  thread,
  model: "gpt-6-sol",
  modelProvider: "openai",
  serviceTier: null,
  disabledPluginIds: [],
  cwd: CWD,
  instructionSources: [],
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandbox: {
    type: "workspaceWrite",
    writableRoots: [CWD],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  },
  reasoningEffort: null,
} satisfies CodexResponses["thread/start"];

export const turn = (status: Turn["status"], error: Turn["error"] = null): Turn => ({
  id: TURN_ID,
  items: [],
  itemsView: "notLoaded",
  status,
  error,
  startedAt: 1_730_910_001,
  completedAt: status === "inProgress" ? null : 1_730_910_060,
  durationMs: status === "inProgress" ? null : 59_000,
});

export const command = (
  id: string,
  cmd: string,
  status: "inProgress" | "completed",
  commandActions: CommandAction[] = [{ type: "unknown", command: cmd }],
): ThreadItem => ({
  type: "commandExecution",
  id,
  pluginId: null,
  scriptPath: null,
  command: cmd,
  cwd: CWD,
  processId: null,
  source: "agent",
  status,
  commandActions,
  aggregatedOutput: status === "completed" ? "12 pass\n0 fail\n" : null,
  exitCode: status === "completed" ? 0 : null,
  durationMs: status === "completed" ? 1200 : null,
});

export const patch = (status: "inProgress" | "completed"): ThreadItem => ({
  type: "fileChange",
  id: "item_patch",
  changes: [
    {
      path: "src/app.ts",
      kind: { type: "update", move_path: null },
      diff: "@@ -1 +1 @@\n-a\n+b\n",
    },
  ],
  status,
});

export const message = (text: string): ThreadItem => ({
  type: "agentMessage",
  id: "item_msg",
  text,
  phase: null,
  memoryCitation: null,
  delivery: null,
  questions: null,
});

export const usage = (total: number, input: number, cached: number, output: number) =>
  note({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      tokenUsage: {
        total: {
          totalTokens: total,
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: input + output,
          inputTokens: input,
          cachedInputTokens: cached,
          cacheWriteInputTokens: 0,
          outputTokens: output,
          reasoningOutputTokens: 10,
        },
        modelContextWindow: 400_000,
      },
    },
  });

export const INIT_RESULT = {
  userAgent: "regulus_office/0.158.0",
  codexHome: "/home/office-u-u1/.codex",
  platformFamily: "unix",
  platformOs: "linux",
} satisfies CodexResponses["initialize"];

export const handshake = (): TraceStep[] => [
  out({ method: "initialize", id: 0, params: { clientInfo: { name: "regulus_office" } } }),
  reply("initialize", 0, INIT_RESULT),
  out({ method: "initialized" }),
];

export const RESETS = 1_730_947_200;

export const resumeResponse = {
  ...threadResponse,
  collaborationMode: null,
  turnsBackwardsCursor: null,
  itemsBackwardsCursor: null,
} satisfies CodexResponses["thread/resume"];

export function toJsonl(steps: TraceStep[]): string {
  return `${steps.map((s) => JSON.stringify(s)).join("\n")}\n`;
}
