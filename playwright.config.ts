/**
 * Playwright e2e for the M0 exit criteria (docs/SPEC.md §10 M0, §11 Tests).
 * Specs live in tests/e2e and are named *.e2e.ts so `bun test` skips them.
 *
 * By default Playwright starts office-server itself in production mode
 * (NODE_ENV=production: session-cookie room auth only, no dev header) on a
 * fresh data dir with throwaway secrets, serving the prebuilt apps/web/dist.
 * `bun run e2e` builds the web client first.
 *
 * Set E2E_BASE_URL to run against an already running, freshly created office
 * instead (e.g. https://localhost from deploy/docker-compose.yml); the first
 * step registers the owner, so the office must have no users yet.
 *
 * E2E_AGENTS=1 (`bun run e2e:agents`) runs only the henchman flows: tests/e2e/agents.e2e.ts
 * (M1) and tests/e2e/meetings.e2e.ts (the meeting room, #50). They start and restart their own
 * office-server (docker runner backend, fake `claude` in a test runner image), so no webServer
 * is started.
 *
 * Runners (#215): the office this config starts gets its own runner prefix, `rgo2e-<run>`,
 * so it never lists, recovers or reaps another office's runners, and the global teardown
 * removes exactly that prefix. Its Docker backend points at a socket that does not exist, so
 * it never reaches a daemon: whether a runner image happens to be on the host no longer
 * changes the spawn step (it reaches the server, as in CI). The global setup sweeps e2e
 * leftovers older than an hour (tests/e2e/runnerCleanup.ts).
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_GITHUB_CLIENT } from "./tests/e2e/githubClient.ts";
import { newRunId, officeRunnerPrefix } from "./tests/e2e/runnerCleanup.ts";

const external = process.env.E2E_BASE_URL?.replace(/\/+$/, "");
const port = Number(process.env.E2E_PORT ?? 4610);
/** The fake GitHub REST API the office e2e starts for its board step (#36); nothing real. */
if (!process.env.E2E_GITHUB_PORT) process.env.E2E_GITHUB_PORT = String(port + 1);
const githubPort = Number(process.env.E2E_GITHUB_PORT);
const baseURL = external ?? `http://127.0.0.1:${port}`;
const ci = Boolean(process.env.CI);
const agents = process.env.E2E_AGENTS === "1";
const AGENTS_SPECS = ["**/agents.e2e.ts", "**/meetings.e2e.ts"];
/** No webServer: an external office, or the agents spec, which runs its own. */
const noWebServer = Boolean(external) || agents;

// Evaluated once in the runner and again in each worker; the env var makes them agree.
if (!noWebServer && !process.env.E2E_DATA_DIR)
  process.env.E2E_DATA_DIR = mkdtempSync(join(tmpdir(), "regulus-e2e-"));
if (!noWebServer && !process.env.E2E_RUN_ID) process.env.E2E_RUN_ID = newRunId();
/** This run's runner prefix; the global teardown removes exactly its containers and volumes. */
const runnerPrefix = noWebServer ? "" : officeRunnerPrefix(process.env.E2E_RUN_ID);
/** Throwaway per-run secrets unless the caller provides them (CI generates its own). */
const secret = () => randomBytes(32).toString("base64");
/** Signs in the office flow's two browsers before its steps (tests/e2e/officeSession.ts). */
const OFFICE_SETUP = "**/office.setup.ts";
const browserUse = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1280, height: 800 },
  // Software WebGL for the R3F scene on GPU-less CI runners.
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: agents ? AGENTS_SPECS : "**/*.e2e.ts",
  testIgnore: agents ? [] : AGENTS_SPECS,
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  // The flow registers the office owner, which only works once per database.
  retries: 0,
  forbidOnly: ci,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: ci
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    ignoreHTTPSErrors: Boolean(external),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  // The office flow (#248): `setup` registers the owner and the member once (office.setup.ts)
  // and saves their sessions; the steps (office.e2e.ts and any other office spec) open two
  // browsers from them, so one failed step does not skip the rest. The agents spec runs alone.
  projects: agents
    ? [{ name: "chromium", use: browserUse }]
    : [
        { name: "setup", testMatch: OFFICE_SETUP, use: browserUse },
        { name: "chromium", dependencies: ["setup"], use: browserUse },
      ],
  webServer: noWebServer
    ? undefined
    : [
        // GitHub for the office's people (#270): they link accounts of this fake, and the
        // office asks it what each of them can see (tests/e2e/fakeGitHub.ts).
        {
          command: "bun tests/e2e/fakeGitHubServer.ts",
          url: `http://127.0.0.1:${githubPort}/__e2e/up`,
          reuseExistingServer: false,
          timeout: 30_000,
          stdout: "pipe",
          stderr: "pipe",
          env: { E2E_GITHUB_PORT: String(githubPort) },
        },
        {
          command: "bun apps/server/src/index.ts",
          url: `${baseURL}/healthz`,
          reuseExistingServer: false,
          timeout: 60_000,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            NODE_ENV: "production",
            OFFICE_HOST: "127.0.0.1",
            OFFICE_PORT: String(port),
            OFFICE_PUBLIC_URL: baseURL,
            OFFICE_DATA_DIR: process.env.E2E_DATA_DIR ?? "",
            // Operations clone from local bare repos the spec creates (no network in tests).
            OFFICE_PROJECTS_DIR: join(process.env.E2E_DATA_DIR ?? "", "projects"),
            // Humans' clones and worktrees stay in the throwaway dir too (deleting an operation removes them).
            OFFICE_WORKTREES_DIR: join(process.env.E2E_DATA_DIR ?? "", "worktrees"),
            OFFICE_GITHUB_REMOTE_BASE: `file://${join(process.env.E2E_DATA_DIR ?? "", "remotes")}`,
            // Only reached once the board step connects a (fake) org token; see tests/e2e/fakeGitHub.ts.
            OFFICE_GITHUB_API_BASE: `http://127.0.0.1:${githubPort}`,
            // People link their GitHub accounts there too (#270): rooms open with that access.
            OFFICE_GITHUB_WEB_BASE: `http://127.0.0.1:${githubPort}`,
            GITHUB_CLIENT_ID: E2E_GITHUB_CLIENT.id,
            GITHUB_CLIENT_SECRET: E2E_GITHUB_CLIENT.secret,
            // Docker runner backend (production's default) with a per-run prefix, on a socket
            // nothing listens on: no runner is ever made, with or without a local runner image.
            OFFICE_RUNNER_BACKEND: "docker",
            OFFICE_DOCKER_RUNNER_PREFIX: runnerPrefix,
            DOCKER_HOST: `unix://${join(process.env.E2E_DATA_DIR ?? "", "no-docker.sock")}`,
            OFFICE_LOG_LEVEL: process.env.OFFICE_LOG_LEVEL ?? "warn",
            // A new room's build phase (#181), short so tests see it finish.
            OFFICE_ROOM_BUILD_SECONDS: "1",
            // The blast door's open time (#188), short so the flow sees it shut by itself.
            OFFICE_BLAST_DOOR_SECONDS: "30",
            BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? secret(),
            OFFICE_MASTER_KEY: process.env.OFFICE_MASTER_KEY ?? secret(),
          },
        },
      ],
});
