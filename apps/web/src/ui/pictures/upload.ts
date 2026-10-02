/**
 * Getting a picture from the human's PC to the office (#46): the browser
 * decodes the file (applying its EXIF orientation), scales it to at most
 * `clientMaxSidePx` on its longest side and re-encodes it through a canvas
 * (WebP, else PNG), which keeps only the pixels: no EXIF, GPS or editing
 * history leaves the PC. The server still checks the bytes and drops any
 * metadata itself. Then it is posted to the operation's picture endpoint.
 */
import {
  WALL_PICTURE_LIMITS,
  WALL_PICTURE_MIME,
  WallPictureUpload,
  type WallPictureUploadError,
  wallPicturesApiPath,
} from "@regulus/protocol";

export const UPLOAD_ERROR_TEXT: Readonly<Record<WallPictureUploadError | "failed", string>> = {
  not_image: "That file is not a PNG, JPEG or WebP picture.",
  too_large: "Pictures can be at most 10 MB.",
  too_many_pixels: "That picture has too many pixels.",
  too_many_pending: "Hang or cancel your other pictures first.",
  room_full: "This room has as many pictures as it takes.",
  failed: "The upload failed. Try again.",
};

export class PictureUploadError extends Error {
  constructor(readonly code: WallPictureUploadError | "failed") {
    super(UPLOAD_ERROR_TEXT[code]);
  }
}

const ACCEPTED = new Set<string>(Object.values(WALL_PICTURE_MIME));

/** Refuse what the server would refuse anyway, before reading the file. */
export function precheck(file: Pick<File, "type" | "size">): WallPictureUploadError | null {
  if (!ACCEPTED.has(file.type)) return "not_image";
  if (file.size > WALL_PICTURE_LIMITS.uploadMaxBytes) return "too_large";
  return null;
}

/** The size an `w × h` image is scaled to (never up). */
export function fitSize(w: number, h: number, max = WALL_PICTURE_LIMITS.clientMaxSidePx) {
  const s = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** The file re-encoded through a canvas, metadata-free; the original when the browser cannot. */
export async function reencode(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PictureUploadError("not_image");
  }
  try {
    const size = fitSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const encode = (type: string, quality?: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    // Browsers without a WebP encoder hand back a PNG for "image/webp".
    const out = (await encode("image/webp", 0.9)) ?? (await encode("image/png"));
    return out && out.size <= WALL_PICTURE_LIMITS.uploadMaxBytes ? out : file;
  } finally {
    bitmap.close();
  }
}

/** Post the picture; the server's answer, or a {@link PictureUploadError}. */
export async function uploadPicture(
  operationId: string,
  file: Blob,
  fetchFn: typeof fetch = fetch,
): Promise<WallPictureUpload> {
  const form = new FormData();
  form.set("file", file, "picture");
  let res: Response;
  try {
    res = await fetchFn(wallPicturesApiPath(operationId), {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
  } catch {
    throw new PictureUploadError("failed");
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) return WallPictureUpload.parse(body);
  const error = (body as { error?: string } | null)?.error;
  throw new PictureUploadError(
    error && error in UPLOAD_ERROR_TEXT ? (error as WallPictureUploadError) : "failed",
  );
}
