/**
 * Wall pictures (SPEC §5 `decor`, §6 `decor.place|move|remove`, §9.4, §11; #46).
 *
 * A picture is uploaded from the human's PC over REST (multipart `file`,
 * PNG/JPEG/WebP up to {@link WALL_PICTURE_LIMITS.uploadMaxBytes}, checked by
 * magic bytes), which returns an `uploadId`; `decor.place` then hangs it on
 * a full wall of the operation's room. Decor rows are keyed by wall: `wallId`
 * is the room layout's wall id, `x` the distance along that wall from its
 * `from` end to the picture's centre, `y` the centre's height above the
 * floor, `w`/`h` its size, all in metres. The geometry checks (on a full
 * wall, clear of boards, screens, doors and other pictures) live in
 * `@regulus/room-layout` (`checkPicturePlacement`), shared by server and web.
 *
 * Who may do what (D12, SPEC §8, §11): hanging needs `spawn` or `manage`
 * access to the operation (the people who put work into the room; `view`
 * access and office viewers only look). Moving, resizing and removing a
 * picture is for whoever hung it (while they still have `spawn`) and for
 * the operation's managers, which includes office owners and admins.
 * Everyone with access sees every picture. Only project rooms take
 * pictures: the lobby and the break room have no OperationRoom and no
 * per-room access to decide who may decorate them.
 */
import { z } from "zod";
import type { OperationAccess } from "./enums.ts";

export const WALL_PICTURE_LIMITS = {
  /** Largest image file accepted (SPEC §9.4). */
  uploadMaxBytes: 10 * 1024 * 1024,
  /** Longest image side the server accepts, pixels. */
  maxSidePx: 8192,
  /** Most pixels the server accepts (a decompression bomb guard for every viewer's GPU). */
  maxPixels: 40_000_000,
  /** The browser downscales to this longest side before uploading. */
  clientMaxSidePx: 2048,
  /** Smallest and largest picture side on the wall, metres. */
  minSize: 0.3,
  maxSize: 2,
  /** Longest side of a freshly placed picture, metres. */
  defaultSize: 0.9,
  /** Pictures per operation room. */
  perOperation: 40,
  /** Uploads waiting to be hung, per human; they expire after `pendingTtlMs`. */
  pendingPerUser: 5,
  pendingTtlMs: 30 * 60_000,
} as const;

export const WALL_PICTURE_KINDS = ["png", "jpeg", "webp"] as const;
export type WallPictureKind = (typeof WALL_PICTURE_KINDS)[number];

export const WALL_PICTURE_MIME: Readonly<Record<WallPictureKind, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** What a file input offers. */
export const WALL_PICTURE_ACCEPT = "image/png,image/jpeg,image/webp";

export const WALL_PICTURE_UPLOAD_ERRORS = [
  "not_image",
  "too_large",
  "too_many_pixels",
  "too_many_pending",
  "room_full",
] as const;
export type WallPictureUploadError = (typeof WALL_PICTURE_UPLOAD_ERRORS)[number];

/** `POST` (multipart `file`): upload a picture to hang in this operation's room. */
export function wallPicturesApiPath(operationId: string): string {
  return `/api/operations/${encodeURIComponent(operationId)}/pictures`;
}

/** `GET`: a hung picture's image (view access). Never changes, so it caches forever. */
export function wallPictureImagePath(operationId: string, decorId: string): string {
  return `${wallPicturesApiPath(operationId)}/${encodeURIComponent(decorId)}`;
}

export const WallPictureUpload = z.object({
  uploadId: z.string().min(1).max(64),
  kind: z.enum(WALL_PICTURE_KINDS),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
});
export type WallPictureUpload = z.infer<typeof WallPictureUpload>;

/** Hang a picture: spawn or manage access. */
export function mayPlacePicture(access: OperationAccess | null | undefined): boolean {
  return access === "spawn" || access === "manage";
}

/** Move, resize or remove a picture: its placer (still able to place), or a manager. */
export function mayEditPicture(
  access: OperationAccess | null | undefined,
  userId: string,
  placedBy: string,
): boolean {
  if (access === "manage") return true;
  return mayPlacePicture(access) && placedBy !== "" && placedBy === userId;
}

/** A `w × h` size with the given aspect (w / h), clamped to the wall picture limits. */
export function clampPictureSize(w: number, h: number): { w: number; h: number } {
  const { minSize, maxSize } = WALL_PICTURE_LIMITS;
  if (!(w > 0) || !(h > 0)) return { w: minSize, h: minSize };
  const aspect = w / h;
  let scale = 1;
  const longest = Math.max(w, h);
  const shortest = Math.min(w, h);
  if (longest > maxSize) scale = maxSize / longest;
  if (shortest * scale < minSize) scale = minSize / shortest;
  const out = { w: w * scale, h: h * scale };
  // An extreme aspect cannot meet both bounds: the long side wins, the short one is floored.
  if (Math.max(out.w, out.h) > maxSize + 1e-9) {
    return aspect >= 1
      ? { w: maxSize, h: Math.max(minSize, maxSize / aspect) }
      : { w: Math.max(minSize, maxSize * aspect), h: maxSize };
  }
  return out;
}

/** The size a picture of `widthPx × heightPx` gets when first placed. */
export function defaultPictureSize(widthPx: number, heightPx: number): { w: number; h: number } {
  const longest = Math.max(widthPx, heightPx, 1);
  const s = WALL_PICTURE_LIMITS.defaultSize / longest;
  return clampPictureSize(Math.max(1, widthPx) * s, Math.max(1, heightPx) * s);
}
