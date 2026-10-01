import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { OperationAccess, RoomShape } from "@regulus/protocol";
import { maxDeskCount, ROOM_LAYOUT_ID, roomDeskSeatIds } from "@regulus/room-layout";
import { and, asc, eq } from "drizzle-orm";
import { AuthHttpError } from "../../auth/errors.ts";
import {
  agents,
  auditLog,
  desks,
  operationMembers,
  operationRepos,
  operations,
} from "../../db/schema/index.ts";
import { testDb } from "../../operations/test-helpers.ts";
import { RoomSettingsService, syncDeskRows } from "./service.ts";

const SIZE: RoomShape = { width: 6, depth: 6, doorSide: "south" };

function setup() {
  const { db, addUser } = testDb();
  const owner = addUser("Olga", "owner");
  const manager = addUser("Mona", "member");
  const spawner = addUser("Sam", "member");
  const viewer = addUser("Vic", "member");
  const stranger = addUser("Stan", "member");
  const changed: string[] = [];
  const settings = new RoomSettingsService({
    db,
    onChange: (id) => changed.push(id),
    sizeOf: (row) => (row.layoutTemplateId === ROOM_LAYOUT_ID ? SIZE : null),
  });

  let seq = 0;
  const addOperation = (layoutTemplateId: string, deskCount: number, seatIds: string[]) => {
    seq++;
    const operationId = `operation-${seq}`;
    db.insert(operations)
      .values({
        id: operationId,
        name: `F${seq}`,
        slug: `f${seq}`,
        index: seq,
        paletteId: "p",
        layoutTemplateId,
        deskCount,
      })
      .run();
    db.insert(operationRepos)
      .values({ id: `repo-${seq}`, operationId, owner: "o", name: "r", url: "u", workdir: "/w" })
      .run();
    for (const [user, access] of [
      [manager, "manage"],
      [spawner, "spawn"],
      [viewer, "view"],
    ] as const)
      db.insert(operationMembers)
        .values({ operationId, userId: user.id, access: access as OperationAccess })
        .run();
    if (seatIds.length > 0)
      db.insert(desks)
        .values(seatIds.map((seatId) => ({ operationId, seatId })))
        .run();
    return operationId;
  };

  /** Seat a henchman at `seatId`. */
  const seat = (operationId: string, seatId: string) => {
    const id = randomUUID();
    db.insert(agents)
      .values({
        id,
        operationId,
        repoId: `repo-${operationId.split("-")[1]}`,
        deskSeatId: seatId,
        ownerUserId: spawner.id,
        provider: "claude-code",
        model: "opus",
        profileId: "login:claude",
        status: "working",
        workdir: "/nowhere",
        taskTitle: "t",
      })
      .run();
    db.update(desks)
      .set({ agentId: id })
      .where(and(eq(desks.operationId, operationId), eq(desks.seatId, seatId)))
      .run();
    return id;
  };

  const seats = (operationId: string) =>
    db
      .select({ seatId: desks.seatId })
      .from(desks)
      .where(eq(desks.operationId, operationId))
      .orderBy(asc(desks.seatId))
      .all()
      .map((r) => r.seatId);

  return {
    db,
    settings,
    owner,
    manager,
    spawner,
    viewer,
    stranger,
    changed,
    addOperation,
    seat,
    seats,
  };
}

const failure = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    if (err instanceof AuthHttpError)
      return `${err.status} ${err.code} ${JSON.stringify(err.detail)}`;
    throw err;
  }
  return "ok";
};

describe("room settings ACL", () => {
  test("anyone with room access reads; only room managers (and owners/admins) change", () => {
    const t = setup();
    const id = t.addOperation(ROOM_LAYOUT_ID, 1, roomDeskSeatIds(1));
    for (const who of [t.owner, t.manager, t.spawner, t.viewer])
      expect(t.settings.get(who, id).deskCount).toBe(1);
    expect(t.settings.get(t.viewer, id).canManage).toBe(false);
    expect(t.settings.get(t.manager, id).canManage).toBe(true);
    expect(failure(() => t.settings.get(t.stranger, id))).toStartWith("404 operation_not_found");
    for (const who of [t.spawner, t.viewer])
      expect(failure(() => t.settings.update(who, id, { decorStyle: "lab" }))).toStartWith(
        "403 operation_manage_required",
      );
    expect(failure(() => t.settings.update(t.stranger, id, { decorStyle: "lab" }))).toStartWith(
      "404",
    );
    expect(failure(() => t.settings.get(t.owner, "nope"))).toStartWith("404");
    expect(t.settings.update(t.owner, id, { decorStyle: "war_room" }).decorStyle).toBe("war_room");
    expect(t.settings.update(t.manager, id, { decorStyle: "lab" }).decorStyle).toBe("lab");
    expect(t.changed).toEqual([id, id]);
  });

  test("an archived room is gone", () => {
    const t = setup();
    const id = t.addOperation(ROOM_LAYOUT_ID, 1, roomDeskSeatIds(1));
    t.db.update(operations).set({ archivedAt: new Date() }).where(eq(operations.id, id)).run();
    expect(failure(() => t.settings.update(t.owner, id, { deskCount: 2 }))).toStartWith("404");
  });
});

describe("desk count", () => {
  test("growing adds the new desks' seats and keeps the old ones; it is audited and published", () => {
    const t = setup();
    const id = t.addOperation(ROOM_LAYOUT_ID, 1, roomDeskSeatIds(1));
    const henchman = t.seat(id, "d1s3");
    const info = t.settings.update(t.manager, id, { deskCount: 2 });
    expect(info).toMatchObject({ deskCount: 2, generated: true, occupiedDesks: [1], size: SIZE });
    expect(info.maxDeskCount).toBe(maxDeskCount(6, 6));
    expect(t.seats(id)).toEqual(roomDeskSeatIds(2).sort());
    expect(t.db.select().from(desks).where(eq(desks.seatId, "d1s3")).get()?.agentId).toBe(henchman);
    const audit = t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "operation.room_settings"))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.targetId).toBe(id);
    expect(JSON.parse(audit[0]?.metaJson ?? "{}")).toEqual({
      from: { deskCount: 1, decorStyle: "ops_room" },
      to: { deskCount: 2, decorStyle: "ops_room" },
    });
    expect(t.changed).toEqual([id]);
  });

  test("more desks than the size fits is refused", () => {
    const t = setup();
    const id = t.addOperation(ROOM_LAYOUT_ID, 1, roomDeskSeatIds(1));
    const max = maxDeskCount(6, 6);
    expect(failure(() => t.settings.update(t.owner, id, { deskCount: max + 1 }))).toBe(
      `400 too_many_desks {"maxDeskCount":${max}}`,
    );
    expect(t.changed).toEqual([]);
  });

  test("shrinking is refused while a henchman sits at a desk that would go; free desks go", () => {
    const t = setup();
    const id = t.addOperation(ROOM_LAYOUT_ID, 2, roomDeskSeatIds(2));
    const henchman = t.seat(id, "d2s4");
    expect(failure(() => t.settings.update(t.owner, id, { deskCount: 1 }))).toBe(
      '409 desks_occupied {"desks":[2]}',
    );
    expect(t.seats(id)).toEqual(roomDeskSeatIds(2).sort());
    t.db.update(desks).set({ agentId: null }).where(eq(desks.seatId, "d2s4")).run();
    t.db.delete(agents).where(eq(agents.id, henchman)).run();
    t.seat(id, "d1s1");
    expect(t.settings.update(t.owner, id, { deskCount: 1 }).occupiedDesks).toEqual([1]);
    expect(t.seats(id)).toEqual(roomDeskSeatIds(1).sort());
  });

  test("a room still on a fixed template changes style but not desks", () => {
    const t = setup();
    const id = t.addOperation("office-small", 2, ["table-a-n1", "table-a-n2", "desk-1-seat"]);
    t.seat(id, "desk-1-seat");
    const info = t.settings.get(t.viewer, id);
    expect(info).toMatchObject({
      generated: false,
      occupiedDesks: [2],
      size: null,
      maxDeskCount: 2,
    });
    expect(failure(() => t.settings.update(t.owner, id, { deskCount: 3 }))).toBe(
      '409 room_not_generated {"legacyTemplate":true}',
    );
    expect(t.settings.update(t.owner, id, { decorStyle: "workshop" }).decorStyle).toBe("workshop");
    expect(t.seats(id)).toEqual(["desk-1-seat", "table-a-n1", "table-a-n2"]);
  });

  test("by default the size comes from the room's compound placement (#181)", () => {
    const t = setup();
    const id = t.addOperation(ROOM_LAYOUT_ID, 1, roomDeskSeatIds(1));
    t.db
      .update(operations)
      .set({ width: 4, depth: 4, doorSide: "east" })
      .where(eq(operations.id, id))
      .run();
    const placed = new RoomSettingsService({ db: t.db });
    expect(placed.get(t.owner, id)).toMatchObject({
      size: { width: 4, depth: 4, doorSide: "east" },
      maxDeskCount: 1,
    });
    expect(failure(() => placed.update(t.owner, id, { deskCount: 2 }))).toBe(
      '400 too_many_desks {"maxDeskCount":1}',
    );
    t.db.update(operations).set({ width: 30 }).where(eq(operations.id, id)).run();
    expect(placed.get(t.owner, id).size).toBeNull();
  });

  test("a generated room of unknown size cannot change desks", () => {
    const t = setup();
    const id = t.addOperation(ROOM_LAYOUT_ID, 1, roomDeskSeatIds(1));
    const blind = new RoomSettingsService({ db: t.db, sizeOf: () => null });
    expect(failure(() => blind.update(t.owner, id, { deskCount: 2 }))).toStartWith(
      "409 room_size_unknown",
    );
  });

  test("no change, no audit and no republish", () => {
    const t = setup();
    const id = t.addOperation(ROOM_LAYOUT_ID, 1, roomDeskSeatIds(1));
    t.settings.update(t.owner, id, { deskCount: 1, decorStyle: "ops_room" });
    expect(
      t.db.select().from(auditLog).where(eq(auditLog.action, "operation.room_settings")).all(),
    ).toEqual([]);
    expect(t.changed).toEqual([]);
  });

  test("syncDeskRows never drops an occupied seat", () => {
    const t = setup();
    const id = t.addOperation(ROOM_LAYOUT_ID, 2, roomDeskSeatIds(2));
    t.seat(id, "d2s1");
    syncDeskRows(t.db, id, 1);
    expect(t.seats(id)).toEqual([...roomDeskSeatIds(1), "d2s1"].sort());
  });
});
