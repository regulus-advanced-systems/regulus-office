/**
 * Keeps the meeting store current (#50): live meetings every 20 s (door
 * signs and holograms of rooms the viewer may see), the current room's list
 * when the room changes, `meeting.changed` from the OperationRoom, and the
 * open meeting's transcript after each change.
 */
import { MEETING_CHANGED_MESSAGE, MeetingSummary } from "@regulus/protocol";
import { useEffect } from "react";
import type { OfficeClient } from "../../net/officeClient.ts";
import { useOperationStore } from "../../state/operation.ts";
import type { MeetingsApi } from "./api.ts";
import { useMeetingStore } from "./meetingStore.ts";

export const ACTIVE_POLL_MS = 20_000;

export interface MeetingSyncDeps {
  api: MeetingsApi;
  client: Pick<OfficeClient, "onOperationMessage"> | null;
  store?: typeof useMeetingStore;
  operation?: typeof useOperationStore;
  pollMs?: number;
}

/** Subscribe; returns the unsubscribe function. */
export function syncMeetings(deps: MeetingSyncDeps): () => void {
  const store = deps.store ?? useMeetingStore;
  const operation = deps.operation ?? useOperationStore;
  const { api } = deps;
  let stopped = false;
  let detailTimer: ReturnType<typeof setTimeout> | undefined;

  const loadActive = async () => {
    const res = await api.active();
    if (!stopped && res.ok) store.getState().setActive(res.data.meetings);
  };
  const loadList = async (operationId: string | null) => {
    if (!operationId) {
      store.getState().setList(null);
      return;
    }
    const res = await api.list(operationId);
    if (stopped || operation.getState().operationId !== operationId) return;
    store
      .getState()
      .setList(
        res.ok ? { operationId, meetings: res.data.meetings, canStart: res.data.canStart } : null,
      );
  };
  const loadDetail = async (meetingId: string) => {
    const res = await api.detail(meetingId);
    if (stopped || !res.ok) return;
    if (store.getState().panel?.meetingId === meetingId) store.getState().setDetail(res.data);
  };
  const refreshDetailSoon = (meetingId: string) => {
    if (store.getState().panel?.meetingId !== meetingId) return;
    clearTimeout(detailTimer);
    detailTimer = setTimeout(() => void loadDetail(meetingId), 250);
  };

  void loadActive();
  const poll = setInterval(() => void loadActive(), deps.pollMs ?? ACTIVE_POLL_MS);
  let operationId = operation.getState().operationId;
  void loadList(operationId);
  const offs = [
    operation.subscribe((s) => {
      if (s.operationId === operationId) return;
      operationId = s.operationId;
      void loadList(operationId);
    }),
    store.subscribe((s, prev) => {
      const id = s.panel?.meetingId ?? null;
      if (id && id !== (prev.panel?.meetingId ?? null)) void loadDetail(id);
    }),
  ];
  if (deps.client) {
    offs.push(
      deps.client.onOperationMessage(MEETING_CHANGED_MESSAGE, (payload) => {
        const parsed = MeetingSummary.safeParse(payload);
        if (!parsed.success) return;
        store.getState().applyChanged(parsed.data);
        refreshDetailSoon(parsed.data.id);
      }),
    );
  }
  return () => {
    stopped = true;
    clearInterval(poll);
    clearTimeout(detailTimer);
    for (const off of offs) off();
  };
}

export function useMeetingSync(deps: () => MeetingSyncDeps): void {
  useEffect(() => syncMeetings(deps()), [deps]);
}
