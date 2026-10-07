/** Connect an existing GitHub App (#224) over a real server with sessions and the fake GitHub. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type {
  ConnectExistingAppResponse,
  GitHubAppRequirements,
  GitHubConnectionStatus,
} from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { SecretValue } from "../config.ts";
import { auditLog } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { missingEvents, missingPermissions, verifyExistingApp } from "./existing-app.ts";
import { startFakeGitHub, testAppKey } from "./fake-github.ts";
import { APP_EVENTS, APP_PERMISSIONS } from "./manifest.ts";
import { mountGitHubRoutes } from "./routes.ts";
import { createGitHubConnection } from "./setup.ts";

const APP_ID = 4242;
const WEBHOOK_SECRET = "whsec_existing_0123456789";
const { privateKey, publicKey } = testAppKey();
const other = testAppKey();
const gh = startFakeGitHub({
  appId: APP_ID,
  appSlug: "old-office-app",
  issuers: [String(APP_ID), "Iv1existing"],
  publicKey,
  installations: [{ id: 8, account: "octo", repos: [{ owner: "octo", name: "hello" }] }],
  app: {
    client_id: "Iv1existing",
    name: "Old office app",
    html_url: "https://github.com/apps/old-office-app",
    owner: { login: "octo" },
    // Made before #155: Checks read only, no Issues; no push events.
    permissions: { contents: "write", pull_requests: "write", metadata: "read", checks: "read" },
    events: ["issues", "issue_comment", "pull_request", "pull_request_review", "check_suite"],
  },
});

const PUBLIC_URL = "https://office.example";
let office: Office;
let origin: string;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
const logLines: string[] = [];

beforeAll(async () => {
  office = startOffice();
  origin = new URL(String(office.server.url)).origin;
  const logger = createLogger({ level: "debug", destination: { write: (l) => logLines.push(l) } });
  const github = createGitHubConnection({
    db: office.db,
    keyring: { current: 1, keys: { 1: randomBytes(32) } },
    config: {
      githubApiBase: gh.url,
      githubWebBase: "https://github.example",
      githubApp: undefined,
    },
    logger,
  });
  mountGitHubRoutes(office.server.router, {
    // A public https office, so the webhook URL and events apply.
    auth: {
      getSessionFromRequest: (r) => office.auth.getSessionFromRequest(r),
      publicUrl: PUBLIC_URL,
      allowedOrigins: [origin],
    },
    db: office.db,
    logger,
    ...github,
  });
  owner = await office.signUp("Olga");
  member = await office.signUp("Mia");
});

afterAll(async () => {
  await office.stop();
  gh.stop();
});

const call = (method: string, path: string, cookie?: string, body?: unknown, from?: string) =>
  office.request(path, {
    method,
    cookie,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: from ? { origin: from } : undefined,
  });
const connect = (body: unknown, cookie = owner.cookie) =>
  call("PUT", "/api/github/app", cookie, body);

const stored = () =>
  JSON.stringify(office.db.$client.query("select * from github_connection").all()) +
  JSON.stringify(office.db.select().from(auditLog).all());
const secretFree = (text: string) => {
  expect(text).not.toContain("PRIVATE KEY");
  expect(text).not.toContain(privateKey.split("\n")[1] ?? "x");
  expect(text).not.toContain(WEBHOOK_SECRET);
};

describe("access", () => {
  test("members are refused; cross-origin writes are refused", async () => {
    expect((await call("GET", "/api/github/app/requirements")).status).toBe(401);
    expect((await call("GET", "/api/github/app/requirements", member.cookie)).status).toBe(403);
    expect((await connect({ appId: APP_ID, privateKey }, member.cookie)).status).toBe(403);
    const cross = await call(
      "PUT",
      "/api/github/app",
      owner.cookie,
      { appId: APP_ID, privateKey },
      "https://evil.example",
    );
    expect(cross.status).toBe(403);
    expect(stored()).not.toContain("github.connect");
  });
});

describe("requirements", () => {
  test("come from the manifest: webhook URL, setup URL, permissions and events", async () => {
    const res = await call("GET", "/api/github/app/requirements", owner.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as GitHubAppRequirements;
    expect(body).toEqual({
      webhookUrl: `${PUBLIC_URL}/api/github/webhook`,
      setupUrl: `${PUBLIC_URL}/api/github/app/installed`,
      permissions: { ...APP_PERMISSIONS },
      events: [...APP_EVENTS],
    });
  });
});

describe("connect an existing app", () => {
  test("a key that is not a PEM is refused before GitHub is asked", async () => {
    const before = gh.calls.length;
    const notPem = await connect({ appId: APP_ID, privateKey: "hello" });
    expect(notPem.status).toBe(400);
    expect((await notPem.json()).error).toBe("invalid_body");
    const garbage = `-----BEGIN RSA PRIVATE KEY-----\n${"A".repeat(200)}\n-----END RSA PRIVATE KEY-----`;
    const bad = await connect({ appId: APP_ID, privateKey: garbage });
    expect(bad.status).toBe(400);
    const text = await bad.text();
    expect(JSON.parse(text).error).toBe("invalid_private_key");
    expect(text).not.toContain("AAAA");
    expect(gh.calls.length).toBe(before);
  });

  test("a key from another app, or the wrong app ID, fails with a plain message", async () => {
    const wrongKey = await connect({ appId: APP_ID, privateKey: other.privateKey });
    expect(wrongKey.status).toBe(400);
    const body = await wrongKey.json();
    expect(body.error).toBe("github_rejected");
    expect(body.detail).toContain("did not accept the key for that app ID");
    const wrongId = await connect({ appId: 999, privateKey });
    expect(wrongId.status).toBe(400);
    expect((await wrongId.json()).error).toBe("github_rejected");
    expect(stored()).not.toContain("github.connect");
    const status = await (await call("GET", "/api/github/connection", owner.cookie)).json();
    expect(status.kind).toBe("none");
  });

  test("the right pair is stored encrypted, with what the app still lacks", async () => {
    const res = await connect({ appId: APP_ID, privateKey, webhookSecret: WEBHOOK_SECRET });
    expect(res.status).toBe(200);
    const text = await res.text();
    secretFree(text);
    const body = JSON.parse(text) as ConnectExistingAppResponse;
    expect(body.missingPermissions).toEqual([
      { name: "issues", required: "write", granted: null },
      { name: "checks", required: "write", granted: "read" },
      // Made before #267: no organisation Members permission, none of the access events.
      { name: "members", required: "read", granted: null },
    ]);
    expect(body.missingEvents).toEqual([
      "check_run",
      "push",
      "member",
      "membership",
      "organization",
      "repository",
      "team",
    ]);
    expect(body.status).toMatchObject({ kind: "app", source: "db" });
    expect(body.status.app).toMatchObject({
      appId: APP_ID,
      slug: "old-office-app",
      name: "Old office app",
      owner: "octo",
      installUrl: "https://github.com/apps/old-office-app/installations/new",
    });
    expect(body.status.app?.installations.map((i) => i.account)).toEqual(["octo"]);

    secretFree(stored());
    const row = office.db.$client.query("select * from github_connection").get() as Record<
      string,
      unknown
    >;
    expect(row.app_client_id).toBe("Iv1existing");
    expect(typeof row.encrypted_private_key).toBe("string");
    expect(typeof row.encrypted_webhook_secret).toBe("string");
    expect(stored()).toContain("github.connect");

    const status = (await (
      await call("GET", "/api/github/connection", owner.cookie)
    ).json()) as GitHubConnectionStatus;
    secretFree(JSON.stringify(status));
    const repos = await (await call("GET", "/api/github/repos", owner.cookie)).json();
    expect(repos.repos.map((r: { fullName: string }) => r.fullName)).toEqual(["octo/hello"]);
    secretFree(logLines.join("\n"));
    expect(logLines.join("\n")).toContain("existing github app connected");
  });

  test("a client ID is used as the JWT issuer", async () => {
    const res = await connect({ appId: APP_ID, privateKey, clientId: "Iv1existing" });
    expect(res.status).toBe(200);
    const last = gh.calls.findLast((c) => c.path === "/app");
    const claims = JSON.parse(
      Buffer.from(last?.authorization?.split(".")[1] ?? "", "base64url").toString(),
    );
    expect(claims.iss).toBe("Iv1existing");
  });
});

describe("helpers", () => {
  test("higher levels satisfy lower ones; events only when checked", async () => {
    expect(
      missingPermissions({
        contents: "admin",
        pull_requests: "write",
        metadata: "write",
        issues: "write",
        checks: "write",
        members: "read",
      }),
    ).toEqual([]);
    expect(missingEvents([...APP_EVENTS])).toEqual([]);
    const api = {
      json: async <T>() => ({ id: 5, permissions: {}, events: [] }) as T,
    };
    const verified = await verifyExistingApp(
      api,
      { appId: 5, privateKey, webhookSecret: null, clientId: null },
      { sign: () => "jwt", checkEvents: false },
    );
    expect(verified.missingEvents).toEqual([]);
    expect(verified.missingPermissions.length).toBe(Object.keys(APP_PERMISSIONS).length);
  });
});

describe("environment app", () => {
  test("an app from the environment still wins", async () => {
    const envOffice = startOffice();
    try {
      const github = createGitHubConnection({
        db: envOffice.db,
        keyring: { current: 1, keys: { 1: randomBytes(32) } },
        config: {
          githubApiBase: gh.url,
          githubWebBase: "https://github.example",
          githubApp: {
            appId: APP_ID,
            clientId: null,
            privateKey: new SecretValue(privateKey),
            webhookSecret: undefined,
          },
        },
        logger: createLogger({ level: "silent" }),
      });
      mountGitHubRoutes(envOffice.server.router, {
        auth: envOffice.auth,
        db: envOffice.db,
        logger: createLogger({ level: "silent" }),
        ...github,
      });
      const boss = await envOffice.signUp("Bea");
      const put = await envOffice.request("/api/github/app", {
        method: "PUT",
        cookie: boss.cookie,
        body: JSON.stringify({ appId: APP_ID, privateKey }),
      });
      expect(put.status).toBe(409);
      expect((await put.json()).error).toBe("managed_by_env");
    } finally {
      await envOffice.stop();
    }
  });
});
