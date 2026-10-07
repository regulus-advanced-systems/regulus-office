/**
 * Back to the Add operation dialog (#187): when the server refuses a new room
 * for something build mode cannot fix (a bad repo, a missing token), the
 * dialog reopens with the name, room style and repos as typed and the reason.
 * Tokens are never carried back: they are typed again.
 */
import type { DecorStyle, PlaceRoomRequest } from "@regulus/protocol";
import { create } from "zustand";
import { useUiStore } from "../../state/ui.ts";

export const ADD_OPERATION_OVERLAY = "add-operation";

export interface AddOperationDraft {
  name: string;
  decorStyle?: DecorStyle;
  repos: string[];
  error: string;
}

export const useAddOperationDraft = create<{ draft: AddOperationDraft | null }>()(() => ({
  draft: null,
}));

export function returnToAddOperation(
  request: Omit<PlaceRoomRequest, "placement">,
  error: string,
): void {
  useAddOperationDraft.setState({
    draft: {
      name: request.name,
      ...(request.decorStyle ? { decorStyle: request.decorStyle } : {}),
      repos: request.repos.map((r) => r.repo),
      error,
    },
  });
  useUiStore.getState().openOverlay(ADD_OPERATION_OVERLAY);
}

/** Take the draft (once): the dialog's next form starts from it. */
export function takeAddOperationDraft(): AddOperationDraft | null {
  const draft = useAddOperationDraft.getState().draft;
  if (draft) useAddOperationDraft.setState({ draft: null });
  return draft;
}
