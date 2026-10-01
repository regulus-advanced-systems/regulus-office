/**
 * The jukebox library over REST (#47): list, upload a file (the browser
 * measures its length first; the office has no decoder) and add a YouTube
 * link. Errors come back as sentences for the panel.
 */
import {
  JUKEBOX_LIMITS,
  JUKEBOX_TRACKS_API_PATH,
  JUKEBOX_YOUTUBE_API_PATH,
  type JukeboxTrack,
} from "@regulus/protocol";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

const UNREACHABLE = "Could not reach the office. Try again in a moment.";
const MB = Math.round(JUKEBOX_LIMITS.uploadMaxBytes / (1024 * 1024));

/** A sentence for a refusal (`error` codes of protocol `JUKEBOX_UPLOAD_ERRORS`). */
export function describeError(status: number, code: string | undefined): string {
  switch (code) {
    case "too_large":
      return `That file is too big: the jukebox takes up to ${MB} MB.`;
    case "not_audio":
      return "That is not an audio file the jukebox can play (MP3, Ogg, FLAC, WAV, M4A or WebM).";
    case "bad_duration":
      return "The track's length could not be read, or it is longer than 30 minutes.";
    case "bad_title":
      return "Give the track a title.";
    case "too_many_uploads":
      return `You have uploaded ${JUKEBOX_LIMITS.uploadsPerUser} tracks already.`;
    case "not_youtube":
      return "That is not a YouTube video link.";
    case "viewers_cannot_add_tracks":
      return "Viewers can listen, but not add music.";
  }
  if (status === 401) return "Your session ended. Sign in again.";
  return `The office refused (${status}). Try again.`;
}

async function call<T>(
  path: string,
  init: RequestInit,
  fetchFn: typeof fetch,
): Promise<ApiResult<T>> {
  try {
    const res = await fetchFn(path, { credentials: "same-origin", ...init });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: describeError(res.status, body.error) };
    return { ok: true, value: body };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function listTracks(
  fetchFn: typeof fetch = fetch,
): Promise<ApiResult<JukeboxTrack[]>> {
  const res = await call<{ tracks: JukeboxTrack[] }>(
    JUKEBOX_TRACKS_API_PATH,
    { headers: { accept: "application/json" } },
    fetchFn,
  );
  return res.ok ? { ok: true, value: res.value.tracks } : res;
}

/** The length of an audio file, ms, read by the browser; null when it cannot play it. */
export function measureDuration(file: File, timeoutMs = 15_000): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    let done = false;
    const finish = (ms: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    el.preload = "metadata";
    el.addEventListener("loadedmetadata", () =>
      finish(Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : null),
    );
    el.addEventListener("error", () => finish(null));
    el.src = url;
  });
}

export async function uploadTrack(
  input: { file: File; title: string; artist: string; durationMs: number },
  fetchFn: typeof fetch = fetch,
): Promise<ApiResult<JukeboxTrack>> {
  if (input.file.size > JUKEBOX_LIMITS.uploadMaxBytes)
    return { ok: false, error: describeError(413, "too_large") };
  const form = new FormData();
  form.set("file", input.file, input.file.name);
  form.set("title", input.title);
  form.set("artist", input.artist);
  form.set("durationMs", String(input.durationMs));
  return call<JukeboxTrack>(JUKEBOX_TRACKS_API_PATH, { method: "POST", body: form }, fetchFn);
}

export async function addYouTube(
  input: { url: string; title?: string },
  fetchFn: typeof fetch = fetch,
): Promise<ApiResult<JukeboxTrack>> {
  return call<JukeboxTrack>(
    JUKEBOX_YOUTUBE_API_PATH,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
    },
    fetchFn,
  );
}
