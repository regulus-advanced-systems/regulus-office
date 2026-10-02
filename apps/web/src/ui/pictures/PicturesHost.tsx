/**
 * Wall pictures on the HUD (#46): "Hang a picture…" in the Rooms panel for
 * whoever may hang pictures in the room they are in (spawn or manage), and
 * the dock that guides placing and editing: what the ghost's verdict is,
 * the size, and Place / Remove / Cancel, with the keyboard (Enter, Delete,
 * Escape, + and -). Refusals from the server come back as toasts.
 */
import { type CommandRejected, mayPlacePicture, WALL_PICTURE_ACCEPT } from "@regulus/protocol";
import { PICTURE_PROBLEM_TEXT, wallById } from "@regulus/room-layout";
import { useEffect, useId, useRef } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { draftVerdict, stepSize } from "../../scene/pictures/pictureGeometry.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../Panel.tsx";
import { useRoomSettingsDock } from "../room-settings/RoomSettingsDock.tsx";
import { useMayEditPicture, useOperationAccess } from "./access.ts";
import { type SendCommand, usePicturesStore } from "./picturesStore.ts";
import { roomLayoutOf } from "./roomOf.ts";
import { PictureUploadError, precheck, reencode, uploadPicture } from "./upload.ts";
import "../build-mode/build-mode.css";

const send: SendCommand = (type, payload) => getOfficeClient().send(type, payload);

const toastError = (title: string, message: string) =>
  useUiStore.getState().toast({ kind: "error", title, message, durationMs: 6000 });

/** "Hang a picture…": pick a file, re-encode, upload, then place it in the scene. */
export function HangPictureButton({ operationId }: { operationId: string }) {
  const access = useOperationAccess(operationId);
  const busy = usePicturesStore((s) => s.mode.kind === "uploading");
  const input = useRef<HTMLInputElement>(null);
  if (!mayPlacePicture(access)) return null;
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const early = precheck(file);
    if (early) return toastError("Picture not uploaded", new PictureUploadError(early).message);
    const store = usePicturesStore.getState();
    useRoomSettingsDock.getState().close();
    store.uploading(operationId);
    try {
      const blob = await reencode(file);
      const upload = await uploadPicture(operationId, blob);
      if (usePicturesStore.getState().mode.kind !== "uploading") return;
      store.startPlacing(operationId, upload, URL.createObjectURL(blob));
    } catch (err) {
      store.cancel();
      const message = err instanceof PictureUploadError ? err.message : "The upload failed.";
      toastError("Picture not uploaded", message);
    }
  };
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        title="Upload a PNG, JPEG or WebP (up to 10 MB) and hang it on a wall of this room"
        onClick={() => input.current?.click()}
      >
        {busy ? "Uploading…" : "Hang a picture…"}
      </Button>
      <input
        ref={input}
        type="file"
        accept={WALL_PICTURE_ACCEPT}
        aria-label="Picture to hang"
        data-testid="picture-file"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** Resize the selected picture by one keyboard step, if it still fits. */
function stepSelected(dir: 1 | -1): void {
  const store = usePicturesStore.getState();
  const mode = store.mode;
  if (mode.kind === "placing") {
    store.setSize(stepSize(mode.size, dir));
    return;
  }
  if (mode.kind !== "editing") return;
  const decor = useOperationStore.getState().state?.decor;
  const current = decor?.[mode.decorId];
  const layout = roomLayoutOf(mode.operationId);
  if (!current || !layout || !wallById(layout, current.wallId)) return;
  const draft = { wallId: current.wallId, x: current.x, y: current.y, ...stepSize(current, dir) };
  store.setDraft(draft, draftVerdict(layout, decor, draft, mode.decorId));
  if (!store.commitMove(send))
    toastError("Picture not resized", "It does not fit there at that size.");
}

function usePictureKeys(active: boolean, mayRemove: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const store = usePicturesStore.getState();
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "Escape") {
        handled();
        store.cancel();
      } else if (e.key === "Enter" && store.mode.kind === "placing") {
        handled();
        store.place(send);
      } else if ((e.key === "Delete" || e.key === "Backspace") && mayRemove) {
        handled();
        store.remove(send);
      } else if (e.key === "+" || e.key === "=") {
        handled();
        stepSelected(1);
      } else if (e.key === "-" || e.key === "_") {
        handled();
        stepSelected(-1);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [active, mayRemove]);
}

/** Server refusals of our decor commands: a toast, and a dragged draft snaps back. */
function useDecorRejections() {
  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = getOfficeClient().onRejected((notice: CommandRejected) => {
        if (!notice.type.startsWith("decor.")) return;
        usePicturesStore.getState().setDraft(null, null);
        toastError("Picture not changed", notice.reason);
      });
    } catch {
      // No office client (tests, harnesses): nothing to listen to.
    }
    return () => off?.();
  }, []);
}

export function PictureDock() {
  useDecorRejections();
  const mode = usePicturesStore((s) => s.mode);
  const operationId = useOperationStore((s) => s.operationId);
  const placedBy = useOperationStore((s) =>
    mode.kind === "editing" ? (s.state?.decor[mode.decorId]?.placedBy ?? "") : "",
  );
  const exists = useOperationStore((s) =>
    mode.kind === "editing" ? s.state?.decor[mode.decorId] !== undefined : true,
  );
  const mayEdit = useMayEditPicture(operationId, placedBy);
  const noWorld = useCompoundStore((s) => s.world === null);
  const title = useId();
  const active = mode.kind === "placing" || mode.kind === "editing";
  usePictureKeys(active, mode.kind === "editing" && mayEdit);
  // Leaving the room, or the picture going away, ends placing or editing.
  useEffect(() => {
    if (mode.kind === "idle") return;
    if (operationId !== mode.operationId || !exists) usePicturesStore.getState().cancel();
  }, [mode, operationId, exists]);
  if (!active || noWorld) return null;
  const verdict = mode.verdict;
  const status = !mode.draft
    ? mode.kind === "placing"
      ? "Point at a wall of the room."
      : "Drag the picture to move it, a corner to resize it."
    : verdict?.ok
      ? mode.kind === "placing"
        ? "Clear to hang."
        : "It fits there."
      : verdict
        ? PICTURE_PROBLEM_TEXT[verdict.problem]
        : "";
  const size = mode.kind === "placing" ? mode.size : mode.draft;
  const store = usePicturesStore.getState();
  return (
    <div role="dialog" aria-modal="false" aria-labelledby={title} className="rg-dock">
      <Panel
        title={<span id={title}>{mode.kind === "placing" ? "Hang a picture" : "Picture"}</span>}
      >
        <div
          className="rg-muted"
          data-testid="picture-status"
          role="status"
          style={{ fontSize: 12 }}
        >
          {status}
        </div>
        {size && (
          <div className="rg-muted" style={{ fontSize: 12, marginTop: 4 }}>
            {size.w.toFixed(2)} × {size.h.toFixed(2)} m · + and - resize
          </div>
        )}
        <div className="rg-dock__actions">
          {mode.kind === "placing" && (
            <Button
              variant="primary"
              size="sm"
              disabled={!verdict?.ok}
              onClick={() => store.place(send)}
            >
              Hang here (Enter)
            </Button>
          )}
          {mode.kind === "editing" && mayEdit && (
            <Button variant="secondary" size="sm" onClick={() => store.remove(send)}>
              Remove (Del)
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => store.cancel()}>
            {mode.kind === "placing" ? "Cancel (Esc)" : "Done (Esc)"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
