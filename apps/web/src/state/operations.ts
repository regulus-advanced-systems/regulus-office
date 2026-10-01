/**
 * Operations the signed-in user can see (REST `GET /api/operations`), with their
 * repos' clone status. The BuildingRoom operation list is the live, office-wide
 * directory; this list adds per-user access, template and repo details.
 */
import type { OperationInfo } from "@regulus/protocol";
import { create } from "zustand";
import { createOperationsApi, type OperationsApi } from "../ui/operations/api.ts";

export interface OperationsStore {
  /** Null until the first successful load. */
  operations: OperationInfo[] | null;
  error: string | null;
  refresh: (api?: OperationsApi) => Promise<void>;
  /** Insert or replace one operation (after create) without a round trip. */
  upsert: (operation: OperationInfo) => void;
  clear: () => void;
}

const defaultApi = createOperationsApi();

export const useOperationsStore = create<OperationsStore>()((set, get) => ({
  operations: null,
  error: null,
  refresh: async (api = defaultApi) => {
    const result = await api.list();
    if (result.ok) set({ operations: result.data.operations, error: null });
    else set({ error: result.code });
  },
  upsert: (operation) => {
    const rest = (get().operations ?? []).filter((f) => f.operationId !== operation.operationId);
    set({ operations: [...rest, operation].sort((a, b) => a.index - b.index) });
  },
  clear: () => set({ operations: null, error: null }),
}));

/** True while any repo of any listed operation is still cloning. */
export function anyCloning(operations: readonly OperationInfo[] | null): boolean {
  return (operations ?? []).some((f) => f.repos.some((r) => r.cloneStatus === "cloning"));
}

/** Summary chip for quick travel: `cloning` / `error` / null when all repos are ready. */
export function cloneBadge(operation: OperationInfo | undefined): "cloning" | "error" | null {
  if (!operation) return null;
  if (operation.repos.some((r) => r.cloneStatus === "error")) return "error";
  if (operation.repos.some((r) => r.cloneStatus === "cloning")) return "cloning";
  return null;
}
