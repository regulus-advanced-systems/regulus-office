/** The jukebox library over a real server with sessions (#47): listing, upload validation, YouTube links, audio with Range. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_AUDIO_DIR } from "@regulus/assets";
import {
  JUKEBOX_LIMITS,
  JUKEBOX_TRACKS_API_PATH,
  JUKEBOX_YOUTUBE_API_PATH,
  type JukeboxTrack,
  jukeboxAudioPath,
} from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { createLogger } from "../logging.ts";
import { parseRange } from "./routes.ts";
import { createJukebox, type Jukebox } from "./setup.ts";
import { readCappedForm } from "./upload.ts";

let office: Office;
let jukebox: Jukebox;
let dataDir: string;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let viewer: { id: string; cookie: string };
let mp3: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "office-jukebox-"));
  office = startOffice();
  jukebox = createJukebox({ db: office.db, dataDir, logger: createLogger({ level: "silent" }) });
  jukebox.mount(office.server.router, office.auth);
  owner = await office.signUp("Olga");
  member = await office.signUp("Mia");
  viewer = await office.signUp("Vic");
  office.db.$client.run(`update user_profiles set role = 'viewer' where user_id = '${viewer.id}'`);
  const file = Bun.file(join(fileURLToPath(BUNDLED_AUDIO_DIR), "deadly-roulette.mp3"));
  mp3 = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
});

afterAll(async () => {
  await office.stop();
  await rm(dataDir, { recursive: true, force: true });
});

const url = (path: string) => new URL(path, office.server.url);

function upload(
  who: { cookie: string },
  fields: { file?: Blob; name?: string; title?: string; durationMs?: string },
  origin = office.origin,
) {
  const form = new FormData();
  if (fields.file) form.set("file", fields.file, fields.name ?? "song.mp3");
  if (fields.title !== undefined) form.set("title", fields.title);
  form.set("durationMs", fields.durationMs ?? "180000");
  return fetch(url(JUKEBOX_TRACKS_API_PATH), {
    method: "POST",
    body: form,
    headers: { cookie: who.cookie, origin },
  });
}

const get = (path: string, cookie?: string, headers: Record<string, string> = {}) =>
  fetch(url(path), { headers: { ...(cookie ? { cookie } : {}), ...headers } });

const youtube = (who: { cookie: string }, body: unknown) =>
  office.request(JUKEBOX_YOUTUBE_API_PATH, {
    method: "POST",
    cookie: who.cookie,
    body: JSON.stringify(body),
  });

describe("jukebox library", () => {
  test("signed-in humans see the bundled tracks with their attribution", async () => {
    expect((await get(JUKEBOX_TRACKS_API_PATH)).status).toBe(401);
    const res = await get(JUKEBOX_TRACKS_API_PATH, viewer.cookie);
    const { tracks } = (await res.json()) as { tracks: JukeboxTrack[] };
    const bundled = tracks.filter((t) => t.bundled);
    expect(bundled.length).toBeGreaterThanOrEqual(3);
    for (const t of bundled) {
      expect(t.license).toBe("CC-BY-4.0");
      expect(t.attribution).toContain("Kevin MacLeod");
      expect(t.durationMs).toBeGreaterThan(60_000);
    }
  });

  test("bundled audio is served with Range support, only to a session", async () => {
    const id = "bundled:spy-glass";
    expect((await get(jukeboxAudioPath(id))).status).toBe(401);
    const whole = await get(jukeboxAudioPath(id), viewer.cookie);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("audio/mpeg");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    const size = Number(whole.headers.get("content-length"));
    await whole.arrayBuffer();
    const part = await get(jukeboxAudioPath(id), viewer.cookie, { range: "bytes=100-199" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 100-199/${size}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    const bad = await get(jukeboxAudioPath(id), viewer.cookie, { range: `bytes=${size}-` });
    expect(bad.status).toBe(416);
    expect((await get(jukeboxAudioPath("nope"), viewer.cookie)).status).toBe(404);
  });
});

describe("jukebox uploads", () => {
  test("an MP3 is stored under the data dir under a name of the office's choosing", async () => {
    const res = await upload(member, {
      file: new Blob([mp3]),
      name: "../../etc/My_Song.mp3",
      title: "",
    });
    expect(res.status).toBe(201);
    const track = (await res.json()) as JukeboxTrack;
    expect(track).toMatchObject({ title: "My Song", source: "file", addedBy: member.id });
    expect(track.addedByName).toBe("Mia");
    expect(track.durationMs).toBe(180_000);
    const files = await readdir(join(dataDir, "jukebox"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.mp3$/);
    const audio = await get(jukeboxAudioPath(track.id), owner.cookie);
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(mp3);
  });

  test("anything that is not audio by its magic bytes is refused, whatever its name", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    for (const bytes of [png, html]) {
      const res = await upload(member, { file: new Blob([bytes]), name: "song.mp3" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "not_audio" });
    }
    expect((await upload(member, {})).status).toBe(400);
  });

  test("too large, a missing or absurd length, a viewer or another origin: refused", async () => {
    const big = new Blob([mp3, new Uint8Array(JUKEBOX_LIMITS.uploadMaxBytes)]);
    const large = await upload(member, { file: big });
    expect(large.status).toBe(413);
    expect(await large.json()).toEqual({ error: "too_large" });
    for (const durationMs of ["", "abc", "10", String(JUKEBOX_LIMITS.maxFileDurationMs + 1)]) {
      const res = await upload(member, { file: new Blob([mp3]), durationMs });
      expect(await res.json()).toEqual({ error: "bad_duration" });
    }
    expect((await upload(viewer, { file: new Blob([mp3]) })).status).toBe(403);
    expect((await upload(member, { file: new Blob([mp3]) }, "https://evil.example")).status).toBe(
      403,
    );
    expect(await readdir(join(dataDir, "jukebox"))).toHaveLength(1);
  });
});

/** POST a multipart body as a stream: chunked transfer, no Content-Length. */
async function uploadChunked(who: { cookie: string }, file: Blob) {
  const form = new FormData();
  form.set("file", file, "song.mp3");
  form.set("durationMs", "180000");
  const encoded = new Response(form);
  const type = encoded.headers.get("content-type") ?? "";
  const source = encoded.body;
  if (!source) throw new Error("no body");
  const reader = source.getReader();
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else {
        sent += value.byteLength;
        controller.enqueue(value);
      }
    },
  });
  const res = await fetch(url(JUKEBOX_TRACKS_API_PATH), {
    method: "POST",
    body,
    headers: { cookie: who.cookie, origin: office.origin, "content-type": type },
  });
  return { res, sent: () => sent };
}

describe("jukebox uploads without a Content-Length", () => {
  test("a chunked body past the limit is cut off and refused, nothing stored", async () => {
    const before = (await readdir(join(dataDir, "jukebox"))).length;
    const big = new Blob([mp3, new Uint8Array(JUKEBOX_LIMITS.uploadMaxBytes + 200 * 1024)]);
    const { res } = await uploadChunked(member, big);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
    expect(await readdir(join(dataDir, "jukebox"))).toHaveLength(before);
  });

  test("a chunked body under the limit is taken", async () => {
    const { res } = await uploadChunked(member, new Blob([mp3]));
    expect(res.status).toBe(201);
  });
});

describe("readCappedForm", () => {
  test("stops reading at the cap", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
        if (pulled > 10_000) controller.close();
      },
    });
    const request = new Request("http://x/", {
      method: "POST",
      body: stream,
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    expect(await readCappedForm(request, 8 * 1024)).toBeNull();
    expect(pulled).toBeLessThan(20);
  });
});

describe("jukebox YouTube links", () => {
  test("a link keeps only the video id; the same video is not added twice", async () => {
    const res = await youtube(member, { url: "https://youtu.be/dQw4w9WgXcQ?t=3", title: "Mood" });
    expect(res.status).toBe(201);
    const track = (await res.json()) as JukeboxTrack;
    expect(track).toMatchObject({ source: "youtube", videoId: "dQw4w9WgXcQ", durationMs: 0 });
    const again = await youtube(owner, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as JukeboxTrack).id).toBe(track.id);
    expect((await get(jukeboxAudioPath(track.id), member.cookie)).status).toBe(404);
  });

  test("anything else is refused, and viewers cannot add", async () => {
    const res = await youtube(member, { url: "https://evil.example/watch?v=dQw4w9WgXcQ" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_youtube" });
    expect((await youtube(viewer, { url: "dQw4w9WgXcQ" })).status).toBe(403);
  });
});

describe("parseRange", () => {
  test.each([
    ["bytes=0-9", 100, { start: 0, end: 9 }],
    ["bytes=90-", 100, { start: 90, end: 99 }],
    ["bytes=-10", 100, { start: 90, end: 99 }],
    ["bytes=50-500", 100, { start: 50, end: 99 }],
    ["bytes=100-", 100, null],
    ["bytes=9-2", 100, null],
    ["bytes=-0", 100, null],
    ["items=0-1", 100, null],
    ["bytes=0-1,4-5", 100, null],
  ])("%s of %d", (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });
});
