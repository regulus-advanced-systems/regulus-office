/**
 * Room settings' live preview (#187): while a room manager edits a room's
 * desk count or decor style, the scene draws the room as it would be. The
 * draft is cleared when the panel closes; once saved, the published room
 * already matches it, so nothing jumps.
 */
import type { DecorStyle } from "@regulus/protocol";
import { create } from "zustand";
import type { WorldRoom } from "../world.ts";

export interface RoomDraft {
  operationId: string;
  deskCount: number;
  decorStyle: DecorStyle;
}

export const useRoomDraftStore = create<{
  draft: RoomDraft | null;
  set(draft: RoomDraft | null): void;
}>()((set) => ({
  draft: null,
  set: (draft) => set({ draft }),
}));

/** The rooms with the draft applied (the same array when it changes nothing). */
export function withDraft(
  rooms: readonly WorldRoom[],
  draft: RoomDraft | null,
): readonly WorldRoom[] {
  if (!draft) return rooms;
  let changed = false;
  const out = rooms.map((r) => {
    if (r.id !== draft.operationId || r.kind !== "project") return r;
    if (r.deskCount === draft.deskCount && r.decorStyle === draft.decorStyle) return r;
    changed = true;
    return { ...r, deskCount: draft.deskCount, decorStyle: draft.decorStyle };
  });
  return changed ? out : rooms;
}
