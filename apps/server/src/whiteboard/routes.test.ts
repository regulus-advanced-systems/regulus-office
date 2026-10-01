/**
 * Whiteboard REST (#45): board info, the snapshot upload (edit access, same
 * origin, PNG only, size caps) and the snapshot download with its ETag.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOBBY_WHITEBOARD_ID, whiteboardApiPath, whiteboardSnapshotPath } from "@regulus/protocol";
import { pngSize } from "./routes.ts";
import { startWhiteboardOffice, type WhiteboardOffice } from "./test-helpers.ts";

/** A valid 2×1 PNG header (signature + IHDR); enough for the server's checks. */
function png(width = 2, height = 1, extra = 16): Uint8Array {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

let office: WhiteboardOffice;
let member: { id: string; cookie: string };
let watcher: { id: string; cookie: string };
let outsider: { id: string; cookie: string };

const put = (boardId: string, cookie: string, body: Uint8Array, origin?: string) =>
  fetch(new URL(whiteboardSnapshotPath(boardId), office.server.url), {
    method: "PUT",
    headers: { cookie, origin: origin ?? office.origin, "content-type": "image/png" },
    body: body.slice().buffer as ArrayBuffer,
  });
const get = (path: string, cookie: string, headers: Record<string, string> = {}) =>
  fetch(new URL(path, office.server.url), { headers: { cookie, ...headers } });

beforeAll(async () => {
  office = await startWhiteboardOffice();
  await office.signUp("Owner");
  member = await office.signUp("Member", "member");
  watcher = await office.signUp("Watcher", "member");
  outsider = await office.signUp("Outsider", "member");
  office.addOperation("op1", { [member.id]: "spawn", [watcher.id]: "view" });
});

afterAll(() => office.stop());

test("pngSize reads the IHDR and rejects anything else", () => {
  expect(pngSize(png(640, 480))).toEqual({ width: 640, height: 480 });
  expect(pngSize(new TextEncoder().encode("GIF89a not a png at all......"))).toBeNull();
  expect(pngSize(png().subarray(0, 20))).toBeNull();
});

describe("snapshot", () => {
  test("board info tells the caller's access; outsiders get 404", async () => {
    const mine = await get(whiteboardApiPath("op1"), member.cookie);
    expect(await mine.json()).toEqual({ boardId: "op1", version: 0, access: "edit" });
    const theirs = await get(whiteboardApiPath("op1"), watcher.cookie);
    expect(((await theirs.json()) as { access: string }).access).toBe("view");
    expect((await get(whiteboardApiPath("op1"), outsider.cookie)).status).toBe(404);
    expect((await fetch(new URL(whiteboardApiPath("op1"), office.server.url))).status).toBe(401);
  });

  test("an editor uploads a snapshot; the version bumps and the room is told", async () => {
    const res = await put("op1", member.cookie, png());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 1 });
    expect(office.snapshots).toEqual([{ boardId: "op1", version: 1 }]);
    expect(existsSync(join(office.dataDir, "whiteboards", "op1.png"))).toBe(true);
    const again = await put("op1", member.cookie, png(4, 4));
    expect(await again.json()).toEqual({ version: 2 });
  });

  test("everyone with access downloads it, with an ETag by version", async () => {
    const res = await get(whiteboardSnapshotPath("op1", 2), watcher.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const etag = res.headers.get("etag") ?? "";
    expect(etag).toBe('"v2"');
    expect(pngSize(new Uint8Array(await res.arrayBuffer()))).toEqual({ width: 4, height: 4 });
    const cached = await get(whiteboardSnapshotPath("op1"), watcher.cookie, {
      "if-none-match": etag,
    });
    expect(cached.status).toBe(304);
    expect((await get(whiteboardSnapshotPath("op1"), outsider.cookie)).status).toBe(404);
  });

  test("refuses read-only users, other origins, non-PNGs and oversized images", async () => {
    expect((await put("op1", watcher.cookie, png())).status).toBe(403);
    expect((await put("op1", outsider.cookie, png())).status).toBe(404);
    expect((await put("op1", member.cookie, png(), "https://evil.example")).status).toBe(403);
    expect((await put("op1", member.cookie, new TextEncoder().encode("hello"))).status).toBe(400);
    expect((await put("op1", member.cookie, png(5000, 10))).status).toBe(400);
    expect((await put("op1", member.cookie, png(2, 1, 3 * 1024 * 1024))).status).toBe(413);
    expect(office.snapshots).toHaveLength(2);
  });

  test("the lobby board has its own snapshot; none yet is 404", async () => {
    expect((await get(whiteboardSnapshotPath(LOBBY_WHITEBOARD_ID), outsider.cookie)).status).toBe(
      404,
    );
    const res = await put(LOBBY_WHITEBOARD_ID, outsider.cookie, png());
    expect(await res.json()).toEqual({ version: 1 });
    expect(office.snapshots.at(-1)).toEqual({ boardId: LOBBY_WHITEBOARD_ID, version: 1 });
  });

  test("orphaned snapshot files are pruned", async () => {
    writeFileSync(join(office.dataDir, "whiteboards", "deleted-op.png"), png());
    expect(await office.whiteboards.pruneSnapshots()).toBe(1);
    expect(existsSync(join(office.dataDir, "whiteboards", "op1.png"))).toBe(true);
  });
});
