/**
 * Two people, one office (SPEC D26, D27; #270), against the real server in
 * production mode with GitHub played by the fake (./office.fixture.ts). What
 * the route walk does for REST, this does for everything that stays open:
 * the BuildingRoom's state, OperationRoom joins, the whiteboard, terminal
 * and screen sockets. Then GitHub takes access away and gives it, and the
 * office has to follow at once.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, type Room } from "@colyseus/sdk";
import {
  ACCESS_CLOSE_CODES,
  BuildingStateSchema,
  emergencyStopUserPath,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  OperationStateSchema,
  ROOM_NAMES,
} from "@regulus/protocol";
import { type Person, waitFor } from "./office.fixture.ts";
import { MARKERS, type Scenario, startScenario } from "./scenario.fixture.ts";

type Building = Room<unknown, InstanceType<typeof BuildingStateSchema>>;

let s: Scenario;
const opened: { leave(): Promise<unknown> }[] = [];

beforeAll(async () => {
  s = await startScenario();
}, 60_000);
afterAll(async () => {
  await Promise.all(opened.map((room) => Promise.race([room.leave(), Bun.sleep(200)])));
  await s?.stop();
});

const colyseus = (who: Person) =>
  new Client(s.office.origin, { headers: { cookie: who.cookie, origin: s.office.origin } });

async function building(who: Person): Promise<Building> {
  const room: Building = await colyseus(who).joinOrCreate(
    ROOM_NAMES.building,
    {},
    BuildingStateSchema,
  );
  opened.push(room);
  return room;
}

const wire = (room: Building) => JSON.stringify(room.state.toJSON());
const keys = (room: Building, field: "operations" | "closedRooms" | "levels") =>
  Object.keys((room.state.toJSON() as unknown as Record<string, object>)[field] ?? {}).sort();

/** Try to open a WebSocket as `who`; resolves how it ended: "open" or the refusal. */
function socket(who: Person, path: string): Promise<{ opened: boolean; ws: WebSocket }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${s.office.wsOrigin}${path}`, {
      headers: { cookie: who.cookie, origin: s.office.origin },
    } as unknown as string[]);
    ws.onopen = () => resolve({ opened: true, ws });
    ws.onerror = () => resolve({ opened: false, ws });
    ws.onclose = () => resolve({ opened: false, ws });
  });
}

const joinRoom = (who: Person, operationId: string) =>
  colyseus(who).joinOrCreate(ROOM_NAMES.operation, { operationId }, OperationStateSchema);

describe("live state for two people", () => {
  let mia: Building;
  let gus: Building;
  let olga: Building;
  let ned: Building;

  test("the building state is each person's own", async () => {
    mia = await building(s.mia);
    gus = await building(s.gus);
    olga = await building(s.olga);
    ned = await building(s.ned);
    await waitFor(() => keys(mia, "operations").length === 4, "Mia's rooms");
    await waitFor(() => keys(gus, "operations").length === 2, "Gus's rooms");
    await Bun.sleep(200);

    expect(keys(gus, "operations")).toEqual([LOBBY_OPERATION_ID, s.alpha.operationId].sort());
    expect(keys(gus, "closedRooms")).toEqual([s.bravo.operationId]);
    expect(keys(gus, "levels")).toEqual([LOBBY_LEVEL_ID, s.alpha.levelId].sort());
    // Bravo, seen from outside: where it stands, and that it is closed. Nothing else.
    const closed = (gus.state.toJSON() as unknown as { closedRooms: Record<string, object> })
      .closedRooms[s.bravo.operationId];
    expect(Object.keys(closed ?? {}).sort()).toEqual(
      [
        "closed",
        "depth",
        "doorSide",
        "doorX",
        "doorY",
        "gridX",
        "gridY",
        "levelId",
        "operationId",
        "width",
      ].sort(),
    );

    for (const room of [olga, ned]) {
      expect(keys(room, "operations")).toEqual([LOBBY_OPERATION_ID]);
      expect(keys(room, "closedRooms")).toEqual([]);
      expect(keys(room, "levels")).toEqual([LOBBY_LEVEL_ID]);
      for (const id of [s.alpha, s.bravo, s.charlie].flatMap((r) => [r.operationId, r.levelId])) {
        expect(wire(room)).not.toContain(id);
      }
    }
    for (const room of [gus, olga, ned]) {
      for (const marker of MARKERS) expect(wire(room)).not.toContain(marker);
      expect(wire(room)).not.toContain(s.charlie.operationId);
      expect(wire(room)).not.toContain(s.charlie.levelId);
    }
    // The person who may see them does: names, and the waiting henchman's count.
    const bravo = (mia.state.toJSON() as unknown as { operations: Record<string, object> })
      .operations[s.bravo.operationId];
    expect(bravo).toMatchObject({ name: "Bravo-secret", henchmenWaiting: 1, henchmenTotal: 1 });
  }, 30_000);

  test("a closed room's own room, board, terminal and screens do not open", async () => {
    for (const who of [s.gus, s.olga, s.ned]) {
      for (const room of [s.bravo, s.charlie]) {
        await expect(joinRoom(who, room.operationId)).rejects.toThrow();
        for (const path of [
          `/ws/wb/${room.operationId}`,
          `/ws/term/${room.agentId}?mode=watch`,
          `/ws/term/${room.agentId}?mode=control`,
          `/ws/screens/${room.operationId}`,
        ]) {
          const attempt = await socket(who, path);
          attempt.ws.close();
          expect(`${who.name} ${path}: opened=${attempt.opened}`).toBe(
            `${who.name} ${path}: opened=false`,
          );
        }
      }
    }
    // The office owner and the unlinked admin do not get into Alpha either.
    await expect(joinRoom(s.olga, s.alpha.operationId)).rejects.toThrow();
    await expect(joinRoom(s.ned, s.alpha.operationId)).rejects.toThrow();
    // Gus does, and Mia gets into Bravo: the refusals above are about access.
    const alpha = await joinRoom(s.gus, s.alpha.operationId);
    opened.push(alpha);
    const bravo = await joinRoom(s.mia, s.bravo.operationId);
    opened.push(bravo);
    const board = await socket(s.mia, `/ws/wb/${s.bravo.operationId}`);
    expect(board.opened).toBe(true);
    board.ws.close();
  }, 30_000);

  test("live changes in a closed room reach only the people who may see it", async () => {
    const put = await s.office.call(
      s.mia,
      "PUT",
      `/api/operations/${s.charlie.operationId}/room-settings`,
      { deskCount: 3, decorStyle: "lab" },
    );
    expect(put.status).toBe(200);
    const charlie = () =>
      (mia.state.toJSON() as unknown as { operations: Record<string, { deskCount: number }> })
        .operations[s.charlie.operationId];
    await waitFor(() => charlie()?.deskCount === 3, "Mia to see Charlie's new desks");
    await Bun.sleep(200);
    for (const room of [gus, olga, ned]) {
      expect(wire(room)).not.toContain(s.charlie.operationId);
      for (const marker of MARKERS) expect(wire(room)).not.toContain(marker);
    }
  });

  test("GitHub takes Gus's access away: the room closes and his connections end at once", async () => {
    const seat = await joinRoom(s.gus, s.alpha.operationId);
    const left = new Promise<number>((resolve) => seat.onLeave((code) => resolve(code)));
    const board = await socket(s.gus, `/ws/wb/${s.alpha.operationId}`);
    expect(board.opened).toBe(true);
    const boardClosed = new Promise<number>((resolve) => {
      board.ws.onclose = (event) => resolve(event.code);
    });
    gus.send("operation.go", { operationId: s.alpha.operationId });
    const self = () =>
      (gus.state.toJSON() as unknown as { humans: Record<string, { operationId: string }> }).humans[
        gus.sessionId
      ];
    await waitFor(() => self()?.operationId === s.alpha.operationId, "Gus in Alpha");

    // An org admin removes him on GitHub; the office hears of it on the next check.
    s.office.setPermission("gus", "mia/alpha", "none");
    await s.office.checkNow(s.gus);

    expect(await left).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(await boardClosed).toBe(ACCESS_CLOSE_CODES.revoked);
    await waitFor(() => keys(gus, "operations").length === 1, "Gus's rooms to close");
    expect(keys(gus, "levels")).toEqual([LOBBY_LEVEL_ID]);
    expect(keys(gus, "closedRooms")).toEqual([]);
    expect(self()?.operationId).toBe(LOBBY_OPERATION_ID);
    await Bun.sleep(200);
    expect(wire(gus)).not.toContain(s.alpha.operationId);
    expect(
      (await s.office.call(s.gus, "GET", `/api/operations/${s.alpha.operationId}`)).status,
    ).toBe(404);
    await expect(joinRoom(s.gus, s.alpha.operationId)).rejects.toThrow();
  }, 30_000);

  test("GitHub gives access: the room opens without a reload, for the office owner too", async () => {
    s.office.setPermission("olga", "octo-corp/charlie-secret", "write");
    await s.office.checkNow(s.olga);
    await waitFor(
      () => keys(olga, "operations").includes(s.charlie.operationId),
      "Charlie for Olga",
    );
    expect(keys(olga, "levels")).toEqual([LOBBY_LEVEL_ID, s.charlie.levelId].sort());
    const got = await s.office.call(s.olga, "GET", `/api/operations/${s.charlie.operationId}`);
    expect(((await got.json()) as { access: string }).access).toBe("spawn");
    // Still nothing of Mia's own level.
    expect(wire(olga)).not.toContain(s.bravo.operationId);
    expect(wire(olga)).not.toContain("Bravo-secret");
  }, 30_000);

  test("a revoked link empties everything the person had", async () => {
    s.office.revoke("olga");
    await s.office.checkNow(s.olga);
    await waitFor(() => keys(olga, "operations").length === 1, "Olga back to the lobby");
    const link = (await (await s.office.call(s.olga, "GET", "/api/github/link")).json()) as {
      state: string;
      repos: unknown[];
    };
    expect(link).toMatchObject({ state: "revoked", repos: [] });
    expect(
      (await s.office.call(s.olga, "GET", `/api/operations/${s.charlie.operationId}`)).status,
    ).toBe(404);
  }, 30_000);
});

describe("what the office role still does, and does not", () => {
  test("no room for a repo the creator's own account cannot see, or without a link", async () => {
    const unlinked = await s.office.call(s.ned, "POST", "/api/operations", {
      name: "Ned's",
      repos: [{ repo: "mia/alpha" }],
    });
    expect(unlinked.status).toBe(403);
    expect(((await unlinked.json()) as { error: string }).error).toBe("github_link_required");
    // Olga's link was revoked above: the same answer.
    const revoked = await s.office.call(s.olga, "POST", "/api/operations", {
      name: "Olga's",
      repos: [{ repo: "mia/bravo-secret" }],
    });
    expect(revoked.status).toBe(403);
    // The repo picker lists nothing for someone without a link.
    const picker = await s.office.call(s.ned, "GET", "/api/github/repos");
    expect(picker.status).toBe(403);
    expect(await picker.text()).not.toContain("alpha");
  });

  test("emergency stop is an action on a person: a count comes back, nothing about rooms", async () => {
    const path = emergencyStopUserPath(s.mia.id);
    expect((await s.office.call(s.gus, "POST", path)).status).toBe(403);
    expect((await s.office.call(null, "POST", path)).status).toBe(401);
    const res = await s.office.call(s.ned, "POST", path);
    expect(res.status).toBe(200);
    const text = await res.text();
    // No runner in this office, so nothing was running; the shape is the point.
    expect(JSON.parse(text)).toEqual({ stopped: 0, failed: 0 });
    for (const marker of MARKERS) expect(text).not.toContain(marker);
    expect((await s.office.call(s.ned, "POST", emergencyStopUserPath("no-such-user"))).status).toBe(
      404,
    );
  });

  test("office management stays: people and roles, with no room in the answers", async () => {
    const users = await s.office.call(s.ned, "GET", "/api/users");
    expect(users.status).toBe(200);
    const text = await users.text();
    expect(text).toContain("Mia");
    for (const marker of MARKERS) expect(text).not.toContain(marker);
    expect((await s.office.call(s.gus, "GET", "/api/users")).status).toBe(403);
  });
});
