/** HTTP surface of operations over a real server with Better Auth sessions. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubRepoPermission, OperationInfo } from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { githubRepoPermissions } from "../db/schema/index.ts";
import { seedGitHubLink, seedRoomMember } from "../github/access/test-snapshot.ts";
import { createLogger } from "../logging.ts";
import { createOperations, mountOperationRoutes, type Operations } from "./index.ts";
import { FAKE_PAT, makeBareRepo } from "./test-helpers.ts";

let root: string;
let office: Office;
let operations: Operations;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
/** What GitHub says the creator may do on the repo of a new room (the `newRoomAccess` dep, #270). */
let creatorMay: GitHubRepoPermission | "not_linked" | "unavailable" = "admin";
const roomsCreated: string[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-operation-routes-"));
  const remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello");
  office = startOffice();
  operations = createOperations({
    db: office.db,
    logger: createLogger({ level: "silent" }),
    config: { projectsDir: join(root, "projects"), githubRemoteBase: remoteBase },
    keyring: { current: 1, keys: { 1: randomBytes(32) } },
    newRoomAccess: {
      permissionOf: async () => creatorMay,
      roomCreated: (repoId) => roomsCreated.push(repoId),
    },
  });
  mountOperationRoutes(office.server.router, { auth: office.auth, operations: operations.service });
  owner = await office.signUp("Olga"); // first account: owner
  member = await office.signUp("Mia"); // then: member
  seedGitHubLink(office.db, owner.id);
});

afterAll(async () => {
  await operations.cloner.idle();
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

describe("operation routes", () => {
  let operation: OperationInfo;

  test("anonymous callers get 401", async () => {
    expect((await get("/api/operations")).status).toBe(401);
  });

  test("members cannot create operations; bad bodies name fields, not values", async () => {
    const denied = await send(
      "POST",
      "/api/operations",
      { name: "X", repos: [{ repo: "o/r" }] },
      member.cookie,
    );
    expect(denied.status).toBe(403);
    const bad = await send(
      "POST",
      "/api/operations",
      { name: "X", repos: [{ repo: "octo/hello", token: `bad token ${FAKE_PAT}` }] },
      owner.cookie,
    );
    expect(bad.status).toBe(400);
    const text = await bad.text();
    expect(text).toContain("repos.0.token");
    expect(text).not.toContain(FAKE_PAT);
  });

  test("several repos for one room are refused with what to do instead (#268)", async () => {
    const res = await send(
      "POST",
      "/api/operations",
      { name: "Two", repos: [{ repo: "octo/hello" }, { repo: "octo/tools" }] },
      owner.cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "one_repo_per_room",
      message: "A room has exactly one repo. Add another room for each other repo.",
    });
  });

  test("cross-origin writes are refused", async () => {
    const res = await send(
      "POST",
      "/api/operations",
      { name: "X", repos: [{ repo: "octo/hello" }] },
      owner.cookie,
      "https://evil.example",
    );
    expect(res.status).toBe(403);
  });

  test("no room for a repo the owner's own GitHub account cannot see (#270)", async () => {
    const create = async (answer: typeof creatorMay) => {
      creatorMay = answer;
      const res = await send(
        "POST",
        "/api/operations",
        { name: "Apollo", tier: "small", repos: [{ repo: "octo/hello" }] },
        owner.cookie,
      );
      creatorMay = "admin";
      return [res.status, ((await res.json()) as { error: string }).error];
    };
    expect(await create("not_linked")).toEqual([403, "github_link_required"]);
    expect(await create("none")).toEqual([403, "repo_not_visible"]);
    expect(await create("unavailable")).toEqual([503, "github_unavailable"]);
    expect(await (await get("/api/operations", owner.cookie)).json()).toEqual({ operations: [] });
    expect(roomsCreated).toEqual([]);
  });

  test("the owner creates an operation; the token is never returned", async () => {
    const res = await send(
      "POST",
      "/api/operations",
      { name: "Apollo", tier: "small", repos: [{ repo: "octo/hello", token: FAKE_PAT }] },
      owner.cookie,
    );
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(FAKE_PAT);
    expect(text).not.toContain("encrypted");
    operation = JSON.parse(text) as OperationInfo;
    expect(operation.repos[0]).toMatchObject({ owner: "octo", name: "hello", hasCredential: true });
    // The room is its creator's at once: their GitHub permission was stored with it.
    expect(operation.access).toBe("manage");
    const repoId = operation.repos[0]?.repoId ?? "";
    expect(office.db.select().from(githubRepoPermissions).all()).toMatchObject([
      { userId: owner.id, repoId, permission: "admin" },
    ]);
    expect(roomsCreated).toEqual([repoId]);
    await operations.cloner.idle();
    const again = (await (
      await get(`/api/operations/${operation.operationId}`, owner.cookie)
    ).json()) as OperationInfo;
    expect(again.repos[0]?.cloneStatus).toBe("ready");
  });

  test("the list is filtered by GitHub access; member rows only narrow, managed over REST", async () => {
    const before = (await (await get("/api/operations", member.cookie)).json()) as {
      operations: OperationInfo[];
    };
    expect(before.operations).toEqual([]);
    expect((await get(`/api/operations/${operation.operationId}`, member.cookie)).status).toBe(404);

    const put = await send(
      "PUT",
      `/api/operations/${operation.operationId}/members/${member.id}`,
      { access: "view" },
      owner.cookie,
    );
    expect(put.status).toBe(204);
    const listed = async () => {
      const body = (await (await get("/api/operations", member.cookie)).json()) as {
        operations: OperationInfo[];
      };
      return body.operations.map((f) => [f.operationId, f.access]);
    };
    // The member row alone opens nothing: Mia's GitHub account cannot see the repo.
    expect(await listed()).toEqual([]);
    expect((await get(`/api/operations/${operation.operationId}`, member.cookie)).status).toBe(404);
    // With write on the repo she is in, held at `view` by the row.
    seedRoomMember(office.db, member.id, operation.operationId, "spawn");
    expect(await listed()).toEqual([[operation.operationId, "view"]]);
    const members = await (
      await get(`/api/operations/${operation.operationId}/members`, owner.cookie)
    ).json();
    expect(members).toEqual({
      members: [{ userId: member.id, displayName: "Mia", access: "view" }],
    });
    expect(
      (await get(`/api/operations/${operation.operationId}/members`, member.cookie)).status,
    ).toBe(403);

    const del = await office.request(
      `/api/operations/${operation.operationId}/members/${member.id}`,
      {
        method: "DELETE",
        cookie: owner.cookie,
      },
    );
    expect(del.status).toBe(204);
    // The limit is lifted: what GitHub gives is what she has.
    expect(await listed()).toEqual([[operation.operationId, "spawn"]]);
  });

  test("retrying a ready repo conflicts; archive removes the operation", async () => {
    const repoId = operation.repos[0]?.repoId;
    const retry = await send(
      "POST",
      `/api/operations/${operation.operationId}/repos/${repoId}/clone`,
      {},
      owner.cookie,
    );
    expect(retry.status).toBe(409);
    const archived = await send(
      "POST",
      `/api/operations/${operation.operationId}/archive`,
      {},
      owner.cookie,
    );
    expect(archived.status).toBe(204);
    const list = (await (await get("/api/operations", owner.cookie)).json()) as {
      operations: OperationInfo[];
    };
    expect(list.operations).toEqual([]);
  });

  test("a creator with write on the repo gets a room to work in, not to manage", async () => {
    creatorMay = "write";
    const res = await send(
      "POST",
      "/api/operations",
      { name: "Gemini", tier: "small", repos: [{ repo: "octo/hello" }] },
      owner.cookie,
    );
    creatorMay = "admin";
    expect(res.status).toBe(201);
    const created = (await res.json()) as OperationInfo;
    expect(created.access).toBe("spawn");
    expect(roomsCreated.at(-1)).toBe(created.repos[0]?.repoId ?? "");
    await operations.cloner.idle();
    const path = `/api/operations/${created.operationId}`;
    expect(((await (await get(path, owner.cookie)).json()) as OperationInfo).access).toBe("spawn");
    // The office owner role adds nothing on top: members are for `manage`.
    expect((await get(`${path}/members`, owner.cookie)).status).toBe(403);
    expect((await get(path, member.cookie)).status).toBe(404);
  });
});

describe("body caps (#240)", () => {
  /** A chunked body (no Content-Length) that would be 32 MB; counts what was produced. */
  const chunked = () => {
    const state = { produced: 0 };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (state.produced >= 32 * 1024 * 1024) return controller.close();
        state.produced += 16 * 1024;
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
      },
    });
    return { state, stream };
  };

  test("a chunked oversize create is refused with 413 before it is buffered", async () => {
    const body = chunked();
    const res = await office.request("/api/operations", {
      method: "POST",
      body: body.stream,
      cookie: owner.cookie,
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "body_too_large" });
    expect(body.state.produced).toBeLessThan(8 * 1024 * 1024);
  });

  test("a declared oversize create is refused with 413", async () => {
    const res = await send("POST", "/api/operations", { pad: "x".repeat(70 * 1024) }, owner.cookie);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "body_too_large" });
  });

  test("Better Auth bodies are capped too", async () => {
    const body = chunked();
    const res = await office.request("/api/auth/sign-in/email", {
      method: "POST",
      body: body.stream,
    });
    expect(res.status).toBe(413);
    expect(body.state.produced).toBeLessThan(8 * 1024 * 1024);
  });
});
