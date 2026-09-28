/**
 * Traces for flows that need a signed-in account (turns, approvals, token
 * usage, rate limits). They cannot be recorded without logging in, so they
 * are written from the documented protocol
 * (https://learn.chatgpt.com/docs/app-server: "Turns", "Items", "Approvals",
 * "Errors", "6) Rate limits") and type-checked against the generated
 * bindings via the builders in builders.ts.
 */
import type { TraceStep } from "../testing/trace.ts";
import {
  ask,
  CWD,
  command,
  fail,
  handshake,
  message,
  note,
  out,
  patch,
  RESETS,
  reply,
  resumeResponse,
  THREAD_ID,
  TURN_ID,
  thread,
  threadResponse,
  turn,
  usage,
} from "./builders.ts";

export { CWD, THREAD_ID, TURN_ID, toJsonl } from "./builders.ts";

/** New thread, one turn with a command approval, a file-change approval, web search, answer. */
export const turnWithApprovals: TraceStep[] = [
  ...handshake(),
  out({
    method: "thread/start",
    id: 1,
    params: { cwd: CWD, approvalPolicy: "on-request", sandbox: "workspace-write" },
  }),
  reply("thread/start", 1, threadResponse),
  note({ method: "thread/started", params: { thread } }),
  out({ method: "account/rateLimits/read", id: 2 }),
  reply("account/rateLimits/read", 2, {
    ordinaryUsageAllowed: true,
    rateLimits: {
      limitId: "codex",
      limitName: null,
      normalModelSlug: null,
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: RESETS },
      secondary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: RESETS + 86_400 },
      credits: null,
      individualLimit: null,
      spendControlReached: null,
      planType: null,
      rateLimitReachedType: null,
    },
    rateLimitsByLimitId: null,
    rateLimitResetCredits: null,
    accountId: null,
    rateLimitUpsell: null,
  }),
  out({
    method: "turn/start",
    id: 3,
    params: {
      threadId: THREAD_ID,
      input: [{ type: "text", text: "Run the tests and fix app.ts" }],
    },
  }),
  reply("turn/start", 3, { turn: turn("inProgress") }),
  note({ method: "turn/started", params: { threadId: THREAD_ID, turn: turn("inProgress") } }),
  note({
    method: "item/started",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      startedAtMs: 1,
      item: { type: "reasoning", id: "item_r", summary: [], content: [] },
    },
  }),
  note({
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: "item_r",
      delta: "Checking tests",
      summaryIndex: 0,
    },
  }),
  note({
    method: "item/completed",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      completedAtMs: 2,
      item: { type: "reasoning", id: "item_r", summary: ["Checking tests"], content: [] },
    },
  }),
  note({
    method: "item/started",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      startedAtMs: 3,
      item: command("item_cmd", "bun test", "inProgress"),
    },
  }),
  ask({
    method: "item/commandExecution/requestApproval",
    id: 0,
    params: {
      kind: "command",
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: "item_cmd",
      startedAtMs: 3,
      environmentId: null,
      reason: "Run the test suite",
      command: "bun test",
      cwd: CWD,
    },
  }),
  out({ id: 0, result: { decision: "accept" } }),
  note({ method: "serverRequest/resolved", params: { threadId: THREAD_ID, requestId: 0 } }),
  note({
    method: "item/completed",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      completedAtMs: 4,
      item: command("item_cmd", "bun test", "completed"),
    },
  }),
  note({
    method: "item/started",
    params: { threadId: THREAD_ID, turnId: TURN_ID, startedAtMs: 5, item: patch("inProgress") },
  }),
  ask({
    method: "item/fileChange/requestApproval",
    id: 1,
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: "item_patch",
      startedAtMs: 5,
      reason: null,
      grantRoot: null,
    },
  }),
  out({ id: 1, result: { decision: "acceptForSession" } }),
  note({ method: "serverRequest/resolved", params: { threadId: THREAD_ID, requestId: 1 } }),
  note({
    method: "item/completed",
    params: { threadId: THREAD_ID, turnId: TURN_ID, completedAtMs: 6, item: patch("completed") },
  }),
  note({
    method: "item/started",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      startedAtMs: 7,
      item: {
        type: "webSearch",
        id: "item_web",
        query: "bun test flags",
        action: null,
        results: null,
      },
    },
  }),
  note({
    method: "item/completed",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      completedAtMs: 8,
      item: {
        type: "webSearch",
        id: "item_web",
        query: "bun test flags",
        action: null,
        results: null,
      },
    },
  }),
  note({
    method: "item/started",
    params: { threadId: THREAD_ID, turnId: TURN_ID, startedAtMs: 9, item: message("") },
  }),
  note({
    method: "item/agentMessage/delta",
    params: { threadId: THREAD_ID, turnId: TURN_ID, itemId: "item_msg", delta: "Tests " },
  }),
  note({
    method: "item/agentMessage/delta",
    params: { threadId: THREAD_ID, turnId: TURN_ID, itemId: "item_msg", delta: "pass." },
  }),
  note({
    method: "item/completed",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      completedAtMs: 10,
      item: message("Tests pass."),
    },
  }),
  usage(1500, 1200, 1000, 300),
  usage(1500, 1200, 1000, 300),
  note({
    method: "account/rateLimits/updated",
    params: {
      rateLimits: {
        limitId: "codex",
        limitName: null,
        normalModelSlug: null,
        primary: { usedPercent: 31, windowDurationMins: 300, resetsAt: RESETS },
        secondary: null,
        credits: null,
        individualLimit: null,
        spendControlReached: null,
        planType: null,
        rateLimitReachedType: null,
      },
    },
  }),
  note({ method: "turn/completed", params: { threadId: THREAD_ID, turn: turn("completed") } }),
];

/** Resumed thread (API-key account: no plan limits), interrupted mid-command. */
export const resumeAndInterrupt: TraceStep[] = [
  ...handshake(),
  out({ method: "thread/resume", id: 1, params: { threadId: THREAD_ID, cwd: CWD } }),
  reply("thread/resume", 1, resumeResponse),
  out({ method: "account/rateLimits/read", id: 2 }),
  fail(2, -32600, "codex account authentication required to read rate limits"),
  out({ method: "turn/start", id: 3, params: { threadId: THREAD_ID } }),
  reply("turn/start", 3, { turn: turn("inProgress") }),
  note({ method: "turn/started", params: { threadId: THREAD_ID, turn: turn("inProgress") } }),
  note({
    method: "item/started",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      startedAtMs: 1,
      item: command("item_ls", "cat README.md", "inProgress", [
        { type: "read", command: "cat README.md", name: "README.md", path: `${CWD}/README.md` },
      ]),
    },
  }),
  out({ method: "turn/steer", id: 4, params: { threadId: THREAD_ID, expectedTurnId: TURN_ID } }),
  reply("turn/steer", 4, { turnId: TURN_ID }),
  out({ method: "turn/interrupt", id: 5, params: { threadId: THREAD_ID, turnId: TURN_ID } }),
  reply("turn/interrupt", 5, {}),
  note({ method: "turn/completed", params: { threadId: THREAD_ID, turn: turn("interrupted") } }),
];

/** Retryable then final error, a permissions request that is rejected, unsupported server requests, crash. */
export const failuresAndServerRequests: TraceStep[] = [
  ...handshake(),
  out({ method: "thread/start", id: 1 }),
  reply("thread/start", 1, threadResponse),
  out({ method: "account/rateLimits/read", id: 2 }),
  fail(2, -32600, "codex account authentication required to read rate limits"),
  out({ method: "turn/start", id: 3 }),
  reply("turn/start", 3, { turn: turn("inProgress") }),
  ask({
    method: "item/permissions/requestApproval",
    id: 7,
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: "item_perm",
      environmentId: null,
      startedAtMs: 1,
      cwd: CWD,
      reason: "Needs network to install deps",
      permissions: { network: { enabled: true }, fileSystem: null },
    },
  }),
  out({ id: 7, result: { permissions: {}, scope: "turn" } }),
  ask({
    method: "account/chatgptAuthTokens/refresh",
    id: 8,
    params: { reason: "unauthorized", previousAccountId: null },
  }),
  out({ id: 8, error: { code: -32601 } }),
  note({
    method: "error",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      willRetry: true,
      error: {
        message: "stream disconnected",
        codexErrorInfo: null,
        additionalDetails: null,
        misalignment: null,
      },
    },
  }),
  note({
    method: "error",
    params: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      willRetry: false,
      error: {
        message: "Usage limit reached",
        codexErrorInfo: "usageLimitExceeded",
        additionalDetails: null,
        misalignment: null,
      },
    },
  }),
  note({
    method: "turn/completed",
    params: {
      threadId: THREAD_ID,
      turn: turn("failed", {
        message: "Usage limit reached",
        codexErrorInfo: "usageLimitExceeded",
        additionalDetails: null,
        misalignment: null,
      }),
    },
  }),
  { dir: "in", msg: { exit: 1 } },
];
