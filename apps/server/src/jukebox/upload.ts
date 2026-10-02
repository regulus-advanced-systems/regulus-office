/**
 * Checking and storing an audio upload (#47, SPEC §11): the size first (the
 * request's length before it is read, then the file's), the format by its
 * magic bytes, the title and the length the uploader's browser measured
 * (it decodes the file before sending it; the office cannot without a
 * decoder). Stored as `<dataDir>/jukebox/<uuid>.<ext>`, never under a name
 * the client chose.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { JUKEBOX_LIMITS, type JukeboxUploadError } from "@regulus/protocol";
import { type AudioKind, SNIFF_BYTES, sniffAudio } from "./audio-sniff.ts";
import { UPLOAD_DIR } from "./library.ts";

/** Room for the multipart boundaries and the text fields around the file. */
export const MULTIPART_SLACK_BYTES = 64 * 1024;

export interface CheckedUpload {
  file: Blob;
  kind: AudioKind;
  title: string;
  artist: string;
  durationMs: number;
}

export type UploadCheck =
  | { ok: true; upload: CheckedUpload }
  | { ok: false; error: JukeboxUploadError };

/** Most bytes an upload request may carry: the file plus its multipart framing. */
export const UPLOAD_BODY_MAX_BYTES = JUKEBOX_LIMITS.uploadMaxBytes + MULTIPART_SLACK_BYTES;

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

/** A title from a file name: no extension, separators as spaces. */
export function titleFromName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return stem.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

export async function checkUpload(form: FormData): Promise<UploadCheck> {
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: "not_audio" };
  if (file.size > JUKEBOX_LIMITS.uploadMaxBytes) return { ok: false, error: "too_large" };
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const kind = sniffAudio(head);
  if (!kind) return { ok: false, error: "not_audio" };
  const name = file instanceof File ? file.name : "";
  const title = (text(form.get("title")) || titleFromName(name)).slice(0, JUKEBOX_LIMITS.titleMax);
  if (!title) return { ok: false, error: "bad_title" };
  const artist = text(form.get("artist")).slice(0, JUKEBOX_LIMITS.titleMax);
  const durationMs = Math.round(Number(text(form.get("durationMs"))));
  if (
    !Number.isFinite(durationMs) ||
    durationMs < JUKEBOX_LIMITS.minDurationMs ||
    durationMs > JUKEBOX_LIMITS.maxFileDurationMs
  )
    return { ok: false, error: "bad_duration" };
  return { ok: true, upload: { file, kind, title, artist, durationMs } };
}

/** Write the file under the data dir; returns its `ref` (relative to the data dir). */
export async function storeUpload(dataDir: string, upload: CheckedUpload): Promise<string> {
  const dir = join(dataDir, UPLOAD_DIR);
  await mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${upload.kind.ext}`;
  await Bun.write(join(dir, name), upload.file);
  return `${UPLOAD_DIR}/${name}`;
}
