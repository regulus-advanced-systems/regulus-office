/** The office GitHub connection against a fake GitHub (#141): repo lists and token selection. */
import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createLogger } from "../logging.ts";
import { testDb } from "../operations/test-helpers.ts";
import { GitHubConnection, LIST_CACHE_MS } from "./connection.ts";
import { ConnectionStore } from "./connection-store.ts";
import { startFakeGitHub, testAppKey } from "./fake-github.ts";

const logger = createLogger({ level: "silent" });
const keyring = { current: 1, keys: { 1: randomBytes(32) } };
const { privateKey, publicKey } = testAppKey();
const PAT = "github_pat_ORGfake_0123456789abcdefghijklmnop";

const gh = startFakeGitHub({
  publicKey,
  installations: [
    {
      id: 7,
      account: "Octo",
      repos: [
        { owner: "Octo", name: "hello" },
        { owner: "Octo", name: "api" },
      ],
    },
    { id: 9, account: "acme", repos: [{ owner: "acme", name: "web", private: false }] },
  ],
  pats: {
    [PAT]: { login: "octo-bot", repos: [{ owner: "octo", name: "hello", defaultBranch: "trunk" }] },
  },
});
afterAll(() => gh.stop());

function setup(opts: { env?: boolean; now?: () => number } = {}) {
  const { db } = testDb();
  const store = new ConnectionStore(db, keyring);
  const connection = new GitHubConnection({
    store,
    apiBase: gh.url,
    logger,
    now: opts.now,
    envApp: opts.env
      ? { appId: 1, clientId: "Iv1env", privateKey, webhookSecret: null }
      : undefined,
  });
  return { db, store, connection };
}

const saveApp = (store: ConnectionStore) =>
  store.saveApp({
    appId: 5,
    clientId: "Iv1abc",
    slug: "regulus-office-test",
    name: "Regulus Office (test)",
    htmlUrl: "https://github.com/apps/regulus-office-test",
    owner: "Octo",
    privateKey,
    webhookSecret: "whsec_fake",
  });

describe("no connection", () => {
  test("status none, no repos, no token", async () => {
    const { connection } = setup();
    expect((await connection.status()).kind).toBe("none");
    expect(await connection.listRepos()).toEqual({ repos: [], truncated: false });
    expect(await connection.tokenFor("Octo", "hello")).toBeNull();
  });
});

describe("GitHub App", () => {
  test("status lists installations and never carries a secret", async () => {
    const { store, connection } = setup();
    saveApp(store);
    const status = await connection.status();
    expect(status.kind).toBe("app");
    expect(status.source).toBe("db");
    expect(status.app?.installUrl).toBe(
      "https://github.com/apps/regulus-office-test/installations/new",
    );
    expect(status.app?.installations.map((i) => i.account)).toEqual(["Octo", "acme"]);
    const text = JSON.stringify(status);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain("whsec_fake");
  });

  test("lists the repos of every installation, sorted", async () => {
    const { store, connection } = setup();
    saveApp(store);
    const { repos } = await connection.listRepos();
    expect(repos.map((r) => r.fullName)).toEqual(["acme/web", "Octo/api", "Octo/hello"]);
    expect(repos[0]).toMatchObject({ private: false, defaultBranch: "main" });
    expect(repos[0]?.pushedAt).toBe(Date.parse("2026-09-01T10:00:00Z"));
  });

  test("a covered repo gets an installation token narrowed to it; others get none", async () => {
    const { store, connection } = setup();
    saveApp(store);
    const token = await connection.tokenFor("octo", "Hello");
    expect(token).toMatch(/^ghs_fakeInstallationToken\d+x7$/);
    expect(gh.minted.get(token ?? "")?.repo).toBe("Hello");
    // Not in the installation's selection, and an account without the app.
    expect(await connection.tokenFor("Octo", "secret")).toBeNull();
    expect(await connection.tokenFor("someone", "hello")).toBeNull();
  });

  test("tokens are cached and minted again near expiry", async () => {
    const clock = { now: Date.now() };
    const { store, connection } = setup({ now: () => clock.now });
    saveApp(store);
    const first = await connection.tokenFor("Octo", "api");
    expect(await connection.tokenFor("Octo", "api")).toBe(first);
    clock.now += 56 * 60_000 + LIST_CACHE_MS;
    const second = await connection.tokenFor("Octo", "api");
    expect(second).not.toBe(first);
  });

  test("the env app overrides the stored one", async () => {
    const { store, connection } = setup({ env: true });
    store.savePat(PAT, "octo-bot");
    const status = await connection.status();
    expect(status).toMatchObject({ kind: "app", source: "env" });
    expect(status.app?.appId).toBe(1);
    expect(connection.managedByEnv).toBe(true);
  });

  test("GitHub failures surface as a redacted status error and a thrown tokenFor", async () => {
    const { store, connection } = setup();
    saveApp(store);
    gh.state.failAll = true;
    try {
      const status = await connection.status();
      expect(status.app?.error).toContain("500");
      await expect(connection.tokenFor("Octo", "hello")).rejects.toThrow();
    } finally {
      gh.state.failAll = false;
    }
  });
});

describe("org PAT", () => {
  test("lists the token's repos and covers exactly those", async () => {
    const { store, connection } = setup();
    expect(await connection.verifyPat(PAT)).toEqual({ login: "octo-bot", repoCount: 1 });
    store.savePat(PAT, "octo-bot");
    const status = await connection.status();
    expect(status).toMatchObject({ kind: "pat", pat: { login: "octo-bot" } });
    expect(JSON.stringify(status)).not.toContain(PAT);
    expect((await connection.listRepos()).repos.map((r) => r.fullName)).toEqual(["octo/hello"]);
    expect(await connection.tokenFor("Octo", "HELLO")).toBe(PAT);
    expect(await connection.tokenFor("octo", "other")).toBeNull();
  });

  test("a rejected PAT fails verification without echoing it", async () => {
    const { connection } = setup();
    const bad = "github_pat_WRONGfake_0123456789abcdef";
    try {
      await connection.verifyPat(bad);
      throw new Error("expected a rejection");
    } catch (err) {
      expect(String(err)).toContain("401");
      expect(String(err)).not.toContain(bad);
    }
  });

  test("the PAT is stored encrypted", () => {
    const { db, store } = setup();
    store.savePat(PAT, "octo-bot");
    const row = db.$client.query("select * from github_connection").get();
    expect(JSON.stringify(row)).not.toContain(PAT);
    expect(store.load()).toMatchObject({ kind: "pat", token: PAT });
    expect(store.clear()).toBe(true);
    expect(store.load()).toBeNull();
  });
});
