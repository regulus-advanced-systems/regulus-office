/**
 * Folds the OperationRoom's henchman messages into the agent store (#33):
 * `agent.permissions` (sent to us only if we may control the henchman),
 * `agent.result` and `command.rejected` for our own commands, and
 * `agent.leaving` (a henchman was sent home: play the walk to the elevator).
 * Everything is validated with the protocol schemas before it is used.
 * Changing operations forgets the previous operation's henchmen.
 */
import {
  AGENT_LEAVING_MESSAGE,
  AGENT_PERMISSIONS_MESSAGE,
  AGENT_RESULT_MESSAGE,
  AgentCommandResult,
  AgentLeaving,
  AgentPermissions,
  type CommandRejected,
} from "@regulus/protocol";
import { useEffect } from "react";
import type { OfficeClient } from "../../net/officeClient.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useUiStore } from "../../state/ui.ts";
import { useAgentStore } from "./agentStore.ts";

export interface AgentSyncDeps {
  client: Pick<OfficeClient, "onOperationMessage" | "onRejected">;
  store?: typeof useAgentStore;
  operation?: typeof useOperationStore;
  toast?: (input: { kind: "success" | "error" | "info"; title?: string; message: string }) => void;
  /** A henchman was sent home; start its walk to the elevator. */
  onLeaving?: (agentId: string) => void;
}

const DONE: Partial<Record<AgentCommandResult["type"], string>> = {
  "agent.interrupt": "Interrupted",
  "agent.stop": "Stopped",
  "agent.emergencyStop": "Emergency-stopped; its owner can resume it",
  "agent.resume": "Resuming",
};

/** Subscribe; returns the unsubscribe function. */
export function syncAgentMessages(deps: AgentSyncDeps): () => void {
  const store = deps.store ?? useAgentStore;
  const operation = deps.operation ?? useOperationStore;
  const toast = deps.toast ?? ((input) => useUiStore.getState().toast(input));
  const offs = [
    deps.client.onOperationMessage(AGENT_PERMISSIONS_MESSAGE, (payload) => {
      const parsed = AgentPermissions.safeParse(payload);
      if (parsed.success)
        store.getState().setPermissions(parsed.data.agentId, parsed.data.requests);
    }),
    deps.client.onOperationMessage(AGENT_RESULT_MESSAGE, (payload) => {
      const parsed = AgentCommandResult.safeParse(payload);
      if (!parsed.success) return;
      store.getState().succeeded(parsed.data);
      const done = DONE[parsed.data.type];
      if (done) toast({ kind: "info", message: done });
    }),
    deps.client.onOperationMessage(AGENT_LEAVING_MESSAGE, (payload) => {
      const parsed = AgentLeaving.safeParse(payload);
      if (!parsed.success) return;
      deps.onLeaving?.(parsed.data.agentId);
      store.getState().forget(parsed.data.agentId);
    }),
    deps.client.onRejected((notice: CommandRejected) => {
      if (!notice.agentId || !notice.type.startsWith("agent.")) return;
      store.getState().refused(notice.agentId, {
        type: notice.type,
        reason: notice.reason,
        ...(notice.files ? { files: notice.files } : {}),
      });
      // The PR dialog shows its own refusal with the file list.
      if (notice.type !== "agent.pr" && notice.type !== "agent.worktree") {
        toast({ kind: "error", title: "Henchman command refused", message: notice.reason });
      }
    }),
  ];
  let operationId = operation.getState().operationId;
  offs.push(
    operation.subscribe((s) => {
      if (s.operationId === operationId) return;
      operationId = s.operationId;
      store.getState().reset();
    }),
  );
  return () => {
    for (const off of offs) off();
  };
}

export function useAgentSync(deps: AgentSyncDeps | (() => AgentSyncDeps)): void {
  useEffect(() => syncAgentMessages(typeof deps === "function" ? deps() : deps), [deps]);
}
