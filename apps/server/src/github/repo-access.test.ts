/** Token selection for server-side git and PRs (#141): connection, else the repo's PAT, else none. */
import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFloors } from "../floors/index.ts";
import { FAKE_PAT, makeBareRepo, testDb } from "../floors/test-helpers.ts";
import { createLogger } from "../logging.ts";
import { RepoCredentialError } from "./credentials.ts";
import type { GitRunOptions } from "./git.ts";
import { runGit } from "./git.ts";
import { GitHubApiError } from "./pulls.ts";
import type { ConnectionTokens } from "./repo-access.ts";

const CONN_TOKEN = "ghs_connectionFakeToken0123456789";
const roots: string[] = [];
afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

async function floorWith(connection: ConnectionTokens | undefined, repoToken: boolean) {
  const root = await mkdtemp(join(tmpdir(), "office-repo-access-"));
  roots.push(root);
  const remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello");
  const { db, addUser } = testDb();
  const tokensSeen: (string | null | undefined)[] = [];
  const floors = createFloors({
    db,
    logger: createLogger({ level: "silent" }),
    config: { projectsDir: join(root, "projects"), githubRemoteBase: remoteBase },
    keyring: { current: 1, keys: { 1: randomBytes(32) } },
    connection,
    git: (args, opts?: GitRunOptions) => {
      if (args[0] === "clone") tokensSeen.push(opts?.token);
      return runGit(args, opts);
    },
  });
  const created = floors.service.create(addUser("Olga", "owner"), {
    name: "Access",
    tier: "small",
    repos: [{ repo: "octo/hello", ...(repoToken ? { token: FAKE_PAT } : {}) }],
  });
  await created.cloned;
  const repoId = created.floor.repos[0]?.repoId ?? "";
  const pick = () =>
    floors.repos.withRepoCredential(repoId, ({ token, source, redact }) => ({
      token,
      source,
      redacted: redact(`x ${token ?? ""} y`),
    }));
  return { floors, repoId, tokensSeen, pick };
}

const covering = (calls: string[] = []): ConnectionTokens => ({
  async tokenFor(owner, name) {
    calls.push(`${owner}/${name}`);
    return owner === "octo" && name === "hello" ? CONN_TOKEN : null;
  },
});
const notCovering: ConnectionTokens = { tokenFor: async () => null };
const failing: ConnectionTokens = {
  tokenFor: async () => {
    throw new GitHubApiError(502, "upstream down");
  },
};

describe("withRepoCredential token selection", () => {
  test("a covered repo uses the connection's token, also for the clone", async () => {
    const calls: string[] = [];
    const t = await floorWith(covering(calls), true);
    expect(await t.pick()).toEqual({
      token: CONN_TOKEN,
      source: "connection",
      redacted: "x [redacted] y",
    });
    expect(t.tokensSeen).toEqual([CONN_TOKEN]);
    expect(calls).toContain("octo/hello");
    expect(t.floors.repos.getRepo(t.repoId)?.cloneStatus).toBe("ready");
  });

  test("an uncovered repo falls back to its own PAT, or none", async () => {
    expect(await (await floorWith(notCovering, true)).pick()).toMatchObject({
      token: FAKE_PAT,
      source: "repo",
    });
    expect(await (await floorWith(notCovering, false)).pick()).toMatchObject({
      token: null,
      source: null,
    });
    expect(await (await floorWith(undefined, false)).pick()).toMatchObject({ token: null });
  });

  test("a failing connection falls back to the repo PAT; without one it is an error", async () => {
    expect(await (await floorWith(failing, true)).pick()).toMatchObject({ source: "repo" });
    const t = await floorWith(failing, false);
    const err = await t.pick().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepoCredentialError);
    expect((err as RepoCredentialError).code).toBe("connection_failed");
    // The clone reported it in plain words.
    const repo = t.floors.service.list({ id: "x", role: "owner" })[0]?.repos[0];
    expect(repo?.cloneStatus).toBe("error");
    expect(repo?.cloneError).toContain("GitHub connection could not issue a token");
  });
});
