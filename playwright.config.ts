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
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const external = process.env.E2E_BASE_URL?.replace(/\/+$/, "");
const port = Number(process.env.E2E_PORT ?? 4610);
const baseURL = external ?? `http://127.0.0.1:${port}`;
const ci = Boolean(process.env.CI);

// Evaluated once in the runner and again in each worker; the env var makes them agree.
if (!external && !process.env.E2E_DATA_DIR)
  process.env.E2E_DATA_DIR = mkdtempSync(join(tmpdir(), "regulus-e2e-"));
/** Throwaway per-run secrets unless the caller provides them (CI generates its own). */
const secret = () => randomBytes(32).toString("base64");

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.e2e.ts",
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
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        // Software WebGL for the R3F scene on GPU-less CI runners.
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
      },
    },
  ],
  webServer: external
    ? undefined
    : {
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
          OFFICE_LOG_LEVEL: process.env.OFFICE_LOG_LEVEL ?? "warn",
          BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? secret(),
          OFFICE_MASTER_KEY: process.env.OFFICE_MASTER_KEY ?? secret(),
        },
      },
});
