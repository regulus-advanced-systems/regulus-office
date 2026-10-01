/**
 * Test fixture for board sync (#35 tests only): an in-memory database with
 * two operations following `octo/hello` (one also follows `octo/other`), a GitHub
 * App connection against the fake GitHub, a board sink that records what the
 * OperationRoom would get, and every event from the bus.
 */
import { randomBytes } from "node:crypto";
import { operationRepos, operations } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { testDb } from "../operations/test-helpers.ts";
import type { OperationBoard } from "./board-summary.ts";
import type { AnyGitHubEvent } from "./events.ts";
import { startFakeGitHub, testAppKey } from "./fake-github.ts";
import { fakeBoards } from "./fake-github-boards.ts";
import type { RepoCredential } from "./repo-access.ts";
import { createGitHubConnection } from "./setup.ts";
import { createGitHubSync } from "./sync.ts";

export const WEBHOOK_SECRET = "whsec_fixture_It's a Secret to Everybody";
export const REPO_TOKEN = "ghs_fixtureInstallationToken0123456789";
export const APP_ID = 4242;
export const APP_SLUG = "regulus-office-test";

const keyPair = testAppKey();

export function syncFixture(
  opts: {
    publicUrl?: string;
    now?: () => number;
    webhookSecret?: string | null;
    hookConfig?: Record<string, unknown>;
    polling?: boolean;
    /** The operation repos' token; null: none (not polled). */
    token?: string | null;
  } = {},
) {
  const boards = fakeBoards({ tokens: [REPO_TOKEN] });
  const gh = startFakeGitHub({
    appId: APP_ID,
    publicKey: keyPair.publicKey,
    appSlug: APP_SLUG,
    hookConfig: opts.hookConfig,
    extra: (req, url) => boards.handler(req, url),
  });
  const { db } = testDb();
  const keyring = { current: 1, keys: { 1: randomBytes(32) } };
  const logs: string[] = [];
  const logger = createLogger({
    level: "debug",
    destination: { write: (line: string) => logs.push(line) },
  });
  const github = createGitHubConnection({
    db,
    keyring,
    config: {
      githubApiBase: gh.url,
      githubWebBase: "https://github.example",
      githubApp: undefined,
    },
    logger,
  });
  github.connection.store.saveApp({
    appId: APP_ID,
    clientId: null,
    slug: APP_SLUG,
    name: "Regulus Office (test)",
    htmlUrl: `https://github.example/apps/${APP_SLUG}`,
    owner: "octo",
    privateKey: keyPair.privateKey,
    webhookSecret: opts.webhookSecret === undefined ? WEBHOOK_SECRET : opts.webhookSecret,
  });

  const seedOperation = (slug: string, index: number, repos: string[]) => {
    const operationId = `operation-${slug}`;
    db.insert(operations)
      .values({ id: operationId, name: slug, slug, index, paletteId: "p", layoutTemplateId: "t" })
      .run();
    const ids = repos.map((full, i) => {
      const [owner, name] = full.split("/") as [string, string];
      const id = `repo-${slug}-${name}`;
      db.insert(operationRepos)
        .values({
          id,
          operationId,
          owner,
          name,
          url: `https://github.com/${full}`,
          workdir: `/tmp/rg35-none/${slug}/${name}`,
          isPrimary: i === 0,
          cloneStatus: "ready",
        })
        .run();
      return id;
    });
    return { operationId, repoIds: ids };
  };
  const alpha = seedOperation("alpha", 1, ["octo/hello", "octo/other"]);
  const beta = seedOperation("beta", 2, ["Octo/Hello"]);

  const published = new Map<string, OperationBoard>();
  const credentialCalls: string[] = [];
  const sync = createGitHubSync({
    db,
    connection: github.connection,
    repos: {
      withRepoCredential: async <T>(repoId: string, fn: (c: RepoCredential) => T | Promise<T>) => {
        credentialCalls.push(repoId);
        return fn({ token: opts.token === undefined ? REPO_TOKEN : opts.token } as RepoCredential);
      },
    },
    boards: { publishBoard: (operationId, board) => published.set(operationId, board) },
    publicUrl: opts.publicUrl ?? "https://office.example.com",
    apiBase: gh.url,
    polling: opts.polling ?? true,
    pollIntervalMs: 60_000,
    logger,
    now: opts.now,
  });
  const events: AnyGitHubEvent[] = [];
  sync.events.on("*", (e) => {
    events.push(e);
  });
  return {
    db,
    gh,
    boards,
    github,
    sync,
    published,
    events,
    logs,
    credentialCalls,
    alpha,
    beta,
    stop: () => {
      sync.stop();
      gh.stop();
      db.$client.close();
    },
  };
}

export type SyncFixture = ReturnType<typeof syncFixture>;
