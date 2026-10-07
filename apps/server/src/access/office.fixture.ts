/**
 * TEST ONLY: the whole office as it runs in production, for the access tests
 * (#270). It starts the real `office-server` process (NODE_ENV=production:
 * session cookies only, no development header) on a throwaway data dir,
 * against the fake GitHub from #267 in this process. People sign up over
 * HTTP, link their fake GitHub accounts through the real OAuth round trip
 * and get exactly the rooms those accounts can see. Nothing is switched off
 * and no access is seeded: what the tests observe is what a browser would.
 *
 * Rooms are created through `POST /api/operations` (cloned from local bare
 * repos). Things no test can create without a runner (a henchman, a queued
 * task, a meeting, a workflow run) are written into the office's own SQLite
 * file by the test, as rows a real office would hold.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubRepoPermission } from "@regulus/protocol";
import { cookieHeaderFrom } from "../auth/routes.ts";
import { type Db, openDatabase } from "../db/index.ts";
import { startFakeGitHub } from "../github/fake-github.ts";
import { type FakeGitHubUser, fakeGitHubUsers } from "../github/fake-github-users.ts";
import { makeBareRepo } from "../operations/test-helpers.ts";

const CLIENT_ID = "Iv1.fakeclient270";
const CLIENT_SECRET = "fake_client_secret_270_0123456789abcdef";
const PASSWORD = "correct horse battery staple 270";

export interface Person {
  id: string;
  name: string;
  cookie: string;
}

export interface RouteEntry {
  method: string;
  pattern: string;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export async function startTestOffice(opts: {
  /** The people on the fake GitHub; their `repos` say what each account can see. */
  github: FakeGitHubUser[];
  /** `owner/name` of every repo a test will add a room for (a local bare repo is made for each). */
  repos: string[];
}) {
  const dataDir = await mkdtemp(join(tmpdir(), "270-office-"));
  const remotes = join(dataDir, "remotes");
  for (const full of opts.repos) {
    const [owner, name] = full.split("/") as [string, string];
    await makeBareRepo(remotes, owner, name);
  }
  const people = fakeGitHubUsers({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    users: opts.github,
  });
  const gh = startFakeGitHub({ users: people });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const secret = () => randomBytes(32).toString("base64");

  const proc = Bun.spawn(["bun", join(import.meta.dir, "..", "index.ts")], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_ENV: "production",
      OFFICE_HOST: "127.0.0.1",
      OFFICE_PORT: String(port),
      OFFICE_PUBLIC_URL: origin,
      OFFICE_DATA_DIR: dataDir,
      OFFICE_PROJECTS_DIR: join(dataDir, "projects"),
      OFFICE_WORKTREES_DIR: join(dataDir, "worktrees"),
      OFFICE_WEB_DIST: join(dataDir, "no-dist"),
      OFFICE_GITHUB_REMOTE_BASE: `file://${remotes}`,
      OFFICE_GITHUB_API_BASE: gh.url,
      OFFICE_GITHUB_WEB_BASE: gh.url,
      GITHUB_CLIENT_ID: CLIENT_ID,
      GITHUB_CLIENT_SECRET: CLIENT_SECRET,
      OFFICE_OPEN_SIGNUP: "true",
      // The docker backend on a socket nothing listens on: no runner is ever made.
      OFFICE_RUNNER_BACKEND: "docker",
      OFFICE_DOCKER_RUNNER_PREFIX: `rg270-${randomBytes(3).toString("hex")}`,
      DOCKER_HOST: `unix://${join(dataDir, "no-docker.sock")}`,
      OFFICE_ROOM_BUILD_SECONDS: "0",
      OFFICE_LOG_LEVEL: "debug",
      BETTER_AUTH_SECRET: secret(),
      OFFICE_MASTER_KEY: secret(),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  // The server logs its route table once at debug level; everything else is dropped.
  let routes: RouteEntry[] = [];
  let log = "";
  const reading = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      log += decoder.decode(chunk, { stream: true });
      let newline = log.indexOf("\n");
      while (newline >= 0) {
        const line = log.slice(0, newline);
        log = log.slice(newline + 1);
        // Server errors are a test failure waiting to be explained: show them.
        // (Not the docker socket: this office has none, on purpose.)
        if (line.includes('"level":50') && !line.includes("FailedToOpenSocket")) {
          console.error(line.slice(0, 1500));
        }
        if (line.includes('"routes mounted"')) {
          routes = (JSON.parse(line) as { routes: RouteEntry[] }).routes;
        }
        newline = log.indexOf("\n");
      }
    }
  })();

  const stop = async () => {
    proc.kill();
    await proc.exited;
    await reading.catch(() => undefined);
    gh.stop();
    await rm(dataDir, { recursive: true, force: true });
  };

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`${origin}/healthz`)).ok && routes.length > 0) break;
    } catch {
      // Not listening yet.
    }
    if (proc.exitCode !== null || Date.now() > deadline) {
      const stderr = await new Response(proc.stderr).text().catch(() => "");
      await stop();
      throw new Error(`the test office did not start: ${stderr.slice(-2000)}`);
    }
    await Bun.sleep(50);
  }

  /** The office's own database file, for rows a test cannot create over HTTP. */
  const db: Db = openDatabase({ path: join(dataDir, "office.db") });

  const call = (
    who: Person | null,
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${origin}${path}`, {
      method,
      redirect: "manual",
      headers: {
        ...(who ? { cookie: who.cookie } : {}),
        ...(method === "GET" ? {} : { origin }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let seq = 0;
  /** Register over HTTP. The first person is the office owner; the rest are members. */
  const signUp = async (name: string): Promise<Person> => {
    seq += 1;
    const res = await call(null, "POST", "/api/auth/sign-up/email", {
      email: `${name.toLowerCase()}${seq}@example.com`,
      password: PASSWORD,
      name,
    });
    if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { user: { id: string } };
    return { id: body.user.id, name, cookie: cookieHeaderFrom(res.headers) };
  };

  /** Link the person's GitHub account: the real flow, with the fake GitHub's consent step. */
  const link = async (who: Person, login: string): Promise<void> => {
    const started = await call(who, "POST", "/api/github/link/start");
    if (started.status !== 200) throw new Error(`link start failed: ${started.status}`);
    const { url } = (await started.json()) as { url: string };
    const consent = await fetch(`${url}&login=${encodeURIComponent(login)}`, {
      redirect: "manual",
    });
    const back = new URL(consent.headers.get("location") ?? "");
    const done = await call(who, "GET", `${back.pathname}${back.search}`);
    const landed = done.headers.get("location") ?? "";
    if (!landed.includes("github_link=linked")) throw new Error(`link failed: ${landed}`);
  };

  /** "Check now", as the person presses it after their access changed on GitHub. */
  const checkNow = async (who: Person): Promise<void> => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const res = await call(who, "POST", "/api/github/link/check");
      if (res.status === 200) return;
      if (res.status !== 429) throw new Error(`check failed: ${res.status}`);
      await Bun.sleep(250);
    }
    throw new Error("check now stayed rate limited");
  };

  return {
    origin,
    wsOrigin: origin.replace(/^http/, "ws"),
    db,
    /** Every route the server mounted, from its own log. */
    routes: () => routes,
    call,
    signUp,
    link,
    checkNow,
    /** What an org admin does on GitHub: change a person's permission on a repo. */
    setPermission: (login: string, repo: string, permission: GitHubRepoPermission) =>
      people.setPermission(login, repo, permission),
    /** The person, or GitHub, revokes the office's authorisation. */
    revoke: (login: string) => people.revoke(login),
    stop: async () => {
      db.$client.close();
      await stop();
    },
  };
}

export type TestOffice = Awaited<ReturnType<typeof startTestOffice>>;

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}
