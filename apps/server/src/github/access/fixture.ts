/**
 * Test fixture for people's GitHub access (#267 tests only): an in-memory
 * database with three rooms' repos (two under the `octo` org, one of them
 * followed twice, and one under the personal account `mia`), the fake GitHub
 * with three people, and the access service against it.
 */
import { randomBytes } from "node:crypto";
import { SecretValue } from "../../config.ts";
import { operationRepos, operations } from "../../db/schema/index.ts";
import { createLogger } from "../../logging.ts";
import { testDb } from "../../operations/test-helpers.ts";
import { startFakeGitHub } from "../fake-github.ts";
import { type FakeGitHubUser, fakeGitHubUsers } from "../fake-github-users.ts";
import type { AccessChangedEvent } from "./events.ts";
import { createGitHubAccess } from "./index.ts";

export const CLIENT_ID = "Iv1.fakeclient267";
export const CLIENT_SECRET = "fake_client_secret_267_0123456789abcdef";
export const REDIRECT_URI = "https://office.example.com/api/github/link/callback";

export const PEOPLE: FakeGitHubUser[] = [
  {
    id: 1001,
    login: "mia",
    orgs: [{ login: "Octo", id: 9, role: "member" }],
    repos: { "octo/hello": "write", "mia/notes": "admin" },
  },
  { id: 1002, login: "ravi", orgs: [], repos: { "octo/hello": "read" } },
  { id: 1003, login: "olga", orgs: [{ login: "octo", role: "admin" }], repos: {} },
];

export function accessFixture(
  opts: { expiresInSeconds?: number; oauth?: boolean; keyring?: boolean; now?: () => number } = {},
) {
  const people = fakeGitHubUsers({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    users: PEOPLE,
    expiresInSeconds: opts.expiresInSeconds,
  });
  const gh = startFakeGitHub({ users: people });
  const { db, addUser } = testDb();
  const logs: string[] = [];
  const logger = createLogger({
    level: "debug",
    destination: { write: (line: string) => logs.push(line) },
  });

  const seedRoom = (slug: string, index: number, full: string) => {
    const operationId = `operation-${slug}`;
    db.insert(operations)
      .values({ id: operationId, name: slug, slug, index, paletteId: "p", layoutTemplateId: "t" })
      .run();
    const [owner, name] = full.split("/") as [string, string];
    const id = `repo-${slug}`;
    db.insert(operationRepos)
      .values({
        id,
        operationId,
        owner,
        name,
        url: `https://github.com/${full}`,
        workdir: `/tmp/rg267-none/${slug}/${name}`,
        isPrimary: true,
        cloneStatus: "ready",
      })
      .run();
    return id;
  };
  const repos = {
    hello: seedRoom("hello", 1, "octo/hello"),
    /** A second room following the same GitHub repo, spelled differently. */
    helloAgain: seedRoom("hello-again", 2, "Octo/Hello"),
    secret: seedRoom("secret", 3, "octo/secret"),
    notes: seedRoom("notes", 4, "mia/notes"),
  };

  const access = createGitHubAccess({
    db,
    keyring: opts.keyring === false ? undefined : { current: 1, keys: { 1: randomBytes(32) } },
    config: {
      githubApiBase: gh.url,
      githubWebBase: gh.url,
      githubOAuth:
        opts.oauth === false
          ? undefined
          : { clientId: CLIENT_ID, clientSecret: new SecretValue(CLIENT_SECRET) },
    },
    logger,
    now: opts.now,
    debounceMs: 5,
    refreshIntervalMs: 3_600_000,
  });
  const changes: AccessChangedEvent[] = [];
  access.service.events.on("access-changed", (e) => {
    changes.push(e);
  });

  /** Link an office user to a GitHub person, as the OAuth callback would. */
  const link = (userId: string, login: string) =>
    access.service.completeLink(userId, people.authorize(login), REDIRECT_URI);

  /** Everything the database holds, as text: no token may ever show up in it. */
  const dump = (): string => {
    const tables = db.$client
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    return tables
      .map((t) => JSON.stringify(db.$client.query(`SELECT * FROM "${t.name}"`).all()))
      .join("\n");
  };

  return {
    db,
    gh,
    people,
    access,
    service: access.service,
    refresher: access.refresher,
    repos,
    changes,
    logs,
    addUser,
    link,
    dump,
    stop: () => {
      access.refresher.stop();
      gh.stop();
      db.$client.close();
    },
  };
}

export type AccessFixture = ReturnType<typeof accessFixture>;
