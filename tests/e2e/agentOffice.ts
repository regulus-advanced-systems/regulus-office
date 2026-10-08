/**
 * Harness for tests/e2e/agents.e2e.ts: an office-server process the spec starts, stops and
 * restarts itself (Playwright's webServer cannot be restarted mid-run), in production mode
 * with the `docker` runner backend, a small test runner image holding the fake `claude`
 * (tests/e2e/runner), operation repos cloned from local bare repos over file://, and PRs sent to a
 * fake GitHub on 127.0.0.1.
 *
 * Runners mount only their human's own area under the worktrees dir (the default operation root).
 * Runners use host networking and run as the host user's uid:gid (never root) so they can write
 * the worktrees the office creates. They reach the office on a private address of this host,
 * like Compose runners reach `office` on 172.x (#162): the office listens on 127.0.0.1 only, and
 * a TCP relay on `<private address>:<port>` forwards to it. The fake `claude` refuses http hooks
 * to private addresses as Claude Code does, so the hooks must work from a private address.
 * Every container and volume is labelled with a per-run prefix and removed by {@link cleanup}.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { networkInterfaces, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { E2E_GITHUB_CLIENT } from "./githubClient.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const RUNNER_DIR = join(ROOT, "tests/e2e/runner");
export const RUNNER_IMAGE = "regulus-office-e2e-runner:local";
const LABEL_PREFIX = "org.regulus.office.prefix";

/** Run a command, return trimmed stdout; throws with stderr on failure. */
export function sh(cmd: string, args: string[], opts: { cwd?: string } = {}): string {
  return execFileSync(cmd, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
    },
  }).trim();
}

/** True when a Docker daemon answers. */
export function dockerAvailable(): boolean {
  try {
    sh("docker", ["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

/** The runner uid:gid: the host user's, so runners can write office-created worktrees. */
export function runnerUser(): string {
  const { uid, gid } = userInfo();
  if (uid === 0) throw new Error("run the agents e2e as a non-root user (runners refuse uid 0)");
  return `${uid}:${gid}`;
}

/** Builds the test runner image (seconds; cached by Docker after the first run). */
export function buildRunnerImage(): void {
  const [uid, gid] = runnerUser().split(":");
  sh("docker", [
    ...["build", "--quiet", "-t", RUNNER_IMAGE],
    ...["--build-arg", `RUNNER_UID=${uid}`, "--build-arg", `RUNNER_GID=${gid}`],
    RUNNER_DIR,
  ]);
}

/** Removes every runner container and HOME volume created with `prefix`. */
export function cleanupRunners(prefix: string): void {
  const filter = `label=${LABEL_PREFIX}=${prefix}`;
  const containers = sh("docker", ["ps", "-aq", "--filter", filter]).split("\n").filter(Boolean);
  if (containers.length) sh("docker", ["rm", "-f", ...containers]);
  const volumes = sh("docker", ["volume", "ls", "-q", "--filter", filter])
    .split("\n")
    .filter(Boolean);
  if (volumes.length) sh("docker", ["volume", "rm", ...volumes]);
}

/** A non-loopback private IPv4 of this host, where Claude Code refuses http hooks (#162). */
export function privateHostAddress(): string {
  const all = Object.values(networkInterfaces()).flatMap((list) => list ?? []);
  const found = all.find(
    (a) =>
      a.family === "IPv4" &&
      !a.internal &&
      /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(a.address),
  );
  if (!found) throw new Error("the agents e2e needs a private IPv4 address on this host");
  return found.address;
}

/** Forwards `host:port` to `127.0.0.1:port` (survives office restarts). */
async function startRelay(host: string, port: number): Promise<{ close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const relay: Server = createServer((inbound) => {
    const outbound = connect(port, "127.0.0.1");
    for (const socket of [inbound, outbound]) {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    }
    inbound.pipe(outbound).pipe(inbound);
    inbound.on("error", () => outbound.destroy());
    outbound.on("error", () => inbound.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    relay.once("error", reject);
    relay.listen(port, host, () => resolve());
  });
  return {
    close: () =>
      new Promise<void>((resolve) => {
        relay.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      }),
  };
}

export interface AgentOfficeOptions {
  dataDir: string;
  port: number;
  githubApiBase: string;
  /** Container/volume name prefix, unique per run. */
  prefix: string;
}

/** Waits until `url` answers 2xx, or throws after `timeoutMs`. */
async function waitForHttp(url: string, timeoutMs: number, alive: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive()) throw new Error("office-server exited during startup");
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`office-server did not answer ${url} within ${timeoutMs} ms`);
}

/** One office-server process over a fixed data dir; start/stop/restart keep the same state. */
export class AgentOffice {
  readonly baseURL: string;
  /** What runners use: a private address of this host (see the module comment). */
  readonly runnerOfficeUrl: string;
  readonly logFile: string;
  readonly projectsDir: string;
  readonly worktreesDir: string;
  readonly remotesDir: string;
  readonly #env: Record<string, string>;
  #proc: ChildProcess | null = null;
  #exited: Promise<void> = Promise.resolve();
  #starts = 0;
  #relay: { close(): Promise<void> } | null = null;

  constructor(readonly opts: AgentOfficeOptions) {
    this.baseURL = `http://127.0.0.1:${opts.port}`;
    this.runnerOfficeUrl = `http://${privateHostAddress()}:${opts.port}`;
    this.logFile = join(opts.dataDir, "office-server.log");
    this.projectsDir = join(opts.dataDir, "projects");
    this.worktreesDir = join(opts.dataDir, "worktrees");
    this.remotesDir = join(opts.dataDir, "remotes");
    for (const d of [this.projectsDir, this.worktreesDir, this.remotesDir])
      mkdirSync(d, { recursive: true });
    const secret = () => randomBytes(32).toString("base64");
    this.#env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? opts.dataDir,
      ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      NODE_ENV: "production",
      OFFICE_HOST: "127.0.0.1",
      OFFICE_PORT: String(opts.port),
      OFFICE_PUBLIC_URL: this.baseURL,
      OFFICE_DATA_DIR: opts.dataDir,
      OFFICE_PROJECTS_DIR: this.projectsDir,
      OFFICE_WORKTREES_DIR: this.worktreesDir,
      OFFICE_GITHUB_REMOTE_BASE: `file://${this.remotesDir}`,
      OFFICE_GITHUB_API_BASE: opts.githubApiBase,
      // People link their accounts on the same fake GitHub (#270): rooms open with that access.
      OFFICE_GITHUB_WEB_BASE: opts.githubApiBase,
      GITHUB_CLIENT_ID: E2E_GITHUB_CLIENT.id,
      GITHUB_CLIENT_SECRET: E2E_GITHUB_CLIENT.secret,
      OFFICE_LOG_LEVEL: process.env.OFFICE_LOG_LEVEL ?? "info",
      // A new room's build phase (#181), short so the flow walks in at once (#186).
      OFFICE_ROOM_BUILD_SECONDS: "1",
      // Same secrets across restarts: sessions and encrypted rows must survive.
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? secret(),
      OFFICE_MASTER_KEY: process.env.OFFICE_MASTER_KEY ?? secret(),
      OFFICE_RUNNER_BACKEND: "docker",
      OFFICE_RUNNER_IMAGE: RUNNER_IMAGE,
      OFFICE_RUNNER_OFFICE_URL: this.runnerOfficeUrl,
      OFFICE_DOCKER_RUNNER_PREFIX: opts.prefix,
      OFFICE_DOCKER_RUNNER_USER: runnerUser(),
      OFFICE_DOCKER_RUNNER_NETWORK: "host",
    };
  }

  get running(): boolean {
    return this.#proc !== null && this.#proc.exitCode === null && this.#proc.signalCode === null;
  }

  /** The server process id (changes on restart). */
  get pid(): number | undefined {
    return this.#proc?.pid;
  }

  async start(): Promise<void> {
    if (this.running) throw new Error("office-server already running");
    this.#relay ??= await startRelay(new URL(this.runnerOfficeUrl).hostname, this.opts.port);
    this.#starts += 1;
    const log = createWriteStream(this.logFile, { flags: "a" });
    log.write(`\n===== start #${this.#starts} =====\n`);
    const proc = spawn("bun", ["apps/server/src/index.ts"], {
      cwd: ROOT,
      env: this.#env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout?.pipe(log, { end: false });
    proc.stderr?.pipe(log, { end: false });
    this.#proc = proc;
    this.#exited = new Promise((r) => proc.once("exit", () => r()));
    await waitForHttp(`${this.baseURL}/healthz`, 60_000, () => this.running);
  }

  /** SIGTERM (graceful shutdown: the manager detaches from agents, never kills them). */
  async stop(): Promise<void> {
    const proc = this.#proc;
    if (!proc || !this.running) return;
    proc.kill("SIGTERM");
    const killed = setTimeout(() => proc.kill("SIGKILL"), 20_000);
    await this.#exited;
    clearTimeout(killed);
    this.#proc = null;
  }

  /** Stops the server and the relay. */
  async close(): Promise<void> {
    await this.stop();
    const relay = this.#relay;
    this.#relay = null;
    await relay?.close();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** The server log so far (attached to failures). */
  log(): string {
    try {
      return readFileSync(this.logFile, "utf8");
    } catch {
      return "";
    }
  }
}
