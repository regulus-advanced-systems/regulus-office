/**
 * Lost access closes open whiteboard sockets (#244): two humans on one
 * board, access withdrawn from one while both are connected. The socket
 * closes promptly with an `ACCESS_CLOSE_CODES` code, nothing more reaches it
 * or is applied from it, and the other human is not disturbed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  ACCESS_CLOSE_CODES,
  ACCESS_CLOSE_REASONS,
  isFinalAccessClose,
  LOBBY_WHITEBOARD_ID,
} from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import { operationMembers, operations, userProfiles } from "../db/schema/index.ts";
import { draw, ids, startWhiteboardOffice, until, type WhiteboardOffice } from "./test-helpers.ts";

type User = { id: string; cookie: string };
type BoardClient = ReturnType<WhiteboardOffice["client"]>;

/** "Promptly": well under the second the issue asks for. */
const PROMPT_MS = 1000;

let office: WhiteboardOffice;
let owner: User;
const open: BoardClient[] = [];
let seq = 0;

/** Connect like the web client does: no reconnect after a final access close. */
const connect = (boardId: string, user: User) => {
  const closes: { code: number; reason: string; at: number }[] = [];
  const c = office.client(
    boardId,
    user.cookie,
    {},
    { shouldReconnect: (event) => !isFinalAccessClose(event.code) },
  );
  c.provider.on("connection-close", (event) => {
    if (event) closes.push({ code: event.code, reason: event.reason, at: Date.now() });
  });
  open.push(c);
  return Object.assign(c, { closes });
};
const synced = (c: BoardClient) => until(() => c.provider.synced, "sync");

/** A fresh operation with `member` on it, so tests do not share boards. */
const room = async (access: "manage" | "spawn" | "view" = "spawn") => {
  seq += 1;
  const member = await office.signUp(`Member${seq}`, "member");
  const id = `op${seq}`;
  office.addOperation(id, { [member.id]: access });
  return { id, member };
};

const removeMember = (operationId: string, userId: string) =>
  office.db
    .delete(operationMembers)
    .where(and(eq(operationMembers.operationId, operationId), eq(operationMembers.userId, userId)))
    .run();

beforeAll(async () => {
  office = await startWhiteboardOffice();
  owner = await office.signUp("Owner");
});

afterAll(async () => {
  for (const c of open) c.provider.destroy();
  await office.stop();
});

describe("whiteboard: access withdrawn while connected", () => {
  test("removed from the operation: closed at once, nothing more arrives or is applied", async () => {
    const { id, member } = await room();
    const a = connect(id, owner);
    const b = connect(id, member);
    await Promise.all([synced(a), synced(b)]);
    draw(a.elements, "before");
    await until(() => ids(b.elements).includes("before"), "the first stroke");

    removeMember(id, member.id);
    const at = Date.now();
    const outcome = office.liveAccess.accessChanged({ userId: member.id, operationIds: [id] });
    expect(outcome).toEqual({ checked: 1, ended: 1 });
    await until(() => b.closes.length > 0, "the close");
    expect(b.closes[0]?.code).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(b.closes[0]?.reason).toBe(ACCESS_CLOSE_REASONS.revoked);
    expect((b.closes[0]?.at ?? 0) - at).toBeLessThan(PROMPT_MS);

    // The owner keeps drawing; the removed member's strokes go nowhere.
    draw(a.elements, "after");
    draw(b.elements, "ghost");
    await Bun.sleep(300);
    expect(ids(b.elements)).not.toContain("after");
    expect(ids(a.elements)).toEqual(["after", "before"]);
    expect(a.closes).toHaveLength(0);
    expect(a.provider.wsconnected).toBe(true);
    // No reconnect loop: one close, and the socket stays down.
    expect(b.closes).toHaveLength(1);
    expect(b.provider.wsconnected).toBe(false);
    expect(office.liveAccess.count({ operationIds: [id] })).toBe(1);
  });

  test("downgraded to view: closed with `changed`, back read-only, edits no longer applied", async () => {
    const { id, member } = await room("spawn");
    const a = connect(id, owner);
    const b = connect(id, member);
    await Promise.all([synced(a), synced(b)]);
    draw(b.elements, "mine");
    await until(() => ids(a.elements).includes("mine"), "the member's stroke");

    office.db
      .update(operationMembers)
      .set({ access: "view" })
      .where(and(eq(operationMembers.operationId, id), eq(operationMembers.userId, member.id)))
      .run();
    office.liveAccess.accessChanged({ userId: member.id, operationIds: [id] });
    await until(() => b.closes.length > 0, "the close");
    expect(b.closes[0]?.code).toBe(ACCESS_CLOSE_CODES.changed);

    // The client comes back by itself, now as a watcher.
    await until(() => b.provider.wsconnected && b.provider.synced, "the reconnect");
    draw(a.elements, "owner-after");
    await until(() => ids(b.elements).includes("owner-after"), "updates to the watcher");
    draw(b.elements, "not-allowed");
    await Bun.sleep(300);
    expect(ids(a.elements)).toEqual(["mine", "owner-after"]);
    expect(b.closes).toHaveLength(1);
  });

  test("operation archived: every board socket on it closes", async () => {
    const { id, member } = await room();
    const a = connect(id, owner);
    const b = connect(id, member);
    await Promise.all([synced(a), synced(b)]);
    office.db.update(operations).set({ archivedAt: new Date() }).where(eq(operations.id, id)).run();
    expect(office.liveAccess.accessChanged({ operationIds: [id] })).toEqual({
      checked: 2,
      ended: 2,
    });
    await until(() => a.closes.length > 0 && b.closes.length > 0, "both closes");
    expect(a.closes[0]?.code).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(b.closes[0]?.code).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(office.whiteboards.endpoint.live(id)).toBeUndefined();
  });

  test("role changed to viewer through the API: the lobby board comes back read-only", async () => {
    const member = await office.signUp("Demoted", "member");
    const a = connect(LOBBY_WHITEBOARD_ID, owner);
    const b = connect(LOBBY_WHITEBOARD_ID, member);
    await Promise.all([synced(a), synced(b)]);

    const res = await fetch(new URL(`/api/users/${member.id}/role`, office.server.url), {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: office.origin, cookie: owner.cookie },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(res.status).toBe(200);
    await until(() => b.closes.length > 0, "the close");
    expect(b.closes[0]?.code).toBe(ACCESS_CLOSE_CODES.changed);
    await until(() => b.provider.wsconnected && b.provider.synced, "the reconnect");
    draw(b.elements, "viewer-stroke");
    await Bun.sleep(300);
    expect(ids(a.elements)).not.toContain("viewer-stroke");
    expect(a.closes).toHaveLength(0);
  });

  test("signed out: closed with `signedOut`, the other session of nobody else is touched", async () => {
    const { id, member } = await room();
    const a = connect(id, owner);
    const b = connect(id, member);
    await Promise.all([synced(a), synced(b)]);

    const res = await fetch(new URL("/api/auth/sign-out", office.server.url), {
      method: "POST",
      headers: { "content-type": "application/json", origin: office.origin, cookie: member.cookie },
      body: "{}",
    });
    expect(res.status).toBe(200);
    await until(() => b.closes.length > 0, "the close");
    expect(b.closes[0]?.code).toBe(ACCESS_CLOSE_CODES.signedOut);
    expect(b.closes[0]?.reason).toBe(ACCESS_CLOSE_REASONS.signedOut);
    draw(a.elements, "after-sign-out");
    await Bun.sleep(300);
    expect(ids(b.elements)).not.toContain("after-sign-out");
    expect(b.closes).toHaveLength(1);
    expect(a.closes).toHaveLength(0);
  });

  test("account removed: the sweep closes what nobody reported", async () => {
    const { id, member } = await room();
    const b = connect(id, member);
    await synced(b);
    office.db.delete(userProfiles).where(eq(userProfiles.userId, member.id)).run();
    const stop = office.liveAccess.startSweep(20);
    try {
      await until(() => b.closes.length > 0, "the close");
    } finally {
      stop();
    }
    expect(b.closes[0]?.code).toBe(ACCESS_CLOSE_CODES.signedOut);
  });
});
