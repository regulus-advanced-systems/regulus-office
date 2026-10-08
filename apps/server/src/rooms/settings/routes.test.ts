/** Room settings over HTTP (#182), and what the OperationRoom publishes after a change. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OperationStateSchema, roomSettingsPath } from "@regulus/protocol";
import { ROOM_LAYOUT_ID, roomDeskSeatIds } from "@regulus/room-layout";
import { type Office, startOffice } from "../../auth/test-helpers.ts";
import { desks, operations } from "../../db/schema/index.ts";
import { seedRoomMember } from "../../github/access/test-snapshot.ts";
import { DrizzleOperationRoomSource } from "../operation/source.ts";
import { writeSnapshot } from "../operation/state.ts";
import { mountRoomSettingsRoutes } from "./routes.ts";
import { RoomSettingsService } from "./service.ts";

let office: Office;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let viewer: { id: string; cookie: string };
const changed: string[] = [];
const OPERATION = "operation-1";

beforeAll(async () => {
  office = startOffice();
  mountRoomSettingsRoutes(office.server.router, {
    auth: office.auth,
    settings: new RoomSettingsService({
      db: office.db,
      onChange: (id) => changed.push(id),
      sizeOf: () => ({ width: 8, depth: 8, doorSide: "west" }),
    }),
  });
  owner = await office.signUp("Olga");
  member = await office.signUp("Mia");
  viewer = await office.signUp("Val");
  office.db
    .insert(operations)
    .values({
      id: OPERATION,
      name: "Lair",
      slug: "lair",
      index: 1,
      paletteId: "p",
      layoutTemplateId: ROOM_LAYOUT_ID,
    })
    .run();
  office.db
    .insert(desks)
    .values(roomDeskSeatIds(1).map((seatId) => ({ operationId: OPERATION, seatId })))
    .run();
  // The room has a repo; the office owner manages it through GitHub, not by role (#270).
  seedRoomMember(office.db, owner.id, OPERATION, "manage");
  seedRoomMember(office.db, viewer.id, OPERATION, "view");
});

afterAll(async () => {
  await office.stop();
});

const path = roomSettingsPath(OPERATION);
const put = (body: unknown, cookie?: string, origin?: string) =>
  office.request(path, {
    method: "PUT",
    body: JSON.stringify(body),
    cookie,
    headers: origin ? { origin } : undefined,
  });

describe("room settings routes", () => {
  test("sign-in is required", async () => {
    expect((await office.request(path)).status).toBe(401);
    expect((await put({ deskCount: 2 })).status).toBe(401);
  });

  test("viewers read; strangers see nothing; only managers write", async () => {
    const read = await office.request(path, { cookie: viewer.cookie });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      deskCount: 1,
      decorStyle: "ops_room",
      canManage: false,
    });
    expect((await office.request(path, { cookie: member.cookie })).status).toBe(404);
    expect((await put({ decorStyle: "lab" }, member.cookie)).status).toBe(404);
    expect((await put({ decorStyle: "lab" }, viewer.cookie)).status).toBe(403);
    expect(changed).toEqual([]);
  });

  test("cross-origin writes and bad bodies are refused", async () => {
    expect((await put({ deskCount: 2 }, owner.cookie, "https://evil.example")).status).toBe(403);
    const bad = await put({ deskCount: 0, decorStyle: "disco" }, owner.cookie);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_body" });
    expect((await put({}, owner.cookie)).status).toBe(400);
    const tooMany = await put({ deskCount: 99 }, owner.cookie);
    expect(tooMany.status).toBe(400);
  });

  test("the owner changes desks and style; the OperationRoom snapshot carries them", async () => {
    const res = await put({ deskCount: 3, decorStyle: "war_room" }, owner.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      deskCount: 3,
      decorStyle: "war_room",
      generated: true,
      canManage: true,
      size: { width: 8, depth: 8, doorSide: "west" },
    });
    expect(changed).toEqual([OPERATION]);

    const snap = new DrizzleOperationRoomSource(office.db).loadOperation(OPERATION);
    expect(snap).toMatchObject({ deskCount: 3, decorStyle: "war_room" });
    expect(snap?.desks.map((d) => d.seatId).sort()).toEqual(roomDeskSeatIds(3).sort());
    const state = new OperationStateSchema();
    if (snap) writeSnapshot(state, snap);
    expect(state.deskCount).toBe(3);
    expect(state.decorStyle).toBe("war_room");
    expect(state.desks.size).toBe(12);
  });
});
