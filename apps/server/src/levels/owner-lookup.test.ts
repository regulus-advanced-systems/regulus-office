/**
 * Levels learn from GitHub whether their owner is an organisation or an
 * account (#268): with the credential the office already has for a repo on
 * the level, and never without one.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { levels, operationRepos, operations } from "../db/schema/index.ts";
import type { GitHubRequest } from "../github/api.ts";
import { GitHubApiError } from "../github/pulls.ts";
import type { RepoCredential } from "../github/repo-access.ts";
import { createLogger } from "../logging.ts";
import { testDb } from "../operations/test-helpers.ts";
import { LevelOwnerLookup } from "./owner-lookup.ts";
import { ensureLevelFor, unconfirmedLevels } from "./store.ts";

const TOKEN = "ghs_fixtureInstallationToken0123456789";

function setup(tokens: Record<string, string | null>) {
  const { db } = testDb();
  const room = (slug: string, owner: string, index: number) => {
    const { levelId } = ensureLevelFor(db, owner);
    db.insert(operations)
      .values({ id: slug, name: slug, slug, index, paletteId: "p", layoutTemplateId: "t", levelId })
      .run();
    db.insert(operationRepos)
      .values({
        id: `repo-${slug}`,
        operationId: slug,
        owner,
        name: slug,
        url: `https://github.com/${owner}/${slug}`,
        workdir: `/nonexistent/${slug}`,
        isPrimary: true,
      })
      .run();
    return levelId;
  };
  const requests: GitHubRequest[] = [];
  const logs: string[] = [];
  let published = 0;
  const lookup = new LevelOwnerLookup({
    db,
    repos: {
      withRepoCredential: async <T>(repoId: string, fn: (c: RepoCredential) => T | Promise<T>) =>
        fn({ token: tokens[repoId] ?? null } as RepoCredential),
    },
    api: {
      json: async <T>(req: GitHubRequest) => {
        requests.push(req);
        if (req.path === "/users/regulus-advanced-systems") {
          return {
            id: 4242,
            login: "Regulus-Advanced-Systems",
            type: "Organization",
            name: "Regulus Advanced Systems",
          } as T;
        }
        if (req.path === "/users/ante")
          return { id: 7, login: "Ante", type: "User", name: null } as T;
        throw new GitHubApiError(404, "Not Found");
      },
    },
    logger: createLogger({
      level: "debug",
      destination: { write: (line: string) => logs.push(line) },
    }),
    onChange: () => {
      published += 1;
    },
  });
  const level = (id: string) => db.select().from(levels).where(eq(levels.id, id)).get();
  return { db, room, lookup, requests, logs, level, published: () => published };
}

describe("LevelOwnerLookup", () => {
  test("an organisation and an account are told apart, with id and display name", async () => {
    const t = setup({ "repo-office": TOKEN, "repo-dotfiles": TOKEN, "repo-ghost": TOKEN });
    const org = t.room("office", "Regulus-Advanced-Systems", 1);
    const account = t.room("dotfiles", "Ante", 2);
    const ghost = t.room("ghost", "nobody", 3);
    expect(t.level(org)).toMatchObject({
      kind: "account",
      githubId: null,
      name: "Regulus-Advanced-Systems",
    });

    expect(await t.lookup.run()).toBe(2);
    expect(t.level(org)).toMatchObject({
      kind: "org",
      githubId: 4242,
      login: "regulus-advanced-systems",
      name: "Regulus Advanced Systems",
    });
    expect(t.level(account)).toMatchObject({
      kind: "account",
      githubId: 7,
      login: "ante",
      name: "Ante",
    });
    // GitHub does not know the owner: the level stays as it was, and it is tried again later.
    expect(t.level(ghost)).toMatchObject({ kind: "account", githubId: null });
    expect(unconfirmedLevels(t.db).map((l) => l.id)).toEqual([ghost]);
    expect(t.published()).toBe(1);
    // The token goes in the request's bearer only, never into the logs.
    expect(t.requests.every((r) => r.bearer === TOKEN)).toBe(true);
    expect(t.logs.join("\n")).not.toContain(TOKEN);
    expect(t.logs.join("\n")).toContain("could not look up a level's owner");

    // Confirmed levels are not asked about again.
    const asked = t.requests.length;
    expect(await t.lookup.run()).toBe(0);
    expect(t.requests.slice(asked).map((r) => r.path)).toEqual(["/users/nobody"]);
    expect(t.published()).toBe(1);
  });

  test("without a credential GitHub is not asked at all", async () => {
    const t = setup({});
    const levelId = t.room("public", "octo", 1);
    expect(await t.lookup.run()).toBe(0);
    expect(t.requests).toEqual([]);
    expect(t.level(levelId)).toMatchObject({ kind: "account", githubId: null });
  });
});
