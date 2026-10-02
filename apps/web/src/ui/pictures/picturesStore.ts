/**
 * Wall pictures on the HUD side (#46): the picture being placed (uploaded,
 * its ghost following the pointer on the walls) and the picture selected
 * for moving, resizing or removing. The scene (scene/pictures) moves the
 * ghost and the draft; this store sends `decor.place|move|remove` and turns
 * refusals into toasts. The server decides; the ghost only shows what it
 * would say.
 */
import {
  type ClientCommandPayload,
  type ClientCommandType,
  defaultPictureSize,
  type WallPictureUpload,
} from "@regulus/protocol";
import type { PictureVerdict } from "@regulus/room-layout";
import { create } from "zustand";
import type { PictureDraft } from "../../scene/pictures/pictureGeometry.ts";

export type SendCommand = <T extends ClientCommandType>(
  type: T,
  payload: ClientCommandPayload<T>,
) => void;

export interface Placing {
  kind: "placing";
  operationId: string;
  upload: WallPictureUpload;
  /** Object URL of the local file, for the ghost's face. */
  previewUrl: string;
  size: { w: number; h: number };
  /** Where the ghost is, and the verdict there; null while the pointer is off the walls. */
  draft: PictureDraft | null;
  verdict: PictureVerdict | null;
}

export interface Editing {
  kind: "editing";
  operationId: string;
  decorId: string;
  /** The picture as dragged so far; null while it sits where the server has it. */
  draft: PictureDraft | null;
  verdict: PictureVerdict | null;
  dragging: boolean;
}

export type PictureMode =
  | { kind: "idle" }
  | { kind: "uploading"; operationId: string }
  | Placing
  | Editing;

export interface PicturesStore {
  mode: PictureMode;
  /** An upload started (the dock shows progress). */
  uploading(operationId: string): void;
  /** The upload is back: start placing it. */
  startPlacing(operationId: string, upload: WallPictureUpload, previewUrl: string): void;
  /** The ghost moved, or the selected picture was dragged. */
  setDraft(draft: PictureDraft | null, verdict: PictureVerdict | null): void;
  setSize(size: { w: number; h: number }): void;
  select(operationId: string, decorId: string): void;
  setDragging(dragging: boolean): void;
  /** Hang the ghost where it is; false when it may not hang there. */
  place(send: SendCommand): boolean;
  /** Send the dragged draft of the selected picture; false when there is none or it is refused. */
  commitMove(send: SendCommand): boolean;
  remove(send: SendCommand): void;
  /** Leave placing or editing (the upload stays pending on the server until it expires). */
  cancel(): void;
}

function release(mode: PictureMode): void {
  if (mode.kind === "placing") URL.revokeObjectURL(mode.previewUrl);
}

export const usePicturesStore = create<PicturesStore>()((set, get) => ({
  mode: { kind: "idle" },

  uploading: (operationId) => {
    release(get().mode);
    set({ mode: { kind: "uploading", operationId } });
  },

  startPlacing: (operationId, upload, previewUrl) => {
    release(get().mode);
    set({
      mode: {
        kind: "placing",
        operationId,
        upload,
        previewUrl,
        size: defaultPictureSize(upload.width, upload.height),
        draft: null,
        verdict: null,
      },
    });
  },

  setDraft: (draft, verdict) => {
    const mode = get().mode;
    if (mode.kind === "placing" || mode.kind === "editing")
      set({ mode: { ...mode, draft, verdict } });
  },

  setSize: (size) => {
    const mode = get().mode;
    if (mode.kind === "placing") set({ mode: { ...mode, size } });
  },

  select: (operationId, decorId) => {
    release(get().mode);
    set({
      mode: { kind: "editing", operationId, decorId, draft: null, verdict: null, dragging: false },
    });
  },

  setDragging: (dragging) => {
    const mode = get().mode;
    if (mode.kind === "editing") set({ mode: { ...mode, dragging } });
  },

  place: (send) => {
    const mode = get().mode;
    if (mode.kind !== "placing" || !mode.draft || !mode.verdict?.ok) return false;
    const { wallId, x, y, w, h } = mode.draft;
    send("decor.place", { kind: "picture", uploadId: mode.upload.uploadId, wallId, x, y, w, h });
    release(mode);
    set({ mode: { kind: "idle" } });
    return true;
  },

  commitMove: (send) => {
    const mode = get().mode;
    if (mode.kind !== "editing") return false;
    if (!mode.draft) {
      if (mode.dragging) set({ mode: { ...mode, dragging: false } });
      return false;
    }
    const ok = mode.verdict?.ok === true;
    if (ok) {
      const { wallId, x, y, w, h } = mode.draft;
      send("decor.move", { decorId: mode.decorId, wallId, x, y, w, h });
    }
    // A refused drag snaps back; an accepted one shows the draft until the state catches up.
    set({ mode: { ...mode, draft: ok ? mode.draft : null, verdict: null, dragging: false } });
    return ok;
  },

  remove: (send) => {
    const mode = get().mode;
    if (mode.kind !== "editing") return;
    send("decor.remove", { decorId: mode.decorId });
    set({ mode: { kind: "idle" } });
  },

  cancel: () => {
    release(get().mode);
    set({ mode: { kind: "idle" } });
  },
}));
