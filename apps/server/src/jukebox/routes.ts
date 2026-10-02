/**
 * REST for the jukebox library (#47), signed-in humans only:
 *
 *   GET  /api/jukebox/tracks             the library (bundled, uploads, YouTube)
 *   POST /api/jukebox/tracks             upload an audio file (multipart: file, title,
 *                                        artist, durationMs); not for viewers
 *   POST /api/jukebox/youtube            add a YouTube video by link; not for viewers
 *   GET  /api/jukebox/tracks/:id/audio   a file track's audio, with Range support
 *
 * Writes need a same-origin request. Uploads are checked by size and magic
 * bytes (upload.ts) and stored under the data dir; YouTube links keep only
 * the video id and nothing remote is ever fetched or proxied (SPEC §11).
 */
import {
  AddYouTubeTrack,
  JUKEBOX_LIMITS,
  JUKEBOX_TRACKS_API_PATH,
  JUKEBOX_YOUTUBE_API_PATH,
  type JukeboxUploadError,
  mayUseJukebox,
  parseYouTubeId,
} from "@regulus/protocol";
import type { OfficeAuth, SessionUser } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import { readBody } from "../operations/routes.ts";
import { mimeForFile } from "./audio-sniff.ts";
import type { JukeboxLibrary } from "./library.ts";
import { bodyTooLarge, checkUpload, readCappedForm, storeUpload } from "./upload.ts";

export interface JukeboxRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  library: JukeboxLibrary;
  logger: Logger;
}

const refuse = (error: JukeboxUploadError, status = 400) => json({ error }, { status });

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` against a file of `size` bytes; null when unsatisfiable. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

async function serveAudio(request: Request, path: string): Promise<Response> {
  const file = Bun.file(path);
  if (!(await file.exists())) return json({ error: "not_found" }, { status: 404 });
  const size = file.size;
  const headers = {
    "content-type": mimeForFile(path),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
  };
  const range = request.headers.get("range");
  if (!range)
    return new Response(file, { headers: { ...headers, "content-length": String(size) } });
  const r = parseRange(range, size);
  if (!r)
    return new Response(null, {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${size}` },
    });
  return new Response(file.slice(r.start, r.end + 1), {
    status: 206,
    headers: {
      ...headers,
      "content-range": `bytes ${r.start}-${r.end}/${size}`,
      "content-length": String(r.end - r.start + 1),
    },
  });
}

export function mountJukeboxRoutes(router: Router, deps: JukeboxRoutesDeps): void {
  const { auth, library, logger } = deps;

  const handle =
    (fn: (ctx: RouteContext, user: SessionUser) => Promise<Response> | Response, write = false) =>
    async (ctx: RouteContext) => {
      try {
        if (write) {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw forbidden("origin_mismatch");
        }
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        if (write && !mayUseJukebox(user.role)) throw forbidden("viewers_cannot_add_tracks");
        return await fn(ctx, user);
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };

  router.get(
    JUKEBOX_TRACKS_API_PATH,
    handle(() => json({ tracks: library.list() })),
  );

  router.post(
    JUKEBOX_TRACKS_API_PATH,
    handle(async (ctx, user) => {
      if (bodyTooLarge(ctx.request.headers.get("content-length"))) return refuse("too_large", 413);
      if (library.uploadsBy(user.id) >= JUKEBOX_LIMITS.uploadsPerUser)
        return refuse("too_many_uploads", 409);
      let form: FormData | null;
      try {
        // Capped while reading: a chunked body has no length to check up front.
        form = await readCappedForm(ctx.request);
      } catch {
        return refuse("not_audio");
      }
      if (!form) return refuse("too_large", 413);
      const check = await checkUpload(form);
      if (!check.ok) return refuse(check.error, check.error === "too_large" ? 413 : 400);
      const ref = await storeUpload(library.dataDir, check.upload);
      const track = library.add({
        title: check.upload.title,
        artist: check.upload.artist,
        source: "file",
        ref,
        durationMs: check.upload.durationMs,
        addedBy: user.id,
      });
      logger.info(
        { trackId: track.id, userId: user.id, bytes: check.upload.file.size },
        "jukebox upload",
      );
      return json(track, { status: 201 });
    }, true),
  );

  router.post(
    JUKEBOX_YOUTUBE_API_PATH,
    handle(async (ctx, user) => {
      const body = await readBody(ctx.request, AddYouTubeTrack);
      const videoId = parseYouTubeId(body.url);
      if (!videoId) return refuse("not_youtube");
      const known = library.list().find((t) => t.source === "youtube" && t.videoId === videoId);
      if (known) return json(known);
      const track = library.add({
        title: body.title || `YouTube video ${videoId}`,
        artist: "YouTube",
        source: "youtube",
        ref: videoId,
        durationMs: 0,
        addedBy: user.id,
      });
      return json(track, { status: 201 });
    }, true),
  );

  router.get(
    `${JUKEBOX_TRACKS_API_PATH}/:id/audio`,
    handle((ctx) => {
      const path = library.audioPath(ctx.params.id ?? "");
      if (!path) return json({ error: "not_found" }, { status: 404 });
      return serveAudio(ctx.request, path);
    }),
  );
}
