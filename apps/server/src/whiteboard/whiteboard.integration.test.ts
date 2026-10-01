/**
 * The whiteboard endpoint end to end (#45): upgrade refusals, two clients
 * syncing, persistence across a board being freed and reloaded, the lobby
 * board key, read-only peers, reconnect sync, authenticated cursor names.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LOBBY_WHITEBOARD_ID, whiteboardWsPath } from "@regulus/protocol";
import { eq, isNull } from "drizzle-orm";
import * as Y from "yjs";
import { operations, whiteboards } from "../db/schema/index.ts";
import { draw, ids, startWhiteboardOffice, until, type WhiteboardOffice } from "./test-helpers.ts";

let office: WhiteboardOffice;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let watcher: { id: string; cookie: string };
let outsider: { id: string; cookie: string };
let viewer: { id: string; cookie: string };
const open: Array<{ provider: { destroy(): void } }> = [];

const connect = (boardId: string, cookie: string) => {
  const c = office.client(boardId, cookie);
  open.push(c);
  return c;
};
const synced = (c: ReturnType<WhiteboardOffice["client"]>) =>
  until(() => c.provider.synced, "sync");

const probe = (boardId: string, headers: Record<string, string>) =>
  fetch(new URL(whiteboardWsPath(boardId), office.server.url), {
    headers: {
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      origin: office.origin,
      ...headers,
    },
  });

beforeAll(async () => {
  office = await startWhiteboardOffice();
  owner = await office.signUp("Owner");
  member = await office.signUp("Member", "member");
  watcher = await office.signUp("Watcher", "member");
  outsider = await office.signUp("Outsider", "member");
  viewer = await office.signUp("Viewer", "viewer");
  office.addOperation("op1", { [member.id]: "spawn", [watcher.id]: "view", [viewer.id]: "manage" });
  office.addOperation("op2");
  office.addOperation("gone", { [member.id]: "spawn" });
  office.db
    .update(operations)
    .set({ archivedAt: new Date() })
    .where(eq(operations.id, "gone"))
    .run();
});

afterAll(async () => {
  for (const c of open) c.provider.destroy();
  await office.stop();
});

describe("upgrade", () => {
  test("refuses without a session, from another origin, and without operation access", async () => {
    expect((await probe("op1", {})).status).toBe(401);
    expect(
      (await probe("op1", { cookie: member.cookie, origin: "https://evil.example" })).status,
    ).toBe(403);
    // Same answer for "no access", "archived" and "no such operation": nothing is revealed.
    expect((await probe("op2", { cookie: member.cookie })).status).toBe(404);
    expect((await probe("op1", { cookie: outsider.cookie })).status).toBe(404);
    expect((await probe("gone", { cookie: member.cookie })).status).toBe(404);
    expect((await probe("nope", { cookie: owner.cookie })).status).toBe(404);
    expect((await probe("..%2Fx", { cookie: owner.cookie })).status).toBe(404);
  });

  test("a plain GET is told to upgrade", async () => {
    const res = await fetch(new URL(whiteboardWsPath("op1"), office.server.url));
    expect(res.status).toBe(426);
  });
});

describe("sync and persistence", () => {
  test("two members draw on the same board and see each other's strokes", async () => {
    const a = connect("op1", member.cookie);
    const b = connect("op1", owner.cookie);
    await synced(a);
    await synced(b);
    draw(a.elements, "from-a");
    draw(b.elements, "from-b");
    await until(() => ids(a.elements).length === 2 && ids(b.elements).length === 2, "both strokes");
    expect(ids(a.elements)).toEqual(["from-a", "from-b"]);
    a.provider.destroy();
    b.provider.destroy();
  });

  test("the last one out saves the board; a later visitor loads it from the database", async () => {
    await until(() => office.whiteboards.endpoint.live("op1") === undefined, "board freed");
    const row = office.db
      .select()
      .from(whiteboards)
      .where(eq(whiteboards.operationId, "op1"))
      .get();
    expect(row?.ydocBlob).toBeTruthy();
    // The stored blob is the merged document itself (compacted), not an update log.
    const stored = new Y.Doc();
    Y.applyUpdate(stored, new Uint8Array(row?.ydocBlob as Buffer));
    expect(stored.getArray("elements").length).toBe(2);

    const later = connect("op1", member.cookie);
    await synced(later);
    expect(ids(later.elements)).toEqual(["from-a", "from-b"]);
    later.provider.destroy();
  });

  test("the lobby board is open to everyone and stored as the row with no operation", async () => {
    const a = connect(LOBBY_WHITEBOARD_ID, outsider.cookie);
    await synced(a);
    draw(a.elements, "lobby-note");
    await until(
      () =>
        office.db.select().from(whiteboards).where(isNull(whiteboards.operationId)).all().length ===
        1,
      "lobby row",
    );
    a.provider.destroy();
    await until(() => office.whiteboards.endpoint.live(LOBBY_WHITEBOARD_ID) === undefined, "freed");
    const b = connect(LOBBY_WHITEBOARD_ID, member.cookie);
    await synced(b);
    draw(b.elements, "second");
    await until(() => ids(b.elements).length === 2, "second stroke");
    b.provider.destroy();
    await until(() => office.whiteboards.endpoint.live(LOBBY_WHITEBOARD_ID) === undefined, "freed");
    expect(
      office.db.select().from(whiteboards).where(isNull(whiteboards.operationId)).all(),
    ).toHaveLength(1);
  });

  test("read-only peers receive strokes but cannot draw", async () => {
    const editor = connect("op1", member.cookie);
    const reader = connect("op1", watcher.cookie);
    const office_viewer = connect("op1", viewer.cookie);
    await Promise.all([synced(editor), synced(reader), synced(office_viewer)]);
    draw(reader.elements, "sneaky");
    draw(office_viewer.elements, "sneaky-viewer");
    draw(editor.elements, "allowed");
    await until(() => ids(reader.elements).includes("allowed"), "reader gets the stroke");
    await Bun.sleep(100);
    expect(ids(editor.elements)).not.toContain("sneaky");
    expect(ids(editor.elements)).not.toContain("sneaky-viewer");
    const live = office.whiteboards.endpoint.live("op1");
    expect(ids(live?.doc.getArray("elements") as Y.Array<Y.Map<unknown>>)).not.toContain("sneaky");
    for (const c of [editor, reader, office_viewer]) c.provider.destroy();
  });

  test("a client that reconnects merges its offline strokes and gets what it missed", async () => {
    const a = connect("op1", member.cookie);
    const b = connect("op1", owner.cookie);
    await Promise.all([synced(a), synced(b)]);
    a.provider.disconnect();
    await until(() => !a.provider.wsconnected, "a offline");
    draw(a.elements, "offline-a");
    draw(b.elements, "online-b");
    await Bun.sleep(50);
    expect(ids(b.elements)).not.toContain("offline-a");
    a.provider.connect();
    await until(
      () => ids(a.elements).includes("online-b") && ids(b.elements).includes("offline-a"),
      "both sides merged",
    );
    a.provider.destroy();
    b.provider.destroy();
  });

  test("cursor names come from the session, not from the client", async () => {
    const a = connect("op1", member.cookie);
    const b = connect("op1", owner.cookie);
    await Promise.all([synced(a), synced(b)]);
    a.provider.awareness.setLocalStateField("user", { name: "Owner", color: "#f00" });
    const seen = () =>
      b.provider.awareness.getStates().get(a.doc.clientID) as
        | { user?: { name?: string; color?: string } }
        | undefined;
    await until(() => seen()?.user !== undefined, "a's cursor");
    expect(seen()?.user).toEqual({ name: "Member", color: "#f00" });
    a.provider.destroy();
    b.provider.destroy();
  });
});
