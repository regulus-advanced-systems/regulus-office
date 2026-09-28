/**
 * App-server notifications → `AgentEvent`s (SPEC §7 `AgentControl.events`).
 *
 * | Codex                                   | AgentEvent                                  |
 * |-----------------------------------------|---------------------------------------------|
 * | turn/started                            | status working                              |
 * | turn/completed completed / interrupted  | status idle (+ action none)                 |
 * | turn/completed failed                   | status error + action failing               |
 * | error (willRetry)                       | action failing                              |
 * | error (final)                           | status error + action failing               |
 * | item/started                            | action (see items.ts) + tool_call running   |
 * | item/completed                          | tool_call completed/failed; agentMessage →  |
 * |                                         | final message                               |
 * | item/agentMessage/delta                 | message assistant partial                   |
 * | item/reasoning/summaryTextDelta         | message thought partial                     |
 * | thread/tokenUsage/updated               | usage                                       |
 * | account/rateLimits/updated              | limit (per recognised window)               |
 * | thread/status/changed systemError       | status error                                |
 *
 * Server requests (approvals) are mapped by `permissionRequest` below; the
 * control keeps the JSON-RPC id to answer them.
 */
import type { AgentEvent, PermissionRequestEvent } from "@regulus/protocol";
import type { ThreadItem, TurnError } from "./generated/v2/index.ts";
import { actionEvent, clip, toolCallEvent } from "./items.ts";
import type { CodexNotification, CodexServerRequest } from "./rpc.ts";
import { limitSamples, TokenUsageTracker } from "./usage.ts";

/** Approval requests the office can answer with allow_once / allow_always / reject. */
export type ApprovalRequest = Extract<
  CodexServerRequest,
  {
    method:
      | "item/commandExecution/requestApproval"
      | "item/fileChange/requestApproval"
      | "item/permissions/requestApproval";
  }
>;

export const APPROVAL_METHODS: ReadonlySet<string> = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);

export function isApprovalRequest(req: CodexServerRequest): req is ApprovalRequest {
  return APPROVAL_METHODS.has(req.method);
}

function errorReason(error: TurnError | null | undefined, fallback: string): string {
  if (!error) return fallback;
  const info = typeof error.codexErrorInfo === "string" ? ` (${error.codexErrorInfo})` : "";
  return clip(`${error.message}${info}`, 500);
}

export class CodexEventMapper {
  /** Our thread; notifications for other threads (sub-agents) are ignored. */
  threadId: string | undefined;
  /** Latest active turn id, for `turn/interrupt` and `turn/steer`. */
  activeTurnId: string | undefined;
  readonly #items = new Map<string, ThreadItem>();
  readonly #usage = new TokenUsageTracker();
  readonly #failedTurns = new Set<string>();

  /** The item an approval refers to (cached from item/started). */
  item(itemId: string): ThreadItem | undefined {
    return this.#items.get(itemId);
  }

  #foreign(params: unknown): boolean {
    if (!this.threadId || typeof params !== "object" || params === null) return false;
    const threadId = (params as { threadId?: unknown }).threadId;
    return typeof threadId === "string" && threadId !== this.threadId;
  }

  map(n: CodexNotification, ts: number): AgentEvent[] {
    if (this.#foreign(n.params)) return [];
    switch (n.method) {
      case "turn/started":
        this.activeTurnId = n.params.turn.id;
        return [{ kind: "status", ts, status: "working" }];
      case "turn/completed":
        return this.#turnCompleted(n.params.turn.id, n.params.turn.status, n.params.turn.error, ts);
      case "error": {
        const reason = errorReason(n.params.error, "error");
        if (n.params.willRetry)
          return [{ kind: "action", ts, action: "failing", detail: clip(reason, 200) }];
        this.#failedTurns.add(n.params.turnId);
        return [
          { kind: "status", ts, status: "error", reason },
          { kind: "action", ts, action: "failing", detail: clip(reason, 200) },
        ];
      }
      case "item/started": {
        const item = n.params.item;
        this.#items.set(item.id, item);
        const out: AgentEvent[] = [];
        const action = actionEvent(item, ts);
        if (action) out.push(action);
        const tool = toolCallEvent(item, "started", ts);
        if (tool) out.push(tool);
        return out;
      }
      case "item/completed":
        return this.#itemCompleted(n.params.item, ts);
      case "item/agentMessage/delta":
        return [
          {
            kind: "message",
            ts,
            role: "assistant",
            messageId: clip(n.params.itemId, 128),
            text: n.params.delta,
            partial: true,
          },
        ];
      case "item/reasoning/summaryTextDelta":
        return [
          {
            kind: "message",
            ts,
            role: "thought",
            messageId: clip(n.params.itemId, 128),
            text: n.params.delta,
            partial: true,
          },
        ];
      case "thread/tokenUsage/updated": {
        const usage = this.#usage.next(n.params.tokenUsage, ts);
        return usage ? [{ kind: "usage", ...usage }] : [];
      }
      case "account/rateLimits/updated":
        return limitSamples(n.params.rateLimits, ts).map((s) => ({ kind: "limit", ts, ...s }));
      case "thread/status/changed":
        return n.params.status.type === "systemError"
          ? [{ kind: "status", ts, status: "error", reason: "codex thread system error" }]
          : [];
      case "serverRequest/resolved":
      default:
        return [];
    }
  }

  #turnCompleted(
    turnId: string,
    status: string,
    error: TurnError | null,
    ts: number,
  ): AgentEvent[] {
    if (this.activeTurnId === turnId) this.activeTurnId = undefined;
    this.#items.clear();
    if (status === "failed") {
      if (this.#failedTurns.delete(turnId)) return [];
      const reason = errorReason(error, "turn failed");
      return [
        { kind: "status", ts, status: "error", reason },
        { kind: "action", ts, action: "failing", detail: clip(reason, 200) },
      ];
    }
    this.#failedTurns.delete(turnId);
    return [
      {
        kind: "status",
        ts,
        status: "idle",
        ...(status === "interrupted" ? { reason: "interrupted" } : {}),
      },
      { kind: "action", ts, action: "none" },
    ];
  }

  #itemCompleted(item: ThreadItem, ts: number): AgentEvent[] {
    this.#items.delete(item.id);
    const out: AgentEvent[] = [];
    if (item.type === "agentMessage") {
      out.push({
        kind: "message",
        ts,
        role: "assistant",
        messageId: clip(item.id, 128),
        text: item.text,
        partial: false,
      });
    }
    const tool = toolCallEvent(item, "completed", ts);
    if (tool) out.push(tool);
    return out;
  }

  /** `permission_request` event for an approval server request. */
  permissionRequest(requestId: string, req: ApprovalRequest, ts: number): PermissionRequestEvent {
    const { toolName, lines } = this.#describe(req);
    return {
      kind: "permission_request",
      ts,
      requestId: clip(requestId, 128),
      toolName,
      description: clip(lines.filter(Boolean).join("\n") || toolName, 2000),
      options: ["allow_once", "allow_always", "reject"],
    };
  }

  #describe(req: ApprovalRequest): { toolName: string; lines: string[] } {
    switch (req.method) {
      case "item/commandExecution/requestApproval": {
        const p = req.params;
        const item = this.#items.get(p.itemId);
        const command = p.command ?? (item?.type === "commandExecution" ? item.command : undefined);
        const cwd = p.cwd ?? (item?.type === "commandExecution" ? item.cwd : undefined);
        if (p.networkApprovalContext) {
          const net = p.networkApprovalContext;
          return {
            toolName: "network",
            lines: [p.reason ?? "", `Network access to ${net.host} (${net.protocol})`],
          };
        }
        return {
          toolName: p.kind === "writeStdin" ? "shell_input" : "shell",
          lines: [p.reason ?? "", command ? `$ ${command}` : "", cwd ? `in ${cwd}` : ""],
        };
      }
      case "item/fileChange/requestApproval": {
        const p = req.params;
        const item = this.#items.get(p.itemId);
        const paths = item?.type === "fileChange" ? item.changes.map((c) => c.path) : [];
        return {
          toolName: "apply_patch",
          lines: [
            p.reason ?? "",
            paths.length ? `Edit ${paths.join(", ")}` : "Apply file changes",
            p.grantRoot ? `Allow writes under ${p.grantRoot} for this session` : "",
          ],
        };
      }
      case "item/permissions/requestApproval": {
        const p = req.params;
        const fs = p.permissions.fileSystem;
        return {
          toolName: "permissions",
          lines: [
            p.reason ?? "",
            p.permissions.network?.enabled ? "Network access" : "",
            fs?.write?.length ? `Write: ${fs.write.join(", ")}` : "",
            fs?.read?.length ? `Read: ${fs.read.join(", ")}` : "",
            `in ${p.cwd}`,
          ],
        };
      }
    }
  }
}
