/**
 * Wall pictures (#46): `decor.place|move|remove` by who may do what, checked
 * against the generated room (boards, screens, doors, other pictures), the
 * room state publish, and files that never leave the pictures directory.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { UserRole } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { decor } from "../db/schema/index.ts";
import type { DecorCommand } from "../rooms/operation/decor.ts";
import { PictureStore } from "./store.ts";
import { makePng, type PictureOffice, startPictureOffice } from "./test-helpers.ts";

type Actor = { id: string; role: UserRole };

let office: PictureOffice;
let owner: Actor;
let admin: Actor;
/** An office admin whose GitHub account cannot see op1's repo (#270). */
let adminOutside: Actor;
let manager: Actor;
let spawner: Actor;
let other: Actor;
let watcher: Actor;
let viewerRole: Actor;
let outsider: Actor;

const run = (actor: Actor, command: DecorCommand, operationId = "op1") => {
  const commands = office.commands();
  if (!commands) throw new Error("decor commands not wired");
  return commands.run(actor, operationId, command);
};

/** Upload a picture as `actor` straight through the service. */
async function uploadAs(actor: Actor, operationId = "op1"): Promise<string> {
  const out = await office.pictures.upload(actor, operationId, makePng(40, 30));
  if (!out.ok) throw new Error(out.error);
  return out.upload.uploadId;
}

const spot = { wallId: "north", x: 6.6, y: 2.5, w: 0.6, h: 0.4 };

async function hang(actor: Actor, at: Partial<typeof spot> = {}): Promise<string> {
  const uploadId = await uploadAs(actor);
  const out = await run(actor, { type: "decor.place", kind: "picture", uploadId, ...spot, ...at });
  if (!out.ok) throw new Error(out.reason);
  return out.decorId;
}

const pictures = () => office.published.get("op1") ?? [];

beforeAll(async () => {
  office = await startPictureOffice();
  owner = await office.signUp("Owner", "owner");
  admin = await office.signUp("Admin", "admin");
  adminOutside = await office.signUp("Ops", "admin");
  manager = await office.signUp("Manager");
  spawner = await office.signUp("Spawner");
  other = await office.signUp("Other");
  watcher = await office.signUp("Watcher");
  // An office viewer whose membership says spawn is still capped at view.
  viewerRole = await office.signUp("Viewer", "viewer");
  outsider = await office.signUp("Outsider");
  office.addOperation("op1", {
    [owner.id]: "manage",
    [admin.id]: "manage",
    [manager.id]: "manage",
    [spawner.id]: "spawn",
    [other.id]: "spawn",
    [watcher.id]: "view",
    [viewerRole.id]: "spawn",
  });
  office.addOperation("op2", { [spawner.id]: "spawn" });
});

afterAll(() => office.stop());

describe("permission matrix", () => {
  test("placing: spawn and manage, whatever the office role; not view, viewers, outsiders or an admin outside the repo", async () => {
    for (const actor of [spawner, manager, admin, owner]) {
      const id = await hang(actor, { x: 6.6, y: 2.5 });
      expect(pictures().some((p) => p.id === id && p.placedBy === actor.id)).toBe(true);
      await run(actor, { type: "decor.remove", decorId: id });
    }
    for (const actor of [watcher, viewerRole]) {
      // A view-only human cannot even upload through the service's own checks upstream;
      // here they borrow a real upload id and are still refused.
      const uploadId = await uploadAs(spawner);
      const out = await run(actor, { type: "decor.place", kind: "picture", uploadId, ...spot });
      expect(out).toEqual({ ok: false, reason: "you may only look around this room" });
      office.pictures.pending.take(uploadId);
    }
    for (const actor of [outsider, adminOutside]) {
      const uploadId = await uploadAs(spawner);
      const out = await run(actor, { type: "decor.place", kind: "picture", uploadId, ...spot });
      expect(out.ok).toBe(false);
      office.pictures.pending.take(uploadId);
    }
  });

  test("an upload is only good for its uploader and its operation", async () => {
    const uploadId = await uploadAs(spawner);
    const stolen = await run(other, { type: "decor.place", kind: "picture", uploadId, ...spot });
    expect(stolen).toEqual({ ok: false, reason: "that upload is gone; upload the picture again" });
    const elsewhere = await run(
      spawner,
      { type: "decor.place", kind: "picture", uploadId, ...spot },
      "op2",
    );
    expect(elsewhere.ok).toBe(false);
    const hung = await run(spawner, { type: "decor.place", kind: "picture", uploadId, ...spot });
    expect(hung.ok).toBe(true);
    // Used once.
    const again = await run(spawner, {
      type: "decor.place",
      kind: "picture",
      uploadId,
      ...spot,
      x: 3,
    });
    expect(again.ok).toBe(false);
    if (hung.ok) await run(spawner, { type: "decor.remove", decorId: hung.decorId });
  });

  test("move, resize and remove: the placer and managers; not other spawners or watchers", async () => {
    const id = await hang(spawner);
    const moveTo = (x: number, size = { w: spot.w, h: spot.h }): DecorCommand => ({
      type: "decor.move",
      decorId: id,
      ...spot,
      ...size,
      x,
    });
    for (const actor of [other, watcher, viewerRole, outsider, adminOutside]) {
      expect((await run(actor, moveTo(6.5))).ok).toBe(false);
      expect((await run(actor, { type: "decor.remove", decorId: id })).ok).toBe(false);
    }
    expect(await run(spawner, moveTo(6.5))).toEqual({ ok: true, decorId: id });
    expect(pictures().find((p) => p.id === id)?.x).toBe(6.5);
    expect((await run(manager, moveTo(6.6))).ok).toBe(true);
    expect((await run(admin, moveTo(6.6, { w: 0.9, h: 0.6 }))).ok).toBe(true);
    expect(pictures().find((p) => p.id === id)).toMatchObject({ w: 0.9, h: 0.6 });
    expect((await run(owner, { type: "decor.remove", decorId: id })).ok).toBe(true);
    expect(pictures().some((p) => p.id === id)).toBe(false);
  });

  test("a placer downgraded to view only looks", async () => {
    const id = await hang(other);
    office.db.update(decor).set({ placedBy: other.id }).where(eq(decor.id, id)).run();
    // A member row cannot grant, but it narrows what GitHub gives (#270).
    const { operationMembers } = await import("../db/schema/index.ts");
    office.db
      .insert(operationMembers)
      .values({ operationId: "op1", userId: other.id, access: "view" })
      .run();
    expect((await run(other, { type: "decor.remove", decorId: id })).ok).toBe(false);
    expect((await run(manager, { type: "decor.remove", decorId: id })).ok).toBe(true);
  });
});

describe("where a picture may hang", () => {
  test("not on a board, the whiteboard, the gong, the door or off the wall", async () => {
    const uploadId = await uploadAs(spawner);
    const place = (at: Partial<typeof spot>) =>
      run(spawner, { type: "decor.place", kind: "picture", uploadId, ...spot, ...at });
    expect(await place({ wallId: "west", x: 1.25, y: 1.5 })).toEqual({
      ok: false,
      reason: "It would cover a board or screen.",
    });
    expect((await place({ wallId: "north", x: 1.75, y: 1.4 })).ok).toBe(false);
    expect((await place({ wallId: "north", x: 5.75, y: 1.3 })).ok).toBe(false);
    expect((await place({ wallId: "door", x: 2, y: 1.5 })).ok).toBe(false);
    expect((await place({ wallId: "east", x: 2, y: 1.5 })).ok).toBe(false);
    expect((await place({ y: 0.5 })).ok).toBe(false);
    expect((await place({ w: 3, h: 2 })).ok).toBe(false);
    office.pictures.pending.take(uploadId);
  });

  test("pictures do not overlap; a move may slide a picture along its own spot", async () => {
    const a = await hang(spawner, { x: 3, y: 2.5 });
    const uploadId = await uploadAs(spawner);
    const clash = await run(spawner, {
      type: "decor.place",
      kind: "picture",
      uploadId,
      ...spot,
      x: 3.3,
      y: 2.5,
    });
    expect(clash).toEqual({ ok: false, reason: "Another picture hangs there." });
    const b = await run(spawner, {
      type: "decor.place",
      kind: "picture",
      uploadId,
      ...spot,
      x: 3.7,
      y: 2.5,
    });
    expect(b.ok).toBe(true);
    const bId = b.ok ? b.decorId : "";
    expect((await run(spawner, { type: "decor.move", decorId: a, ...spot, x: 3.05 })).ok).toBe(
      true,
    );
    expect((await run(spawner, { type: "decor.move", decorId: a, ...spot, x: 3.5 })).ok).toBe(
      false,
    );
    for (const id of [a, bId]) await run(spawner, { type: "decor.remove", decorId: id });
  });
});

describe("files", () => {
  test("removing a picture deletes its file", async () => {
    const id = await hang(spawner);
    const row = office.pictures.store.get("op1", id);
    const path = office.pictures.store.pathOf(row?.blobPath);
    expect(path && existsSync(path)).toBe(true);
    await run(spawner, { type: "decor.remove", decorId: id });
    expect(path && existsSync(path)).toBe(false);
  });

  test("paths never leave the pictures directory", async () => {
    const store = new PictureStore(office.db, office.dataDir);
    const dir = join(office.dataDir, "pictures");
    expect(store.pathOf("pictures/abc.png")).toBe(join(dir, "abc.png"));
    expect(store.pathOf("pictures/../office.db")).toBeNull();
    expect(store.pathOf("pictures/../../etc/passwd")).toBeNull();
    expect(store.pathOf("/etc/passwd")).toBeNull();
    expect(store.pathOf("jukebox/x.mp3")).toBeNull();
    expect(store.pathOf("pictures/")).toBeNull();
    expect(store.pathOf(null)).toBeNull();
    // A row whose blobPath was tampered with serves nothing.
    const id = await hang(spawner);
    office.db
      .update(decor)
      .set({ blobPath: "pictures/../office.db" })
      .where(eq(decor.id, id))
      .run();
    expect(office.pictures.imagePath(spawner, "op1", id)).toBeNull();
    office.db.delete(decor).where(eq(decor.id, id)).run();
  });

  test("expired uploads are dropped with their files; the boot prune keeps hung ones", async () => {
    let now = Date.now();
    const { PendingUploads } = await import("./pending.ts");
    const discarded: string[] = [];
    const pending = new PendingUploads({ now: () => now, discard: (p) => discarded.push(p) });
    const item = pending.add({
      userId: "u",
      operationId: "o",
      blobPath: "pictures/x.png",
      width: 1,
      height: 1,
    });
    expect(pending.peek(item.id, "u", "o")).not.toBeNull();
    now += 31 * 60_000;
    expect(pending.peek(item.id, "u", "o")).toBeNull();
    expect(discarded).toEqual(["pictures/x.png"]);

    const id = await hang(spawner);
    const stray = await uploadAs(spawner);
    const strayPath = office.pictures.store.pathOf(
      office.pictures.pending.peek(stray, spawner.id, "op1")?.blobPath,
    );
    expect(strayPath && existsSync(strayPath)).toBe(true);
    // Run as at boot: nothing pending survives a restart, so only hung files stay.
    expect(await office.pictures.store.prune()).toBeGreaterThanOrEqual(1);
    expect(strayPath && existsSync(strayPath)).toBe(false);
    const hungPath = office.pictures.imagePath(spawner, "op1", id);
    expect(hungPath && existsSync(hungPath)).toBe(true);
    office.pictures.pending.take(stray);
  });
});
