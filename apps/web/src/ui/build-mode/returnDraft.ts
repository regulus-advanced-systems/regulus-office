/**
 * Back to the Add floor dialog (#187): when the server refuses a new room
 * for something build mode cannot fix (a bad repo, a missing token), the
 * dialog reopens with the name, palette and repos as typed and the reason.
 * Tokens are never carried back: they are typed again.
 */
import type { PlaceRoomRequest } from "@regulus/protocol";
import { create } from "zustand";
import { useUiStore } from "../../state/ui.ts";

export const ADD_FLOOR_OVERLAY = "add-floor";

export interface AddFloorDraft {
  name: string;
  paletteId?: string;
  repos: string[];
  error: string;
}

export const useAddFloorDraft = create<{ draft: AddFloorDraft | null }>()(() => ({ draft: null }));

export function returnToAddFloor(
  request: Omit<PlaceRoomRequest, "placement">,
  error: string,
): void {
  useAddFloorDraft.setState({
    draft: {
      name: request.name,
      ...(request.paletteId ? { paletteId: request.paletteId } : {}),
      repos: request.repos.map((r) => r.repo),
      error,
    },
  });
  useUiStore.getState().openOverlay(ADD_FLOOR_OVERLAY);
}

/** Take the draft (once): the dialog's next form starts from it. */
export function takeAddFloorDraft(): AddFloorDraft | null {
  const draft = useAddFloorDraft.getState().draft;
  if (draft) useAddFloorDraft.setState({ draft: null });
  return draft;
}
