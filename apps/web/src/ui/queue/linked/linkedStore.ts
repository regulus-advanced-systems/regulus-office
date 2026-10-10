/**
 * The linked tasks of the room the viewer is in (#257), as the server showed
 * them to this viewer. They are not in the room's live state (that is the
 * same for everyone in the room), so they are fetched: when the room or its
 * queue changes, and on a slow timer for changes in the other rooms.
 */
import type { LinkedTaskView } from "@regulus/protocol";
import { useEffect } from "react";
import { create } from "zustand";
import { useOperationStore } from "../../../state/operation.ts";
import { createLinkedTasksApi, type LinkedTasksApi } from "./api.ts";
import { EMPTY_LINKED_INDEX, indexLinked, type LinkedIndex } from "./linkedModel.ts";

/** Changes in the other rooms (a sibling part finishing, its PR merging) arrive this late at most. */
export const LINKED_REFRESH_MS = 15_000;

export interface LinkedStore {
  operationId: string | null;
  views: readonly LinkedTaskView[];
  index: LinkedIndex;
  set: (operationId: string | null, views: readonly LinkedTaskView[]) => void;
}

const NONE: readonly LinkedTaskView[] = [];

export const useLinkedStore = create<LinkedStore>()((set) => ({
  operationId: null,
  views: NONE,
  index: EMPTY_LINKED_INDEX,
  set: (operationId, views) =>
    set({
      operationId,
      views: views.length === 0 ? NONE : views,
      index: views.length === 0 ? EMPTY_LINKED_INDEX : indexLinked(views),
    }),
}));

const defaultApi = createLinkedTasksApi();
let latest = 0;

/** Fetch the room's linked tasks; a slower answer for an older room is dropped. */
export async function refreshLinked(
  operationId: string | null,
  api: LinkedTasksApi = defaultApi,
): Promise<void> {
  latest += 1;
  const mine = latest;
  if (!operationId) {
    useLinkedStore.getState().set(null, NONE);
    return;
  }
  const result = await api.list(operationId);
  if (mine !== latest) return;
  // A failed refresh keeps what this room showed; another room's views never stay.
  if (result.ok) useLinkedStore.getState().set(operationId, result.data.tasks);
  else if (useLinkedStore.getState().operationId !== operationId) {
    useLinkedStore.getState().set(operationId, NONE);
  }
}

/** A string that changes whenever a task of the room's queue changes state, henchman or PR. */
export function queueSignature(
  queue: readonly { id: string; state: string; agentId: string; prNumber: number }[] | undefined,
): string {
  return (queue ?? []).map((t) => `${t.id}:${t.state}:${t.agentId}:${t.prNumber}`).join("|");
}

/** Keep the store in step with the room the viewer is in. Mount once (QueueHost). */
export function useLinkedTasksSync(api: LinkedTasksApi = defaultApi): void {
  const operationId = useOperationStore((s) => s.operationId);
  const signature = useOperationStore((s) => queueSignature(s.state?.queue));
  useEffect(() => {
    // The signature is why this runs again: the room's queue changed.
    void signature;
    void refreshLinked(operationId, api);
  }, [operationId, signature, api]);
  useEffect(() => {
    if (!operationId) return;
    const timer = setInterval(() => void refreshLinked(operationId, api), LINKED_REFRESH_MS);
    return () => clearInterval(timer);
  }, [operationId, api]);
}
