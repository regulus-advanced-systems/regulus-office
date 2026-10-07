/**
 * The one place an office tool call is authorised, run and audited (#271).
 * MCP (`../mcp.ts`) and REST (`../tool-routes.ts`) both end here, so the two
 * transports cannot differ in what they allow.
 *
 * Order of checks: the tool exists; the agent's preset includes it; the
 * input is valid; then the tool's own checks (operation access as the owner
 * or by grant, acting person, caps). Every call writes one audit row:
 * `office_agent.tool_call` when it ran (also when it then failed), or
 * `office_agent.tool_denied` when it was refused. The row names the tool, the
 * transport, the operation and the person acted for; never the arguments'
 * text, which may be a prompt, a comment, a memory or a note.
 */
import {
  OFFICE_TOOL_INPUTS,
  OFFICE_TOOLS,
  type OfficeToolError,
  type OfficeToolName,
  type OfficeToolResult,
  type OfficeToolSpec,
  officeToolSpec,
  presetAllows,
  toolsForPreset,
} from "@regulus/protocol";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAudit } from "../../auth/audit.ts";
import type { Logger } from "../../logging.ts";
import type { OfficeAgentRow } from "../store.ts";
import { type ToolCall, type ToolDeps, ToolError } from "./context.ts";
import * as memory from "./memory.ts";
import * as read from "./read.ts";
import * as write from "./write.ts";

export type ToolTransport = "mcp" | "rest";

type Handler<N extends OfficeToolName> = (
  call: ToolCall,
  input: z.output<(typeof OFFICE_TOOL_INPUTS)[N]>,
) => unknown;

const HANDLERS: { [N in OfficeToolName]: Handler<N> } = {
  list_operations: (call) => read.listOperations(call),
  list_henchmen: read.listHenchmen,
  read_board: read.readBoard,
  read_queue: read.readQueue,
  read_usage: (call) => read.readUsage(call),
  read_human_request: read.readHumanRequest,
  ask_human: write.askHuman,
  enqueue_task: write.enqueueTask,
  comment_on_card: write.commentOnCard,
  post_chat: write.postChat,
  spawn_henchman: write.spawnHenchman,
  stop_henchman: write.stopHenchman,
  soul_read: (call) => memory.soulRead(call),
  memory_save: memory.memorySave,
  memory_search: memory.memorySearch,
  memory_list: memory.memoryList,
  memory_forget: memory.memoryForget,
  note_write: memory.noteWrite,
  note_read: memory.noteRead,
  note_list: (call) => memory.noteList(call),
  note_delete: memory.noteDelete,
};

/** Refusals (the agent asked for something it may not do), as opposed to failures. */
const DENIALS: ReadonlySet<OfficeToolError> = new Set([
  "unknown_tool",
  "preset_forbids",
  "not_found",
  "forbidden",
  "on_behalf_required",
  "not_waiting",
  "cap_reached",
  "secret_rejected",
]);

export interface PublishedTool extends OfficeToolSpec {
  inputSchema: Record<string, unknown>;
}

const SCHEMAS = new Map<OfficeToolName, Record<string, unknown>>(
  OFFICE_TOOLS.map((t) => [
    t.name,
    z.toJSONSchema(OFFICE_TOOL_INPUTS[t.name], { io: "input" }) as Record<string, unknown>,
  ]),
);

const idOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= 128 ? v : undefined;

export class OfficeTools {
  constructor(
    private readonly deps: ToolDeps,
    private readonly logger: Logger,
  ) {}

  /** The tools the agent's preset includes, with their input schemas. */
  list(agent: Pick<OfficeAgentRow, "preset">): PublishedTool[] {
    return toolsForPreset(agent.preset).map((t) => ({
      ...t,
      inputSchema: SCHEMAS.get(t.name) ?? { type: "object" },
    }));
  }

  async call(
    agent: OfficeAgentRow,
    name: string,
    rawInput: unknown,
    via: ToolTransport,
  ): Promise<OfficeToolResult> {
    const call: ToolCall = { ...this.deps, agent };
    const raw =
      rawInput !== null && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? (rawInput as Record<string, unknown>)
        : {};
    let result: OfficeToolResult;
    try {
      result = { ok: true, result: await this.#run(call, name, rawInput ?? {}) };
    } catch (err) {
      if (err instanceof ToolError) {
        result = { ok: false, error: err.code, message: err.message };
      } else {
        this.logger.error(
          { agentId: agent.id, tool: name, err: String(err).slice(0, 300) },
          "office tool failed",
        );
        result = { ok: false, error: "failed", message: "the office could not do that" };
      }
    }
    const denied = !result.ok && DENIALS.has(result.error);
    try {
      writeAudit(this.deps.store.db, {
        // Whose rights were used: the owner of a personal agent, or the person a shared one acted for.
        userId: call.actedFor ?? agent.ownerUserId,
        action: denied ? AUDIT_ACTIONS.officeAgentToolDenied : AUDIT_ACTIONS.officeAgentToolCall,
        targetKind: "office_agent",
        targetId: agent.id,
        meta: {
          tool: officeToolSpec(name) ? name : "unknown",
          via,
          ok: result.ok,
          ...(result.ok ? {} : { error: result.error }),
          preset: agent.preset,
          shared: agent.ownerUserId === null,
          ...(idOf(raw.operationId) ? { operationId: idOf(raw.operationId) } : {}),
          ...(idOf(raw.onBehalfOf) ? { onBehalfOf: idOf(raw.onBehalfOf) } : {}),
          // Memory and note tools (#136): which entry and how long, never what it says.
          ...(result.ok ? call.auditMeta : {}),
        },
      });
      this.deps.store.touch(agent.id);
    } catch (err) {
      // Without its audit row a call is reported as failed, so it is looked into.
      this.logger.error({ agentId: agent.id, err: String(err).slice(0, 300) }, "audit failed");
      return { ok: false, error: "failed", message: "the office could not record that call" };
    }
    return result;
  }

  async #run(call: ToolCall, name: string, rawInput: unknown): Promise<unknown> {
    const spec = officeToolSpec(name);
    if (!spec) throw new ToolError("unknown_tool", "no such tool");
    if (!presetAllows(call.agent.preset, spec.name)) {
      throw new ToolError(
        "preset_forbids",
        `your privilege preset (${call.agent.preset}) does not include ${spec.name}; it needs ${spec.preset}`,
      );
    }
    const parsed = OFFICE_TOOL_INPUTS[spec.name].safeParse(rawInput);
    if (!parsed.success) {
      // Field paths only: zod messages could quote the input.
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "input"))];
      throw new ToolError("invalid_input", `invalid input: ${fields.join(", ")}`);
    }
    const handler = HANDLERS[spec.name] as (call: ToolCall, input: unknown) => unknown;
    return await handler(call, parsed.data);
  }
}
