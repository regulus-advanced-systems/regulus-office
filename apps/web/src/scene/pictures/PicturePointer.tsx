/**
 * The pointer while hanging or moving a picture (#46). Placing: the ghost
 * follows the wall point under the cursor, a left click hangs it there when
 * it fits, and no click walks the player meanwhile. Dragging a selected
 * picture (its face to move it, a corner to resize it): the draft follows
 * the cursor until the button is let go, then `decor.move` is sent if it
 * fits, else it snaps back. Both read the same verdict the server gives.
 */
import { useThree } from "@react-three/fiber";
import type { RoomTemplate } from "@regulus/room-layout";
import { useCallback, useEffect } from "react";
import { Raycaster, Vector2 } from "three";
import { getOfficeClient } from "../../net/index.ts";
import { type SendCommand, usePicturesStore } from "../../ui/pictures/picturesStore.ts";
import type { RoomScope } from "../roomScope.ts";
import {
  draftVerdict,
  ghostAt,
  type PictureDraft,
  resizeToward,
  type WallHit,
  wallHit,
} from "./pictureGeometry.ts";

const send: SendCommand = (type, payload) => getOfficeClient().send(type, payload);

/** Screen point → the picture wall under it, in the room's frame. */
export function useWallRay(template: RoomTemplate, scope: RoomScope) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  return useCallback(
    (clientX: number, clientY: number): WallHit | null => {
      const r = gl.domElement.getBoundingClientRect();
      const ndc = new Vector2(
        ((clientX - r.left) / r.width) * 2 - 1,
        -((clientY - r.top) / r.height) * 2 + 1,
      );
      const ray = new Raycaster();
      ray.setFromCamera(ndc, camera);
      const o = ray.ray.origin;
      const origin = { x: o.x - scope.origin.x, y: o.y, z: o.z - scope.origin.z };
      return wallHit(template, origin, ray.ray.direction);
    },
    [camera, gl, template, scope.origin.x, scope.origin.z],
  );
}

/** Swallow the click that ends a drag or hangs a picture, so the player does not walk. */
function swallowNextClick(el: HTMLElement) {
  const stop = (e: MouseEvent) => {
    if (e.target !== el) return;
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  // A drag released off the canvas sends no click: drop the listener soon after.
  setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 400);
}

/** While placing: the ghost follows the cursor; a click hangs it. */
export function PlacingPointer({ template, scope }: { template: RoomTemplate; scope: RoomScope }) {
  const gl = useThree((s) => s.gl);
  const hitAt = useWallRay(template, scope);
  useEffect(() => {
    const el = gl.domElement;
    const draftAt = (e: MouseEvent) => {
      const s = usePicturesStore.getState();
      if (s.mode.kind !== "placing") return;
      const hit = hitAt(e.clientX, e.clientY);
      const draft = hit ? ghostAt(template, hit, s.mode.size) : null;
      const decor = scope.store.getState().state?.decor;
      s.setDraft(draft, draft ? draftVerdict(template, decor, draft) : null);
    };
    const onClick = (e: MouseEvent) => {
      if (e.target !== el || e.button !== 0) return;
      if (usePicturesStore.getState().mode.kind !== "placing") return;
      e.stopPropagation();
      e.preventDefault();
      draftAt(e);
      usePicturesStore.getState().place(send);
    };
    el.addEventListener("pointermove", draftAt);
    window.addEventListener("click", onClick, { capture: true });
    return () => {
      el.removeEventListener("pointermove", draftAt);
      window.removeEventListener("click", onClick, { capture: true });
    };
  }, [gl, hitAt, template, scope]);
  return null;
}

export type DragKind = "move" | "resize";

/**
 * Start dragging the selected picture from a pointer-down at (clientX,
 * clientY): `move` keeps the grab offset, `resize` scales about the centre.
 */
export function useDragPicture(template: RoomTemplate, scope: RoomScope) {
  const gl = useThree((s) => s.gl);
  const hitAt = useWallRay(template, scope);
  return useCallback(
    (kind: DragKind, start: PictureDraft, decorId: string, clientX: number, clientY: number) => {
      const first = hitAt(clientX, clientY);
      const grab =
        first && first.wallId === start.wallId
          ? { dx: start.x - first.x, dy: start.y - first.y }
          : { dx: 0, dy: 0 };
      const store = usePicturesStore.getState();
      store.setDragging(true);
      const onMove = (e: PointerEvent) => {
        const hit = hitAt(e.clientX, e.clientY);
        if (!hit) return;
        let draft: PictureDraft | null;
        if (kind === "move") {
          draft = ghostAt(
            template,
            { wallId: hit.wallId, x: hit.x + grab.dx, y: hit.y + grab.dy },
            start,
          );
        } else {
          if (hit.wallId !== start.wallId) return;
          draft = { ...start, ...resizeToward(start, hit) };
        }
        if (!draft) return;
        const decor = scope.store.getState().state?.decor;
        usePicturesStore.getState().setDraft(draft, draftVerdict(template, decor, draft, decorId));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        swallowNextClick(gl.domElement);
        usePicturesStore.getState().commitMove(send);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [gl, hitAt, template, scope],
  );
}
