/**
 * The wall picture of a whiteboard (#45, research 01 §7 "posters are
 * textures"): the board's last snapshot PNG (uploaded by whoever drew last,
 * at most every 2 s) painted into a canvas texture with the board's aspect,
 * fitted inside a margin on the board's white face. Version 0 (never drawn
 * on) paints a blank face with a hint. The texture is reloaded only when the
 * version in the room state changes.
 */
import { whiteboardSnapshotPath } from "@regulus/protocol";
import { useEffect, useMemo } from "react";
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

export type SnapshotCanvas = Pick<
  CanvasRenderingContext2D,
  "fillStyle" | "fillRect" | "drawImage" | "font" | "textAlign" | "textBaseline" | "fillText"
>;

/** Paint the face: the snapshot fitted in, or a blank board with a hint. */
export function paintSnapshot(
  ctx: SnapshotCanvas,
  W: number,
  H: number,
  image: (CanvasImageSource & { width: number; height: number }) | null,
): void {
  ctx.fillStyle = WHITEBOARD_FACE;
  ctx.fillRect(0, 0, W, H);
  if (image) {
    const r = containRect(image.width, image.height, W, H, Math.round(W * 0.02));
    ctx.drawImage(image, r.x, r.y, r.w, r.h);
    return;
  }
  ctx.fillStyle = "#A8ADB3";
  ctx.font = `${Math.round(H * 0.075)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Whiteboard: click or press E to draw", W / 2, H / 2);
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

/** A canvas texture showing `boardId`'s snapshot at `version`, `w × h` metres. */
export function useSnapshotTexture(
  boardId: string,
  version: number,
  w: number,
  h: number,
): CanvasTexture {
  const surface = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = SNAPSHOT_TEXTURE_WIDTH;
    canvas.height = Math.max(1, Math.round((SNAPSHOT_TEXTURE_WIDTH * h) / Math.max(w, 0.01)));
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.name = `whiteboard:${boardId}`;
    return { canvas, texture, ctx: canvas.getContext("2d") };
  }, [boardId, w, h]);
  useEffect(() => () => surface.texture.dispose(), [surface]);
  useEffect(() => {
    const { canvas, ctx, texture } = surface;
    if (!ctx) return;
    const paint = (image: ImageBitmap | null) => {
      paintSnapshot(ctx, canvas.width, canvas.height, image);
      texture.userData.version = image ? version : 0;
      texture.needsUpdate = true;
    };
    if (version <= 0) {
      paint(null);
      return;
    }
    const abort = new AbortController();
    loadSnapshot(boardId, version, abort.signal)
      .then((image) => {
        if (abort.signal.aborted) return image?.close();
        // A snapshot that fails to load keeps whatever the board showed before.
        if (image) {
          paint(image);
          image.close();
        } else if (texture.userData.version === undefined) paint(null);
      })
      .catch(() => {
        if (!abort.signal.aborted && texture.userData.version === undefined) paint(null);
      });
    return () => abort.abort();
  }, [surface, boardId, version]);
  return surface.texture;
}
