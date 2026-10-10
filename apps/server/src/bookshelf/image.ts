/**
 * What kind of picture a repo file is, from its own bytes (#264): only
 * raster formats a browser draws without running anything. SVG is not one
 * of them (it is a document that can carry script and fetch things), so a
 * repo's SVG is not served.
 */
import { sniffKind } from "../pictures/image.ts";

export type DocImageKind = "png" | "jpeg" | "webp" | "gif";

export const DOC_IMAGE_MIME: Readonly<Record<DocImageKind, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function sniffDocImage(bytes: Uint8Array): DocImageKind | null {
  const kind = sniffKind(bytes);
  if (kind) return kind;
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  return head === "GIF87a" || head === "GIF89a" ? "gif" : null;
}
