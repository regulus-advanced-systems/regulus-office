/** HTTP surface of the office GitHub connection (#141) over a real server with sessions. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { GitHubConnectionStatus, StartManifestResponse } from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { auditLog } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { startFakeGitHub, testAppKey } from "./fake-github.ts";
import { mountGitHubRoutes } from "./routes.ts";
import { createGitHubConnection } from "./setup.ts";

const PAT = "github_pat_ORGroutes_0123456789abcdefghijkl";
const { privateKey, publicKey } = testAppKey();
const gh = startFakeGitHub({
  publicKey,
  installations: [{ id: 3, account: "octo", repos: [{ owner: "octo", name: "hello" }] }],
  pats: {
    [PAT]: {
      login: "octo-bot",
      // The office's connection covers more than any one person may see.
      repos: [
        { owner: "octo", name: "hello" },
        { owner: "octo", name: "secret" },
        { owner: "Octo", name: "Mixed" },
      ],
    },
  },
  conversions: {
    goodcode: {
      id: 77,
      client_id: "Iv1conv",
      slug: "regulus-office-localhost",
      name: "Regulus Office (localhost)",
      html_url: "https://github.com/apps/regulus-office-localhost",
      owner: { login: "octo" },
      pem: privateKey,
      webhook_secret: "whsec_from_conversion",
      client_secret: "client_secret_unused",
    },
  },
});

let office: Office;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let admin: { id: string; cookie: string };
/**
 * What each person's own GitHub account can see (the `ownRepos` dep, #270);
 * someone not in the map has no linked account.
 */
type Own = { names: Set<string>; truncated: boolean } | "not_linked" | "unavailable";
const ownRepos = new Map<string, Own>();
const sees = (...names: string[]): Own => ({ names: new Set(names), truncated: false });

beforeAll(async () => {
  office = startOffice();
  const github = createGitHubConnection({
    db: office.db,
    keyring: { current: 1, keys: { 1: randomBytes(32) } },
    config: {
      githubApiBase: gh.url,
      githubWebBase: "https://github.example",
      githubApp: undefined,
    },
    logger: createLogger({ level: "silent" }),
  });
  mountGitHubRoutes(office.server.router, {
    auth: office.auth,
    db: office.db,
    logger: createLogger({ level: "silent" }),
    ...github,
    ownRepos: async (userId) => ownRepos.get(userId) ?? "not_linked",
  });
  owner = await office.signUp("Olga");
  member = await office.signUp("Mia");
  admin = await office.signUp("Ada");
  office.db.$client.run(`update user_profiles set role = 'admin' where user_id = '${admin.id}'`);
  ownRepos.set(owner.id, sees("octo/hello", "elsewhere/unconnected"));
});

afterAll(async () => {
  await office.stop();
  gh.stop();
});

const call = (method: string, path: string, cookie?: string, body?: unknown, origin?: string) =>
  office.request(path, {
    method,
    cookie,
    redirect: "manual",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: origin ? { origin } : undefined,
  });

const everything = () =>
  JSON.stringify(office.db.$client.query("select * from github_connection").all()) +
  JSON.stringify(office.db.select().from(auditLog).all());

describe("access", () => {
  test("anonymous 401, members 403, cross-origin writes 403", async () => {
    expect((await call("GET", "/api/github/connection")).status).toBe(401);
    expect((await call("GET", "/api/github/connection", member.cookie)).status).toBe(403);
    expect((await call("GET", "/api/github/repos", member.cookie)).status).toBe(403);
    expect((await call("PUT", "/api/github/pat", member.cookie, { token: PAT })).status).toBe(403);
    expect(
      (await call("PUT", "/api/github/pat", owner.cookie, { token: PAT }, "https://evil.example"))
        .status,
    ).toBe(403);
    expect(
      (await call("POST", "/api/github/app/manifest", member.cookie, { org: "octo" })).status,
    ).toBe(403);
  });
});

describe("org PAT", () => {
  test("a rejected token is refused and not stored", async () => {
    const res = await call("PUT", "/api/github/pat", owner.cookie, {
      token: "github_pat_BADfake_0123456789",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("github_rejected");
    expect(everything()).not.toContain("github_pat_BADfake");
  });

  test("an admin connects; status and repos never show the token", async () => {
    const res = await call("PUT", "/api/github/pat", admin.cookie, { token: PAT });
    expect(res.status).toBe(200);
    const status = (await res.json()) as GitHubConnectionStatus;
    expect(status).toMatchObject({ kind: "pat", pat: { login: "octo-bot" }, canStore: true });
    const repos = await call("GET", "/api/github/repos", owner.cookie);
    const text = await repos.text();
    expect(JSON.parse(text).repos.map((r: { fullName: string }) => r.fullName)).toEqual([
      "octo/hello",
    ]);
    expect(text).not.toContain(PAT);
    expect(everything()).not.toContain(PAT);
    expect(everything()).toContain("github.connect");
  });

  test("the repo picker lists only what the caller's own GitHub account can see (#270)", async () => {
    const names = async (cookie: string) => {
      const res = await call("GET", "/api/github/repos", cookie);
      const body = (await res.json()) as { repos?: { fullName: string }[]; truncated?: boolean };
      return { status: res.status, repos: body.repos?.map((r) => r.fullName), body };
    };
    // The connection covers three repos; the owner's account sees one of them
    // (and one the connection does not cover, which is not offered either).
    expect(await names(owner.cookie)).toMatchObject({ status: 200, repos: ["octo/hello"] });
    // An admin who has not linked GitHub learns nothing about the connection's repos.
    const unlinked = await names(admin.cookie);
    expect(unlinked.status).toBe(403);
    expect(unlinked.body).toMatchObject({ error: "github_link_required" });
    expect(JSON.stringify(unlinked.body)).not.toContain("octo");
    // Linked: their own repos, whatever the case GitHub spells them in, and nobody else's.
    ownRepos.set(admin.id, { names: new Set(["octo/secret", "octo/mixed"]), truncated: true });
    const mine = await names(admin.cookie);
    expect(mine.repos?.sort()).toEqual(["Octo/Mixed", "octo/secret"]);
    expect(mine.body.truncated).toBe(true);
    ownRepos.set(admin.id, sees());
    expect(await names(admin.cookie)).toMatchObject({ status: 200, repos: [] });
    // GitHub could not list the person's repos: no list, not the connection's.
    ownRepos.set(admin.id, "unavailable");
    const down = await names(admin.cookie);
    expect([down.status, down.body]).toMatchObject([502, { error: "github_unavailable" }]);
    expect(down.repos).toBeUndefined();
    // Office members do not pick repos at all, linked or not.
    ownRepos.set(member.id, sees("octo/hello"));
    expect((await names(member.cookie)).status).toBe(403);
    ownRepos.delete(admin.id);
  });

  test("disconnect removes it", async () => {
    expect((await call("DELETE", "/api/github/connection", owner.cookie)).status).toBe(204);
    const status = await (await call("GET", "/api/github/connection", owner.cookie)).json();
    expect(status.kind).toBe("none");
  });
});

describe("GitHub App manifest flow", () => {
  const start = async (cookie: string, org?: string) => {
    const res = await call("POST", "/api/github/app/manifest", cookie, org ? { org } : {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as StartManifestResponse;
    const state = new URL(body.action).searchParams.get("state") ?? "";
    return { body, state };
  };
  const callback = (cookie: string | undefined, code: string, state: string) =>
    call("GET", `/api/github/app/callback?code=${code}&state=${encodeURIComponent(state)}`, cookie);
  const resultOf = (res: Response) =>
    new URL(res.headers.get("location") ?? "", "http://x").searchParams.get("github");

  test("the manifest asks for the #141 and #155 permissions and posts to the org's settings", async () => {
    const { body, state } = await start(owner.cookie, "octo");
    expect(body.action).toStartWith(
      "https://github.example/organizations/octo/settings/apps/new?state=",
    );
    expect(state.length).toBeGreaterThanOrEqual(40);
    const manifest = JSON.parse(body.manifest);
    expect(manifest.default_permissions).toEqual({
      contents: "write",
      pull_requests: "write",
      metadata: "read",
      issues: "write",
      checks: "write",
      members: "read",
    });
    expect(manifest.public).toBe(false);
    expect(manifest.redirect_url).toEndWith("/api/github/app/callback");
    expect(manifest.setup_url).toEndWith("/api/github/app/installed");
    // A localhost office has no public webhook URL.
    expect(manifest.hook_attributes).toBeUndefined();
    const personal = await start(owner.cookie);
    expect(personal.body.action).toStartWith("https://github.example/settings/apps/new?state=");
  });

  test("the callback refuses a missing, forged, foreign or signed-out state", async () => {
    const { state } = await start(owner.cookie);
    expect(resultOf(await callback(owner.cookie, "goodcode", "forged"))).toBe("invalid_state");
    expect(resultOf(await callback(admin.cookie, "goodcode", state))).toBe("invalid_state");
    expect(resultOf(await callback(undefined, "goodcode", state))).toBe("signed_out");
    expect(resultOf(await callback(member.cookie, "goodcode", state))).toBe(
      "owner_or_admin_required",
    );
    expect(gh.calls.some((c) => c.path.startsWith("/app-manifests/"))).toBe(false);
  });

  test("a valid callback stores the app encrypted and sends the owner to install it, once", async () => {
    const { state } = await start(owner.cookie);
    const res = await callback(owner.cookie, "goodcode", state);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://github.com/apps/regulus-office-localhost/installations/new",
    );
    const stored = everything();
    expect(stored).not.toContain("PRIVATE KEY");
    expect(stored).not.toContain("whsec_from_conversion");
    expect(stored).not.toContain("client_secret_unused");
    // The state is single-use.
    expect(resultOf(await callback(owner.cookie, "goodcode", state))).toBe("invalid_state");

    const status = (await (
      await call("GET", "/api/github/connection", owner.cookie)
    ).json()) as GitHubConnectionStatus;
    expect(status).toMatchObject({ kind: "app", source: "db" });
    expect(status.app?.appId).toBe(77);
    expect(status.app?.installations.map((i) => i.account)).toEqual(["octo"]);
    expect(JSON.stringify(status)).not.toContain("whsec_from_conversion");

    const installed = await call(
      "GET",
      "/api/github/app/installed?installation_id=3",
      owner.cookie,
    );
    expect(resultOf(installed)).toBe("installed");
    const repos = await (await call("GET", "/api/github/repos", owner.cookie)).json();
    expect(repos.repos.map((r: { fullName: string }) => r.fullName)).toEqual(["octo/hello"]);
  });

  test("a bad code is reported, not thrown", async () => {
    const { state } = await start(owner.cookie);
    expect(resultOf(await callback(owner.cookie, "nosuchcode", state))).toBe("conversion_failed");
  });
});
