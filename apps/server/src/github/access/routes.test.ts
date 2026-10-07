/** HTTP surface of a person's GitHub link (#267) over a real server with sessions. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { GitHubLinkStatus, StartGitHubLinkResponse } from "@regulus/protocol";
import { type Office, startOffice } from "../../auth/test-helpers.ts";
import { SecretValue } from "../../config.ts";
import { auditLog, operationRepos, operations } from "../../db/schema/index.ts";
import { createLogger } from "../../logging.ts";
import { startFakeGitHub } from "../fake-github.ts";
import { fakeGitHubUsers } from "../fake-github-users.ts";
import { CLIENT_ID, CLIENT_SECRET, PEOPLE } from "./fixture.ts";
import { createGitHubAccess, type GitHubAccess } from "./index.ts";

const people = fakeGitHubUsers({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, users: PEOPLE });
const gh = startFakeGitHub({ users: people });

let office: Office;
let access: GitHubAccess;
let mia: { id: string; cookie: string };
let ravi: { id: string; cookie: string };
let signIns: string[];
let now = Date.now();

function mountAccess(o: Office, oauth = true) {
  const a = createGitHubAccess({
    db: o.db,
    keyring: { current: 1, keys: { 1: randomBytes(32) } },
    config: {
      githubApiBase: gh.url,
      githubWebBase: gh.url,
      githubOAuth: oauth
        ? { clientId: CLIENT_ID, clientSecret: new SecretValue(CLIENT_SECRET) }
        : undefined,
    },
    logger: createLogger({ level: "silent" }),
    now: () => now,
    debounceMs: 1,
  });
  a.mount(o.server.router, o.auth);
  return a;
}

beforeAll(async () => {
  office = startOffice();
  access = mountAccess(office);
  signIns = [];
  office.auth.onSignIn((userId) => {
    signIns.push(userId);
    access.refresher.request(userId);
  });
  office.db
    .insert(operations)
    .values({
      id: "op-hello",
      name: "hello",
      slug: "hello",
      index: 1,
      paletteId: "p",
      layoutTemplateId: "t",
    })
    .run();
  office.db
    .insert(operationRepos)
    .values({
      id: "repo-hello",
      operationId: "op-hello",
      owner: "octo",
      name: "hello",
      url: "https://github.com/octo/hello",
      workdir: "/tmp/rg267-none/hello",
      isPrimary: true,
      cloneStatus: "ready",
    })
    .run();
  mia = await office.signUp("Mia");
  ravi = await office.signUp("Ravi");
});

afterAll(async () => {
  access.refresher.stop();
  await office.stop();
  gh.stop();
});

const call = (method: string, path: string, cookie?: string, origin?: string) =>
  office.request(path, {
    method,
    cookie,
    redirect: "manual",
    headers: origin ? { origin } : undefined,
  });
const status = async (cookie: string) =>
  (await (await call("GET", "/api/github/link", cookie)).json()) as GitHubLinkStatus;

/** Start the link, "click Authorize" on the fake GitHub as `login`, and return the callback URL. */
async function authorise(cookie: string, login: string): Promise<URL> {
  const res = await call("POST", "/api/github/link/start", cookie);
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as StartGitHubLinkResponse;
  const authorize = new URL(url);
  expect(authorize.origin).toBe(gh.url);
  expect(authorize.pathname).toBe("/login/oauth/authorize");
  expect(authorize.searchParams.get("client_id")).toBe(CLIENT_ID);
  expect(authorize.searchParams.get("redirect_uri")).toBe(
    `${office.origin}/api/github/link/callback`,
  );
  expect(url).not.toContain(CLIENT_SECRET);
  authorize.searchParams.set("login", login);
  const back = await fetch(authorize, { redirect: "manual" });
  expect(back.status).toBe(302);
  return new URL(back.headers.get("location") ?? "");
}
const land = async (callback: URL, cookie?: string) => {
  const res = await call("GET", callback.pathname + callback.search, cookie);
  expect(res.status).toBe(303);
  return new URL(res.headers.get("location") ?? "").searchParams.get("github_link");
};

describe("the link routes", () => {
  test("signed out: nothing", async () => {
    expect((await call("GET", "/api/github/link")).status).toBe(401);
    expect((await call("POST", "/api/github/link/start")).status).toBe(401);
    expect((await call("POST", "/api/github/link/check")).status).toBe(401);
    expect((await call("DELETE", "/api/github/link")).status).toBe(401);
  });

  test("state changes need the office origin", async () => {
    for (const [method, path] of [
      ["POST", "/api/github/link/start"],
      ["POST", "/api/github/link/check"],
      ["DELETE", "/api/github/link"],
    ] as const) {
      const res = await call(method, path, mia.cookie, "https://evil.example");
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "origin_mismatch" });
    }
  });

  test("a member links their account through GitHub and sees what it can see", async () => {
    expect(await status(mia.cookie)).toMatchObject({ available: true, state: "not_linked" });
    const callback = await authorise(mia.cookie, "mia");
    expect(await land(callback, mia.cookie)).toBe("linked");

    const linked = await status(mia.cookie);
    expect(linked).toMatchObject({
      state: "linked",
      login: "mia",
      organizations: ["octo"],
      repos: [
        { repoId: "repo-hello", fullName: "octo/hello", permission: "write", access: "spawn" },
      ],
    });
    expect(linked.lastCheckedAt).not.toBeNull();
    // Nobody else's link is touched, and no response or stored row holds a token.
    expect(await status(ravi.cookie)).toMatchObject({ state: "not_linked", repos: [] });
    expect(JSON.stringify(linked)).not.toContain("ghu_");
    const rows = JSON.stringify(office.db.$client.query("SELECT * FROM github_user_links").all());
    for (const token of people.issued) expect(rows).not.toContain(token);
    const audit = office.db.select().from(auditLog).all();
    expect(audit.filter((a) => a.action === "github.link")).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("ghu_");
  });

  test("the callback takes a state once, and only from the person it was issued to", async () => {
    const callback = await authorise(ravi.cookie, "ravi");
    // Mia's browser is sent to Ravi's callback (or an attacker's own code and state).
    expect(await land(callback, mia.cookie)).toBe("invalid_state");
    expect(await land(callback)).toBe("signed_out");
    expect(await land(callback, ravi.cookie)).toBe("linked");
    expect(await land(callback, ravi.cookie)).toBe("invalid_state");
    const forged = new URL(callback);
    forged.searchParams.set("state", "made-up");
    expect(await land(forged, ravi.cookie)).toBe("invalid_state");
    expect(await status(mia.cookie)).toMatchObject({ login: "mia" });
    expect(await status(ravi.cookie)).toMatchObject({ state: "linked", login: "ravi" });
  });

  test("pressing Cancel on GitHub, or a code GitHub refuses, links nothing", async () => {
    await call("DELETE", "/api/github/link", ravi.cookie);
    const denied = await authorise(ravi.cookie, "nobody");
    expect(denied.searchParams.get("error")).toBe("access_denied");
    expect(await land(denied, ravi.cookie)).toBe("denied");
    const bad = await authorise(ravi.cookie, "ravi");
    bad.searchParams.set("code", "stale-code");
    expect(await land(bad, ravi.cookie)).toBe("github_rejected");
    // A GitHub account already linked by someone else.
    const taken = await authorise(ravi.cookie, "mia");
    expect(await land(taken, ravi.cookie)).toBe("account_in_use");
    expect(await status(ravi.cookie)).toMatchObject({ state: "not_linked", repos: [] });
  });

  test("check now asks GitHub again, at most every few seconds", async () => {
    people.setPermission("mia", "octo/hello", "read");
    const res = await call("POST", "/api/github/link/check", mia.cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as GitHubLinkStatus).repos).toMatchObject([
      { permission: "read", access: "view" },
    ]);
    const again = await call("POST", "/api/github/link/check", mia.cookie);
    expect(again.status).toBe(429);
    now += 6_000;
    expect((await call("POST", "/api/github/link/check", mia.cookie)).status).toBe(200);
  });

  test("signing in refreshes the snapshot", async () => {
    people.setPermission("mia", "octo/hello", "admin");
    signIns.length = 0;
    const res = await office.post("/api/auth/sign-in/email", {
      email: "mia1@example.com",
      password: "correct horse battery staple",
    });
    expect(res.status).toBe(200);
    expect(signIns).toEqual([mia.id]);
    await Bun.sleep(20);
    await access.refresher.flush();
    expect(access.service.repoPermissionFor(mia.id, "repo-hello")).toBe("admin");
  });

  test("a revoked token shows as revoked with nothing visible; unlink clears it", async () => {
    people.revoke("mia");
    now += 6_000;
    const res = await call("POST", "/api/github/link/check", mia.cookie);
    expect(await res.json()).toMatchObject({ state: "revoked", login: "mia", repos: [] });

    const gone = await call("DELETE", "/api/github/link", mia.cookie);
    expect(gone.status).toBe(200);
    expect(await gone.json()).toMatchObject({ state: "not_linked", login: null, repos: [] });
    expect(office.db.$client.query("SELECT * FROM github_user_links").all()).toEqual([]);
    const audit = office.db.select().from(auditLog).all();
    expect(audit.filter((a) => a.action === "github.unlink")).toHaveLength(2);
  });

  test("an office without a GitHub OAuth client says so", async () => {
    const bare = startOffice();
    const a = mountAccess(bare, false);
    try {
      const user = await bare.signUp("Solo");
      const res = await bare.request("/api/github/link", { cookie: user.cookie });
      expect(await res.json()).toMatchObject({
        available: false,
        unavailableReason: "oauth_not_configured",
      });
      const start = await bare.request("/api/github/link/start", {
        method: "POST",
        cookie: user.cookie,
      });
      expect(start.status).toBe(400);
      expect(await start.json()).toEqual({ error: "oauth_not_configured" });
    } finally {
      a.refresher.stop();
      await bare.stop();
    }
  });
});
