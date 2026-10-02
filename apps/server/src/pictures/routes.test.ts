/**
 * Wall picture REST (#46): who may upload, the capped body (declared and
 * chunked), magic-byte validation, metadata stripped on disk, and the image
 * served to everyone with access and nobody else.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WALL_PICTURE_LIMITS,
  type WallPictureUpload,
  wallPictureImagePath,
  wallPicturesApiPath,
} from "@regulus/protocol";
import { PICTURE_BODY_MAX_BYTES } from "./routes.ts";
import {
  containsText,
  makeJpeg,
  makePng,
  makeWebp,
  type PictureOffice,
  startPictureOffice,
} from "./test-helpers.ts";

type Who = { id: string; role: "owner" | "admin" | "member" | "viewer"; cookie: string };

let office: PictureOffice;
let spawner: Who;
let watcher: Who;
let outsider: Who;

const upload = (
  who: Who | null,
  file: Uint8Array | Blob,
  opts: { origin?: string; operationId?: string; name?: string; type?: string } = {},
) => {
  const form = new FormData();
  const blob =
    file instanceof Blob
      ? file
      : new Blob([file.slice().buffer as ArrayBuffer], { type: opts.type ?? "image/png" });
  form.set("file", blob, opts.name ?? "holiday.png");
  return fetch(new URL(wallPicturesApiPath(opts.operationId ?? "op1"), office.server.url), {
    method: "POST",
    headers: { ...(who ? { cookie: who.cookie } : {}), origin: opts.origin ?? office.origin },
    body: form,
  });
};

beforeAll(async () => {
  office = await startPictureOffice();
  await office.signUp("Owner", "owner");
  spawner = await office.signUp("Spawner");
  watcher = await office.signUp("Watcher");
  outsider = await office.signUp("Outsider");
  office.addOperation("op1", { [spawner.id]: "spawn", [watcher.id]: "view" });
});

afterAll(() => office.stop());

describe("upload", () => {
  test("needs a session, the office's origin and spawn or manage access", async () => {
    expect((await upload(null, makePng())).status).toBe(401);
    expect((await upload(spawner, makePng(), { origin: "https://evil.example" })).status).toBe(403);
    expect((await upload(outsider, makePng())).status).toBe(404);
    expect((await upload(spawner, makePng(), { operationId: "nope" })).status).toBe(404);
    const viewer = await upload(watcher, makePng());
    expect(viewer.status).toBe(403);
    expect(await viewer.json()).toEqual({ error: "view_only" });
  });

  test("PNG, JPEG and WebP are taken; the stored file has no metadata", async () => {
    for (const [file, kind, width] of [
      [makePng(64, 48), "png", 64],
      [makeJpeg(30, 20), "jpeg", 30],
      [makeWebp(50, 40), "webp", 50],
    ] as const) {
      const res = await upload(spawner, file);
      expect(res.status).toBe(201);
      const body = (await res.json()) as WallPictureUpload;
      expect(body).toMatchObject({ kind, width });
      office.pictures.pending.take(body.uploadId);
    }
    const files = readdirSync(join(office.dataDir, "pictures"));
    expect(files.map((f) => f.split(".").pop()).sort()).toEqual(["jpg", "png", "webp"]);
    for (const f of files) {
      const stored = readFileSync(join(office.dataDir, "pictures", f));
      expect(containsText(stored, "Somebody")).toBe(false);
      expect(containsText(stored, "GPS")).toBe(false);
      expect(containsText(stored, "camera")).toBe(false);
      // Office-chosen names only: a uuid, never the client's "holiday".
      expect(f).toMatch(/^[0-9a-f-]{36}\.(png|jpg|webp)$/);
    }
  });

  test("the type is read from the bytes, not from the name or content type", async () => {
    const gif = new TextEncoder().encode("GIF89a\x01\x00\x01\x00 pretend png");
    const res = await upload(spawner, gif, { name: "fine.png", type: "image/png" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_image" });
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>");
    expect((await upload(spawner, svg, { type: "image/svg+xml", name: "x.svg" })).status).toBe(400);
    const notMultipart = await fetch(new URL(wallPicturesApiPath("op1"), office.server.url), {
      method: "POST",
      headers: { cookie: spawner.cookie, origin: office.origin, "content-type": "image/png" },
      body: makePng().slice().buffer as ArrayBuffer,
    });
    expect(notMultipart.status).toBe(400);
  });

  test("too many pixels is refused", async () => {
    const res = await upload(spawner, makePng(WALL_PICTURE_LIMITS.maxSidePx + 1, 10));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too_many_pixels" });
    expect((await upload(spawner, makePng(8000, 8000))).status).toBe(400);
  });

  test("a body declared over the cap is refused before it is read", async () => {
    const res = await fetch(new URL(wallPicturesApiPath("op1"), office.server.url), {
      method: "POST",
      headers: {
        cookie: spawner.cookie,
        origin: office.origin,
        "content-type": "multipart/form-data; boundary=x",
      },
      // fetch sends the real length: one byte over the file cap plus its framing.
      body: new Uint8Array(PICTURE_BODY_MAX_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
  });

  test("a chunked body is cut off as soon as it passes the cap", async () => {
    const chunk = new Uint8Array(256 * 1024).fill(0x41);
    let sent = 0;
    const total = WALL_PICTURE_LIMITS.uploadMaxBytes + 2 * 1024 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= total) return controller.close();
        if (sent === 0) {
          const head = new TextEncoder().encode(
            '--x\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\n',
          );
          controller.enqueue(head);
          sent += head.length;
          return;
        }
        controller.enqueue(chunk);
        sent += chunk.length;
      },
    });
    const res = await fetch(new URL(wallPicturesApiPath("op1"), office.server.url), {
      method: "POST",
      headers: {
        cookie: spawner.cookie,
        origin: office.origin,
        "content-type": "multipart/form-data; boundary=x",
      },
      body: stream,
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
    // Nothing was stored for it.
    expect(office.pictures.pending.countFor(spawner.id)).toBe(0);
  });

  test("uploads waiting to be hung are capped per human", async () => {
    const ids: string[] = [];
    for (let i = 0; i < WALL_PICTURE_LIMITS.pendingPerUser; i++) {
      const res = await upload(spawner, makePng());
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as WallPictureUpload).uploadId);
    }
    const over = await upload(spawner, makePng());
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: "too_many_pending" });
    for (const id of ids) office.pictures.pending.take(id);
  });
});

describe("image", () => {
  test("everyone with access gets a hung picture; outsiders get 404", async () => {
    const res = await upload(spawner, makeJpeg(30, 20));
    const { uploadId } = (await res.json()) as WallPictureUpload;
    const outcome = await office.commands()?.run(spawner, "op1", {
      type: "decor.place",
      kind: "picture",
      wallId: "north",
      uploadId,
      x: 6.6,
      y: 2.5,
      w: 0.6,
      h: 0.4,
    });
    expect(outcome?.ok).toBe(true);
    const decorId = outcome?.ok ? outcome.decorId : "";
    const url = new URL(wallPictureImagePath("op1", decorId), office.server.url);
    const seen = await fetch(url, { headers: { cookie: watcher.cookie } });
    expect(seen.status).toBe(200);
    expect(seen.headers.get("content-type")).toBe("image/jpeg");
    expect(seen.headers.get("x-content-type-options")).toBe("nosniff");
    const body = new Uint8Array(await seen.arrayBuffer());
    expect(containsText(body, "GPS")).toBe(false);
    expect((await fetch(url, { headers: { cookie: outsider.cookie } })).status).toBe(404);
    expect((await fetch(url)).status).toBe(401);
    const other = new URL(wallPictureImagePath("op1", "not-a-decor"), office.server.url);
    expect((await fetch(other, { headers: { cookie: watcher.cookie } })).status).toBe(404);
  });
});
