/**
 * Meeting room state in the browser (#50): live meetings the viewer may see
 * (door signs, the table hologram), the current room's meetings, and which
 * panel is open. Fed by REST and the OperationRoom's `meeting.changed`
 * (meetingSync.ts).
 */
import { isLiveMeeting, type MeetingDetail, type MeetingSummary } from "@regulus/protocol";
import { create } from "zustand";

export const MEETING_OVERLAY = "meeting";

export interface MeetingRoomList {
  operationId: string;
  meetings: MeetingSummary[];
  canStart: boolean;
}

export interface MeetingStore {
  /** Live meetings by id, on every operation the viewer can see. */
  active: Record<string, MeetingSummary>;
  /** The current room's meetings (live first) and whether the viewer may start one. */
  list: MeetingRoomList | null;
  /** The meeting panel: null closed; `meetingId` null shows the room's list. */
  panel: { meetingId: string | null } | null;
  /** The start dialog is open. */
  starting: boolean;
  detail: MeetingDetail | null;
  setActive(meetings: readonly MeetingSummary[]): void;
  setList(list: MeetingRoomList | null): void;
  /** A `meeting.changed` (or a fresh REST answer) for one meeting. */
  applyChanged(summary: MeetingSummary): void;
  setDetail(detail: MeetingDetail | null): void;
  openPanel(meetingId?: string | null): void;
  closePanel(): void;
  openStart(): void;
  closeStart(): void;
}

export const useMeetingStore = create<MeetingStore>()((set) => ({
  active: {},
  list: null,
  panel: null,
  starting: false,
  detail: null,
  setActive: (meetings) =>
    set({
      active: Object.fromEntries(
        meetings.filter((m) => isLiveMeeting(m.status)).map((m) => [m.id, m]),
      ),
    }),
  setList: (list) => set({ list }),
  applyChanged: (summary) =>
    set((s) => {
      const active = { ...s.active };
      if (isLiveMeeting(summary.status)) active[summary.id] = summary;
      else delete active[summary.id];
      let list = s.list;
      if (list && list.operationId === summary.operationId) {
        const others = list.meetings.filter((m) => m.id !== summary.id);
        const meetings = [summary, ...others].sort(
          (a, b) =>
            Number(isLiveMeeting(b.status)) - Number(isLiveMeeting(a.status)) ||
            b.createdAt - a.createdAt,
        );
        list = { ...list, meetings };
      }
      const detail =
        s.detail && s.detail.id === summary.id ? { ...s.detail, ...summary } : s.detail;
      return { active, list, detail };
    }),
  setDetail: (detail) => set({ detail }),
  openPanel: (meetingId = null) => set({ panel: { meetingId }, starting: false }),
  closePanel: () => set({ panel: null, detail: null }),
  openStart: () => set({ starting: true }),
  closeStart: () => set({ starting: false }),
}));

/** The live meeting in a room, if any (one at a time per room). */
export function liveMeetingIn(
  active: Record<string, MeetingSummary>,
  operationId: string | null,
): MeetingSummary | undefined {
  if (!operationId) return undefined;
  return Object.values(active).find((m) => m.operationId === operationId);
}
