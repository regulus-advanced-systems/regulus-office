/**
 * Client state for the henchman controls (#33): which henchman's panel is open,
 * which dialog is up, the pending permission requests the server sent us
 * (only if we may control that henchman, SPEC §8 rule 4), in-flight commands
 * and the last result or refusal per henchman.
 *
 * The scene (a click on a henchman or its desk, #29) calls `openAgentPanel`.
 * Server messages are folded in by agentSync.ts; commands go out through
 * `sendAgentCommand` (agentCommands.ts).
 */
import type {
  AgentCommandResult,
  OpenedPullRequestInfo,
  PendingPermission,
  WorktreeInfo,
} from "@regulus/protocol";
import { create } from "zustand";

export type AgentDialog = "sendHome" | "pr";

export interface AgentRefusal {
  type: string;
  reason: string;
  files?: string[];
}

export interface AgentUiStore {
  /** Henchman whose panel is open. */
  panelAgentId: string | null;
  openAgentPanel: (agentId: string) => void;
  closeAgentPanel: () => void;

  /** Send-home or PR dialog for the panel's henchman. */
  dialog: AgentDialog | null;
  openDialog: (dialog: AgentDialog) => void;
  closeDialog: () => void;

  /** Pending permission requests by henchman (controllers only ever receive these). */
  permissions: Record<string, PendingPermission[]>;
  /** Henchman whose permission dialog is open. */
  permissionAgentId: string | null;
  /** Requests closed without an answer; they do not pop up again by themselves. */
  dismissed: Record<string, true>;
  setPermissions: (agentId: string, requests: PendingPermission[]) => void;
  openPermissionPrompt: (agentId: string) => void;
  closePermissionPrompt: () => void;

  /** Commands awaiting an answer, keyed `agentId|type`. */
  inFlight: Record<string, true>;
  worktree: Record<string, WorktreeInfo>;
  pullRequest: Record<string, OpenedPullRequestInfo>;
  refusal: Record<string, AgentRefusal>;
  started: (agentId: string, type: string) => void;
  succeeded: (result: AgentCommandResult) => void;
  refused: (agentId: string, refusal: AgentRefusal) => void;
  /** Forget a henchman that left (sent home, operation change). */
  forget: (agentId: string) => void;
  reset: () => void;
}

export const flightKey = (agentId: string, type: string) => `${agentId}|${type}`;

const omit = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record;
  const { [key]: _gone, ...rest } = record;
  return rest;
};

const initial = {
  panelAgentId: null,
  dialog: null,
  permissions: {},
  permissionAgentId: null,
  dismissed: {},
  inFlight: {},
  worktree: {},
  pullRequest: {},
  refusal: {},
} satisfies Partial<AgentUiStore>;

export function createAgentStore() {
  return create<AgentUiStore>()((set, get) => ({
    ...initial,

    openAgentPanel: (agentId) =>
      set((s) => ({
        panelAgentId: agentId,
        dialog: s.panelAgentId === agentId ? s.dialog : null,
      })),
    closeAgentPanel: () => set({ panelAgentId: null, dialog: null }),

    openDialog: (dialog) => set({ dialog }),
    closeDialog: () => set({ dialog: null }),

    setPermissions: (agentId, requests) => {
      const s = get();
      const permissions = requests.length
        ? { ...s.permissions, [agentId]: requests }
        : omit(s.permissions, agentId);
      const fresh = requests.some((r) => !s.dismissed[r.requestId]);
      let permissionAgentId = s.permissionAgentId;
      if (permissionAgentId === agentId && requests.length === 0) permissionAgentId = null;
      // A new request pops the prompt for its controller unless one is already up.
      if (fresh && permissionAgentId === null) permissionAgentId = agentId;
      set({ permissions, permissionAgentId });
    },
    openPermissionPrompt: (agentId) => set({ permissionAgentId: agentId }),
    closePermissionPrompt: () =>
      set((s) => {
        const open = s.permissionAgentId ? (s.permissions[s.permissionAgentId] ?? []) : [];
        const dismissed = { ...s.dismissed };
        for (const r of open) dismissed[r.requestId] = true;
        return { permissionAgentId: null, dismissed };
      }),

    started: (agentId, type) =>
      set((s) => ({
        inFlight: { ...s.inFlight, [flightKey(agentId, type)]: true },
        refusal: omit(s.refusal, agentId),
        pullRequest: type === "agent.pr" ? omit(s.pullRequest, agentId) : s.pullRequest,
      })),
    succeeded: (result) =>
      set((s) => {
        const next: Partial<AgentUiStore> = {
          inFlight: omit(s.inFlight, flightKey(result.agentId, result.type)),
        };
        if (result.type === "agent.pr") {
          next.pullRequest = { ...s.pullRequest, [result.agentId]: result.pr };
        }
        if (result.type === "agent.worktree") {
          next.worktree = { ...s.worktree, [result.agentId]: result.worktree };
        }
        if (result.type === "agent.sendHome" && s.panelAgentId === result.agentId) {
          next.panelAgentId = null;
          next.dialog = null;
        }
        return next;
      }),
    refused: (agentId, refusal) =>
      set((s) => ({
        inFlight: omit(s.inFlight, flightKey(agentId, refusal.type)),
        refusal: { ...s.refusal, [agentId]: refusal },
      })),

    forget: (agentId) =>
      set((s) => ({
        panelAgentId: s.panelAgentId === agentId ? null : s.panelAgentId,
        dialog: s.panelAgentId === agentId ? null : s.dialog,
        permissionAgentId: s.permissionAgentId === agentId ? null : s.permissionAgentId,
        permissions: omit(s.permissions, agentId),
        worktree: omit(s.worktree, agentId),
        refusal: omit(s.refusal, agentId),
      })),
    reset: () => set({ ...initial }),
  }));
}

export const useAgentStore = createAgentStore();

/** For the scene (#29): open the panel of the henchman that was clicked. */
export function openAgentPanel(agentId: string): void {
  useAgentStore.getState().openAgentPanel(agentId);
}
