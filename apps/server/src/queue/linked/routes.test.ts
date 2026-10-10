/**
 * Linked task REST (#257): a session for every call, same origin for writes,
 * and answers that tell nothing about rooms the caller cannot see.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  LINKED_TASKS_API_PATH,
  LinkedTaskCreated,
  LinkedTaskListResponse,
  linkedNoteReleasePath,
  linkedTaskAutoNotesPath,
  linkedTaskStopPath,
} from "@regulus/protocol";
import { type Office, startOffice } from "../../auth/test-helpers.ts";
import { levels } from "../../db/schema/index.ts";
import { seedRoomMember } from "../../github/access/test-snapshot.ts";
import { logger } from "../test-helpers.ts";
import { mountLinkedTaskRoutes } from "./routes.ts";
import { API, addRoom, makeLinked, OPS, request, WEB } from "./test-helpers.ts";

let office: Office;
let ada: { id: string; cookie: string };
let wes: { id: string; cookie: string };

beforeAll(async () => {
  office = startOffice();
  const { linked } = makeLinked(office.db);
  mountLinkedTaskRoutes(office.server.router, { auth: office.auth, linked, logger });
  ada = await office.signUp("Ada");
  wes = await office.signUp("Wes");
  office.db
    .insert(levels)
    .values({ id: "level-octo", kind: "org", login: "octo", name: "octo", position: 1 })
    .run();
  for (const room of [WEB, API, OPS]) addRoom(office.db, room, "octo", "level-octo");
  for (const room of [WEB, API, OPS]) seedRoomMember(office.db, ada.id, room, "spawn");
  seedRoomMember(office.db, wes.id, WEB, "spawn");
});

afterAll(async () => {
  await office.stop();
});

const post = (path: string, cookie: string | undefined, body?: unknown, origin?: string) =>
  office.request(path, {
    method: "POST",
    cookie,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const list = (cookie: string | undefined, operationId: string) =>
  office.request(`${LINKED_TASKS_API_PATH}?operationId=${operationId}`, { cookie });

describe("linked task routes", () => {
  test("anonymous 401; a cross-origin write 403; a bad body 400", async () => {
    expect((await list(undefined, WEB)).status).toBe(401);
    expect((await post(LINKED_TASKS_API_PATH, undefined, request([WEB, API]))).status).toBe(401);
    expect(
      (await post(LINKED_TASKS_API_PATH, ada.cookie, request([WEB, API]), "https://evil.example"))
        .status,
    ).toBe(403);
    expect((await post(LINKED_TASKS_API_PATH, ada.cookie, request([WEB]))).status).toBe(400);
  });

  test("create, list per viewer, stop by the owner only", async () => {
    // Wes cannot work in api: refused, with no word on which room.
    const refused = await post(LINKED_TASKS_API_PATH, wes.cookie, request([WEB, API]));
    expect(refused.status).toBe(403);
    expect(JSON.stringify(await refused.json())).not.toContain("api");

    const res = await post(LINKED_TASKS_API_PATH, ada.cookie, request([WEB, API]));
    expect(res.status).toBe(200);
    const created = LinkedTaskCreated.parse(await res.json());
    expect(created.taskIds).toHaveLength(2);

    const mine = LinkedTaskListResponse.parse(await (await list(ada.cookie, WEB)).json());
    expect(mine.tasks.map((t) => t.id)).toEqual([created.id]);
    expect((await list(ada.cookie, WEB)).headers.get("cache-control")).toBe("no-store");

    // Wes sees web only: the same answer as for a room without linked tasks or one he cannot see.
    for (const room of [WEB, API, OPS, "no-such-room"]) {
      const answer = await list(wes.cookie, room);
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ tasks: [] });
    }

    // The notes belong to the owner: nobody else gets them, passes them on or turns that on.
    expect("notes" in (mine.tasks[0] ?? {})).toBe(true);
    const put = (cookie: string, on: boolean) =>
      office.request(linkedTaskAutoNotesPath(created.id), {
        method: "PUT",
        cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on }),
      });
    expect((await put(wes.cookie, true)).status).toBe(404);
    expect((await post(linkedNoteReleasePath(created.id, "n1"), wes.cookie)).status).toBe(404);
    expect((await put(ada.cookie, true)).status).toBe(200);
    expect((await post(linkedNoteReleasePath(created.id, "no-such-note"), ada.cookie)).status).toBe(
      404,
    );
    const after = LinkedTaskListResponse.parse(await (await list(ada.cookie, WEB)).json());
    expect(after.tasks[0]?.autoNotes).toBe(true);

    expect((await post(linkedTaskStopPath(created.id), wes.cookie)).status).toBe(404);
    expect((await post(linkedTaskStopPath("nope"), wes.cookie)).status).toBe(404);
    const stopped = await post(linkedTaskStopPath(created.id), ada.cookie);
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ id: created.id, stopped: 2, refused: 0 });
  });
});
