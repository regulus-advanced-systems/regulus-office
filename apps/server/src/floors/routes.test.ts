/** HTTP surface of floors over a real server with Better Auth sessions. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FloorInfo } from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { createLogger } from "../logging.ts";
import { createFloors, type Floors, mountFloorRoutes } from "./index.ts";
import { FAKE_PAT, makeBareRepo } from "./test-helpers.ts";

let root: string;
let office: Office;
let floors: Floors;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-floor-routes-"));
  const remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello");
  office = startOffice();
  floors = createFloors({
    db: office.db,
    logger: createLogger({ level: "silent" }),
    config: { projectsDir: join(root, "projects"), githubRemoteBase: remoteBase },
    keyring: { current: 1, keys: { 1: randomBytes(32) } },
  });
  mountFloorRoutes(office.server.router, { auth: office.auth, floors: floors.service });
  owner = await office.signUp("Olga"); // first account: owner
  member = await office.signUp("Mia"); // then: member
});

afterAll(async () => {
  await floors.cloner.idle();
  await office.stop();
  await rm(root, { recursive: true, force: true });
});

const get = (path: string, cookie?: string) => office.request(path, { cookie });
const send = (method: string, path: string, body: unknown, cookie?: string, origin?: string) =>
  office.request(path, {
    method,
    body: JSON.stringify(body),
    cookie,
    headers: origin ? { origin } : undefined,
  });

describe("floor routes", () => {
  let floor: FloorInfo;

  test("anonymous callers get 401", async () => {
    expect((await get("/api/floors")).status).toBe(401);
  });

  test("members cannot create floors; bad bodies name fields, not values", async () => {
    const denied = await send(
      "POST",
      "/api/floors",
      { name: "X", repos: [{ repo: "o/r" }] },
      member.cookie,
    );
    expect(denied.status).toBe(403);
    const bad = await send(
      "POST",
      "/api/floors",
      { name: "X", repos: [{ repo: "octo/hello", token: `bad token ${FAKE_PAT}` }] },
      owner.cookie,
    );
    expect(bad.status).toBe(400);
    const text = await bad.text();
    expect(text).toContain("repos.0.token");
    expect(text).not.toContain(FAKE_PAT);
  });

  test("cross-origin writes are refused", async () => {
    const res = await send(
      "POST",
      "/api/floors",
      { name: "X", repos: [{ repo: "octo/hello" }] },
      owner.cookie,
      "https://evil.example",
    );
    expect(res.status).toBe(403);
  });

  test("the owner creates a floor; the token is never returned", async () => {
    const res = await send(
      "POST",
      "/api/floors",
      { name: "Apollo", tier: "small", repos: [{ repo: "octo/hello", token: FAKE_PAT }] },
      owner.cookie,
    );
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(FAKE_PAT);
    expect(text).not.toContain("encrypted");
    floor = JSON.parse(text) as FloorInfo;
    expect(floor.repos[0]).toMatchObject({ owner: "octo", name: "hello", hasCredential: true });
    await floors.cloner.idle();
    const again = (await (
      await get(`/api/floors/${floor.floorId}`, owner.cookie)
    ).json()) as FloorInfo;
    expect(again.repos[0]?.cloneStatus).toBe("ready");
  });

  test("the list is filtered by membership; members are managed over REST", async () => {
    const before = (await (await get("/api/floors", member.cookie)).json()) as {
      floors: FloorInfo[];
    };
    expect(before.floors).toEqual([]);
    expect((await get(`/api/floors/${floor.floorId}`, member.cookie)).status).toBe(404);

    const put = await send(
      "PUT",
      `/api/floors/${floor.floorId}/members/${member.id}`,
      { access: "view" },
      owner.cookie,
    );
    expect(put.status).toBe(204);
    const after = (await (await get("/api/floors", member.cookie)).json()) as {
      floors: FloorInfo[];
    };
    expect(after.floors.map((f) => [f.floorId, f.access])).toEqual([[floor.floorId, "view"]]);
    const members = await (await get(`/api/floors/${floor.floorId}/members`, owner.cookie)).json();
    expect(members).toEqual({
      members: [{ userId: member.id, displayName: "Mia", access: "view" }],
    });
    expect((await get(`/api/floors/${floor.floorId}/members`, member.cookie)).status).toBe(403);

    const del = await office.request(`/api/floors/${floor.floorId}/members/${member.id}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    expect(del.status).toBe(204);
  });

  test("retrying a ready repo conflicts; archive removes the floor", async () => {
    const repoId = floor.repos[0]?.repoId;
    const retry = await send(
      "POST",
      `/api/floors/${floor.floorId}/repos/${repoId}/clone`,
      {},
      owner.cookie,
    );
    expect(retry.status).toBe(409);
    const archived = await send("POST", `/api/floors/${floor.floorId}/archive`, {}, owner.cookie);
    expect(archived.status).toBe(204);
    const list = (await (await get("/api/floors", owner.cookie)).json()) as { floors: FloorInfo[] };
    expect(list.floors).toEqual([]);
  });
});
