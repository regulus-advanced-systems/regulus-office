/**
 * `createChecked` (#270): a room is built only for a repo its creator's own
 * GitHub account can see, and is theirs to enter the moment it exists.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubRepoPermission } from "@regulus/protocol";
import { AuthHttpError } from "../auth/errors.ts";
import { githubRepoPermissions, operations as operationRows } from "../db/schema/index.ts";
import { seedGitHubLink } from "../github/access/test-snapshot.ts";
import { createLogger } from "../logging.ts";
import { createOperations, type NewRoomAccess } from "./index.ts";
import { makeBareRepo, testDb } from "./test-helpers.ts";

let root: string;
let remoteBase: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-create-checked-"));
  remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello", "trunk");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

type Answer = GitHubRepoPermission | "not_linked" | "unavailable";

/** An office whose `newRoomAccess` answers what the test says GitHub would. */
function setup(answer: Answer | null) {
  const { db, addUser } = testDb();
  const asked: { userId: string; repo: string }[] = [];
  const roomsCreated: string[] = [];
  const newRoomAccess: NewRoomAccess = {
    permissionOf: async (userId, repo) => {
      asked.push({ userId, repo: `${repo.owner}/${repo.name}` });
      return answer ?? "none";
    },
    roomCreated: (repoId) => roomsCreated.push(repoId),
  };
  const { service, cloner } = createOperations({
    db,
    logger: createLogger({ level: "silent" }),
    config: {
      projectsDir: join(root, `projects-${crypto.randomUUID().slice(0, 8)}`),
      githubRemoteBase: remoteBase,
    },
    keyring: undefined,
    newRoomAccess: answer === null ? undefined : newRoomAccess,
  });
  const owner = addUser("Olga", "owner");
  const admin = addUser("Adam", "admin");
  const member = addUser("Mia", "member");
  return { db, service, cloner, asked, roomsCreated, owner, admin, member };
}

const input = (repo = "octo/hello") => ({
  name: "Apollo",
  tier: "small" as const,
  repos: [{ repo }],
});

const code = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (err) {
    if (err instanceof AuthHttpError) return `${err.status} ${err.code}`;
    throw err;
  }
  return "ok";
};

describe("OperationService.createChecked", () => {
  test("without a linked GitHub account no room is built", async () => {
    const t = setup("not_linked");
    expect(await code(() => t.service.createChecked(t.owner, input()))).toBe(
      "403 github_link_required",
    );
    expect(t.asked).toEqual([{ userId: t.owner.id, repo: "octo/hello" }]);
    expect(t.db.select().from(operationRows).all()).toEqual([]);
    expect(t.roomsCreated).toEqual([]);
  });

  test("a repo the creator's GitHub account cannot see gets no room, office owner or not", async () => {
    const t = setup("none");
    seedGitHubLink(t.db, t.owner.id);
    expect(await code(() => t.service.createChecked(t.owner, input()))).toBe(
      "403 repo_not_visible",
    );
    expect(t.db.select().from(operationRows).all()).toEqual([]);
    expect(t.roomsCreated).toEqual([]);
  });

  test("when GitHub cannot be asked the answer is 503 and nothing is built", async () => {
    const t = setup("unavailable");
    seedGitHubLink(t.db, t.owner.id);
    expect(await code(() => t.service.createChecked(t.owner, input()))).toBe(
      "503 github_unavailable",
    );
    expect(t.db.select().from(operationRows).all()).toEqual([]);
    expect(t.roomsCreated).toEqual([]);
  });

  test("write on the repo: the room is created and is its creator's to work in at once", async () => {
    const t = setup("write");
    seedGitHubLink(t.db, t.admin.id);
    const { operation, cloned } = await t.service.createChecked(t.admin, input());
    await cloned;
    const repoId = operation.repos[0]?.repoId ?? "";
    expect(operation.access).toBe("spawn");
    expect(t.db.select().from(githubRepoPermissions).all()).toMatchObject([
      { userId: t.admin.id, repoId, permission: "write" },
    ]);
    expect(t.service.get(t.admin, operation.operationId).access).toBe("spawn");
    expect(t.service.list(t.admin).map((o) => o.operationId)).toEqual([operation.operationId]);
    // Everyone else's snapshot is refreshed for the new repo, once.
    expect(t.roomsCreated).toEqual([repoId]);
    // The office owner did not create it and GitHub has said nothing about them: closed.
    seedGitHubLink(t.db, t.owner.id);
    expect(t.service.list(t.owner)).toEqual([]);
    expect(await code(async () => t.service.get(t.owner, operation.operationId))).toBe(
      "404 operation_not_found",
    );
  });

  test("the office role is still needed, and is checked before GitHub is asked", async () => {
    const t = setup("admin");
    seedGitHubLink(t.db, t.member.id);
    expect(await code(() => t.service.createChecked(t.member, input()))).toBe(
      "403 owner_or_admin_required",
    );
    expect(t.asked).toEqual([]);
  });

  test("malformed input gets create's refusals without asking GitHub", async () => {
    const t = setup("admin");
    expect(
      await code(() => t.service.createChecked(t.owner, input("https://gitlab.com/o/r"))),
    ).toBe("400 unsupported_host");
    const two = { ...input(), repos: [{ repo: "octo/hello" }, { repo: "octo/tools" }] };
    expect(await code(() => t.service.createChecked(t.owner, two))).toBe("400 one_repo_per_room");
    expect(t.asked).toEqual([]);
  });

  test("without the GitHub check wired in, a new room is closed to everyone, its creator included", async () => {
    const t = setup(null);
    seedGitHubLink(t.db, t.owner.id);
    const { operation, cloned } = await t.service.createChecked(t.owner, input());
    await cloned;
    expect(t.db.select().from(githubRepoPermissions).all()).toEqual([]);
    expect(t.service.list(t.owner)).toEqual([]);
    expect(await code(async () => t.service.get(t.owner, operation.operationId))).toBe(
      "404 operation_not_found",
    );
  });
});
