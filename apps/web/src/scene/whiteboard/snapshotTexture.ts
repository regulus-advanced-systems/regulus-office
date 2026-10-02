/**
 * The wall picture of a whiteboard (#45, research 01 §7 "posters are
 * textures"): the board's last snapshot PNG (uploaded by whoever drew last,
 * at most every 2 s) painted into a canvas texture with the board's aspect,
 * fitted inside a margin on the board's white face. Version 0 (never drawn
 * on) has no texture: the look shows its plain face. It is reloaded only when the
 * version in the room state changes.
 */
import { whiteboardSnapshotPath } from "@regulus/protocol";
import { useEffect, useState } from "react";
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import { WHITEBOARD_FACE } from "./WhiteboardLook.tsx";

/** Texture width in pixels; the height follows the board's aspect. */
export const SNAPSHOT_TEXTURE_WIDTH = 1024;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where an `iw × ih` image goes inside a `W × H` canvas, fitted inside `margin` px, centred. */
export function containRect(iw: number, ih: number, W: number, H: number, margin = 0): Rect {
  const aw = Math.max(1, W - 2 * margin);
  const ah = Math.max(1, H - 2 * margin);
  if (iw <= 0 || ih <= 0) return { x: margin, y: margin, w: 0, h: 0 };
  const scale = Math.min(aw / iw, ah / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

export type SnapshotCanvas = Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect" | "drawImage">;

/** Paint the face: white, with the snapshot fitted in. */
export function paintSnapshot(
  ctx: SnapshotCanvas,
  W: number,
  H: number,
  image: CanvasImageSource & { width: number; height: number },
): void {
  ctx.fillStyle = WHITEBOARD_FACE;
  ctx.fillRect(0, 0, W, H);
  const r = containRect(image.width, image.height, W, H, Math.round(W * 0.02));
  ctx.drawImage(image, r.x, r.y, r.w, r.h);
}

/** Load the snapshot PNG of `boardId` at `version` (the session cookie rides along). */
export async function loadSnapshot(
  boardId: string,
  version: number,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> {
  const res = await fetch(whiteboardSnapshotPath(boardId, version), {
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) return null;
  return createImageBitmap(await res.blob());
}

/**
 * A canvas texture showing `boardId`'s snapshot at `version`, `w × h` metres;
 * null while the board has no snapshot (the look shows its plain face), so a
 * board nobody drew on costs no texture at all.
 */
export function useSnapshotTexture(
  boardId: string,
  version: number,
  w: number,
  h: number,
): CanvasTexture | null {
  const [texture, setTexture] = useState<CanvasTexture | null>(null);
  // A new board or size starts over (the old texture is disposed below).
  useEffect(() => () => setTexture(null), [boardId, w, h]);
  useEffect(() => () => texture?.dispose(), [texture]);
  useEffect(() => {
    if (version <= 0) return;
    const abort = new AbortController();
    loadSnapshot(boardId, version, abort.signal)
      .then((image) => {
        if (!image) return;
        if (abort.signal.aborted) return image.close();
        setTexture((current) => {
          const next = current ?? createSnapshotTexture(boardId, w, h);
          const canvas = next.image as HTMLCanvasElement;
          const ctx = canvas.getContext("2d");
          if (ctx) paintSnapshot(ctx, canvas.width, canvas.height, image);
          next.userData.version = version;
          next.needsUpdate = true;
          return next;
        });
      })
      // A snapshot that fails to load keeps whatever the board showed before.
      .catch(() => {});
    return () => abort.abort();
  }, [boardId, version, w, h]);
  return version > 0 ? texture : null;
}

function createSnapshotTexture(boardId: string, w: number, h: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SNAPSHOT_TEXTURE_WIDTH;
  canvas.height = Math.max(1, Math.round((SNAPSHOT_TEXTURE_WIDTH * h) / Math.max(w, 0.01)));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.name = `whiteboard:${boardId}`;
  return texture;
}
