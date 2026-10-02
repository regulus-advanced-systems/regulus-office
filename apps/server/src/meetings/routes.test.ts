/** Meeting REST (#50): sessions, same-origin writes, the capped body reader, the ACL over HTTP. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  MEETINGS_ACTIVE_PATH,
  MEETINGS_API_PATH,
  type MeetingDetail,
  type MeetingListResponse,
  type MeetingSummary,
  meetingActionPath,
  meetingPath,
} from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { desks, operationRepos, operations } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { createMeetings } from "./index.ts";
import { FakeHenchmen, FakeOutputs, FakeWorkspaces, startInput } from "./test-helpers.ts";

let office: Office;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let meetings: ReturnType<typeof createMeetings>;
const operationId = "op-1";
const repoId = "repo-1";

beforeAll(async () => {
  office = startOffice();
  owner = await office.signUp("Olga");
  member = await office.signUp("Mia");
  office.db
    .insert(operations)
    .values({
      id: operationId,
      name: "Demo",
      slug: "demo",
      index: 1,
      paletteId: "p",
      layoutTemplateId: "t",
    })
    .run();
  office.db
    .insert(operationRepos)
    .values({
      id: repoId,
      operationId,
      owner: "octo",
      name: "hello",
      url: "file:///dev/null",
      defaultBranch: "trunk",
      workdir: "/nonexistent",
      isPrimary: true,
      cloneStatus: "ready",
    })
    .run();
  for (const seatId of ["d1s1", "d1s2", "d1s3"])
    office.db.insert(desks).values({ operationId, seatId }).run();
  const fake = new FakeHenchmen(office.db);
  fake.behave = (call, f) => f.setStatus(call.agentId, "working");
  meetings = createMeetings({
    db: office.db,
    logger: createLogger({ level: "silent" }),
    rooms: { broadcast: () => true },
    henchmen: fake,
    workspaces: new FakeWorkspaces(),
    outputs: new FakeOutputs(),
    pollMs: 20,
  });
  fake.feed = (agentId, status) =>
    meetings.observer.statusChanged({ agentId, status } as never, "idle");
  meetings.mount(office.server.router, office.auth);
});

afterAll(async () => {
  meetings.close();
  await office.stop();
});

const post = (path: string, body: unknown, cookie?: string, origin?: string) =>
  office.request(path, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    cookie,
    headers: origin ? { origin } : undefined,
  });

describe("meeting routes", () => {
  let id = "";

  test("no session: 401 for reads and writes", async () => {
    expect((await office.request(`${MEETINGS_API_PATH}?operationId=${operationId}`)).status).toBe(
      401,
    );
    expect((await post(MEETINGS_API_PATH, startInput(operationId, repoId))).status).toBe(401);
  });

  test("a start is same-origin, capped and validated", async () => {
    const body = startInput(operationId, repoId);
    expect((await post(MEETINGS_API_PATH, body, owner.cookie, "https://evil.example")).status).toBe(
      403,
    );
    const huge = JSON.stringify({ ...body, topic: "x".repeat(200_000) });
    const tooLarge = await post(MEETINGS_API_PATH, huge, owner.cookie);
    expect(tooLarge.status).toBe(413);
    const invalid = await post(MEETINGS_API_PATH, { ...body, members: [] }, owner.cookie);
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: string }).error).toBe("invalid_body");
  });

  test("a member without access does not see the operation; the owner starts", async () => {
    const hidden = await post(MEETINGS_API_PATH, startInput(operationId, repoId), member.cookie);
    expect(hidden.status).toBe(404);
    const res = await post(MEETINGS_API_PATH, startInput(operationId, repoId), owner.cookie);
    expect(res.status).toBe(200);
    const summary = (await res.json()) as MeetingSummary;
    expect(summary.pattern).toBe("debate");
    id = summary.id;
  });

  test("reads: the list, live meetings, the detail with the transcript", async () => {
    const list = await office.request(`${MEETINGS_API_PATH}?operationId=${operationId}`, {
      cookie: owner.cookie,
    });
    expect(((await list.json()) as MeetingListResponse).meetings.map((m) => m.id)).toEqual([id]);
    const active = await office.request(MEETINGS_ACTIVE_PATH, { cookie: owner.cookie });
    expect(((await active.json()) as { meetings: MeetingSummary[] }).meetings).toHaveLength(1);
    const detail = await office.request(meetingPath(id), { cookie: owner.cookie });
    const body = (await detail.json()) as MeetingDetail;
    expect(body.canControl).toBe(true);
    expect(body.topic).toContain("Pick a cache");
    expect((await office.request(meetingPath(id), { cookie: member.cookie })).status).toBe(404);
  });

  test("actions: unknown is 404, others' are refused, the starter's go through", async () => {
    expect((await post(`${meetingPath(id)}/explode`, {}, owner.cookie)).status).toBe(404);
    expect((await post(meetingActionPath(id, "stop"), {}, member.cookie)).status).toBe(404);
    const cross = await post(
      meetingActionPath(id, "stop"),
      {},
      owner.cookie,
      "https://evil.example",
    );
    expect(cross.status).toBe(403);
    const stopped = await post(meetingActionPath(id, "stop"), {}, owner.cookie);
    expect(stopped.status).toBe(200);
    expect(((await stopped.json()) as MeetingSummary).status).toBe("stopped");
    const again = await post(meetingActionPath(id, "resume"), {}, owner.cookie);
    expect(again.status).toBe(409);
  });
});
