/**
 * Typed office-server configuration parsed from the environment.
 *
 * Env names follow deploy/.env.example and deploy/docker-compose.yml
 * (docs/SPEC.md §4.2, §8). Secrets are wrapped in {@link SecretValue} so
 * they cannot leak through JSON.stringify, template strings or inspect;
 * {@link redactConfig} produces a dump that is safe to log.
 */
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { PM_ROUND_EVERY_MS, PM_ROUND_MAX_MS, PM_ROUND_MIN_MS } from "@regulus/protocol";
import { z } from "zod";
import { type DeprecatedEnvUse, withRenamedEnv } from "./deprecated-env.ts";
import {
  checkSandboxSettings,
  DEFAULT_SANDBOX_SETTINGS,
  type SandboxSettings,
} from "./runners/sandbox.ts";

export const DEFAULT_PORT = 4600;
/** Production clone root for operation repos (SPEC §8). */
export const DEFAULT_PROJECTS_DIR = "/srv/office/projects";
export const DEFAULT_GITHUB_REMOTE_BASE = "https://github.com";
/** Production root for per-agent git worktrees (SPEC §8). */
export const DEFAULT_WORKTREES_DIR = "/srv/office/worktrees";
export const DEFAULT_GITHUB_API_BASE = "https://api.github.com";
export const DEFAULT_GITHUB_WEB_BASE = "https://github.com";
export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const REDACTED = "[redacted]";

/** Holds a secret. Every stringification path yields "[redacted]"; call `expose()` on purpose. */
export class SecretValue<T = string> {
  readonly #value: T;
  constructor(value: T) {
    this.#value = value;
  }
  expose(): T {
    return this.#value;
  }
  toString(): string {
    return REDACTED;
  }
  toJSON(): string {
    return REDACTED;
  }
  [inspect.custom](): string {
    return REDACTED;
  }
}

/** Decodes OFFICE_MASTER_KEY: 32 random bytes, base64 (SPEC §8, deploy/.env.example). */
const masterKeySchema = z
  .string()
  .trim()
  .min(1)
  .transform((raw, ctx) => {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(raw, "base64"));
    } catch {
      ctx.addIssue({ code: "custom", message: "must be base64" });
      return z.NEVER;
    }
    if (bytes.byteLength !== 32) {
      ctx.addIssue({
        code: "custom",
        message: `must decode to 32 bytes (got ${bytes.byteLength}); generate with: openssl rand -base64 32`,
      });
      return z.NEVER;
    }
    return new SecretValue(bytes);
  });

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const str = () => z.string().trim().min(1);

/** "true"/"1"/"yes"/"on" and "false"/"0"/"no"/"off", case-insensitive. */
const bool = (fallback: boolean) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["true", "1", "yes", "on", "false", "0", "no", "off"]))
      .transform((v) => ["true", "1", "yes", "on"].includes(v))
      .default(fallback),
  );

/** A non-empty string wrapped in {@link SecretValue} at parse time. */
const secretStr = (min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .transform((v) => new SecretValue(v));

export const RUNNER_BACKENDS = ["docker", "linux-user", "local"] as const;
export type RunnerBackendChoice = (typeof RUNNER_BACKENDS)[number];

export const DEFAULT_RUNNER_IMAGE = "ghcr.io/regulus-advanced-systems/regulus-office-runner:latest";

const absPath = () => str().regex(/^\//, "must be an absolute path");

const splitList = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** `512m`, `4g`, `1073741824`: bytes, with an optional k/m/g suffix (powers of 1024). */
const byteSize = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^\d+[kmg]?b?$/, "bytes with optional k/m/g suffix, e.g. 4g")
  .transform((v) => {
    const unit = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[v.replace(/b$/, "").slice(-1)] ?? 1;
    return Number.parseInt(v, 10) * unit;
  });

/** `/srv/office/projects=regulus_projects,...`: office path → named volume holding it. */
const volumeMap = z.string().transform((v, ctx) =>
  splitList(v).map((pair) => {
    const [path = "", volume = ""] = pair.split("=").map((x) => x.trim());
    if (!path.startsWith("/") || !volume) {
      ctx.addIssue({ code: "custom", message: "expected /abs/path=volume-name[,...]" });
    }
    return { path, volume };
  }),
);

/** Minimum length for BETTER_AUTH_SECRET; `openssl rand -base64 32` yields 44 characters. */
export const MIN_AUTH_SECRET_LENGTH = 32;

export const envSchema = z.object({
  OFFICE_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(65535).default(DEFAULT_PORT),
  ),
  OFFICE_HOST: z.preprocess(emptyToUndefined, str().default("0.0.0.0")),
  OFFICE_DATA_DIR: z.preprocess(emptyToUndefined, str().default("./data")),
  OFFICE_PROJECTS_DIR: z.preprocess(emptyToUndefined, str().optional()),
  OFFICE_GITHUB_REMOTE_BASE: z.preprocess(emptyToUndefined, z.url().optional()),
  OFFICE_WORKTREES_DIR: z.preprocess(emptyToUndefined, str().optional()),
  OFFICE_GITHUB_API_BASE: z.preprocess(emptyToUndefined, z.url().optional()),
  OFFICE_GITHUB_WEB_BASE: z.preprocess(emptyToUndefined, z.url().optional()),
  // Office GitHub App from the environment (#141); overrides the one stored from the manifest flow.
  GITHUB_APP_ID: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  GITHUB_APP_CLIENT_ID: z.preprocess(emptyToUndefined, str().optional()),
  GITHUB_APP_PRIVATE_KEY: z.preprocess(emptyToUndefined, secretStr().optional()),
  GITHUB_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, secretStr().optional()),
  // Board sync (#35): poll GitHub when webhooks are not arriving.
  OFFICE_GITHUB_POLLING: bool(true),
  OFFICE_GITHUB_POLL_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(30).max(3600).default(60),
  ),
  // The office PM's rounds (#60): one every N seconds, at fixed times of the clock.
  OFFICE_PM_ROUND_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int()
      .min(PM_ROUND_MIN_MS / 1000)
      .max(PM_ROUND_MAX_MS / 1000)
      .default(PM_ROUND_EVERY_MS / 1000),
  ),
  OFFICE_MASTER_KEY: z.preprocess(emptyToUndefined, masterKeySchema.optional()),
  OFFICE_PUBLIC_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  OFFICE_LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(LOG_LEVELS).default("info")),
  OFFICE_WEB_DIST: z.preprocess(emptyToUndefined, str().optional()),
  OFFICE_SHUTDOWN_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).default(10_000),
  ),
  BETTER_AUTH_SECRET: z.preprocess(emptyToUndefined, secretStr(MIN_AUTH_SECRET_LENGTH).optional()),
  GITHUB_CLIENT_ID: z.preprocess(emptyToUndefined, str().optional()),
  GITHUB_CLIENT_SECRET: z.preprocess(emptyToUndefined, secretStr().optional()),
  OFFICE_OPEN_SIGNUP: bool(false),
  OFFICE_CLAUDE_TRUST_WORKTREES: bool(true),
  // Runner backend (SPEC §8, D6): docker (Compose default), linux-user (bare
  // install), or local (dev/test only: agents run as the office user).
  OFFICE_RUNNER_BACKEND: z.preprocess(emptyToUndefined, z.enum(RUNNER_BACKENDS).optional()),
  OFFICE_RUNNER_OFFICE_URL: z.preprocess(
    emptyToUndefined,
    z.url({ protocol: /^https?$/ }).optional(),
  ),
  // Docker runner backend (SPEC §8); see DockerBackendConfig.
  DOCKER_HOST: z.preprocess(emptyToUndefined, str().default("unix:///var/run/docker.sock")),
  OFFICE_RUNNER_IMAGE: z.preprocess(emptyToUndefined, str().default(DEFAULT_RUNNER_IMAGE)),
  OFFICE_DOCKER_RUNNER_PREFIX: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9_.-]{0,31}$/, "lowercase letters, digits, _ . - (max 32)")
      .default("office"),
  ),
  OFFICE_DOCKER_RUNNER_USER: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^\d+:\d+$/, "must be a numeric uid:gid")
      .refine((v) => !v.startsWith("0:"), "must not be root (SPEC §8: runners use a non-root uid)")
      .default("1001:1001"),
  ),
  OFFICE_DOCKER_RUNNER_HOME: z.preprocess(emptyToUndefined, absPath().default("/home/runner")),
  OFFICE_DOCKER_RUNNER_NETWORK: z.preprocess(emptyToUndefined, str().optional()),
  OFFICE_DOCKER_RUNNER_MEMORY: z.preprocess(emptyToUndefined, byteSize.optional()),
  OFFICE_DOCKER_RUNNER_CPUS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().positive().optional(),
  ),
  OFFICE_DOCKER_RUNNER_PIDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(4096),
  ),
  OFFICE_DOCKER_OPERATION_ROOTS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .transform((v) => splitList(v))
      .pipe(z.array(absPath()).min(1))
      .optional(),
  ),
  OFFICE_DOCKER_VOLUME_MAP: z.preprocess(emptyToUndefined, volumeMap.default([])),
  // Hermes run by the office (#57); see HermesConfig. Unset image: the engine is off.
  OFFICE_HERMES_IMAGE: z.preprocess(emptyToUndefined, str().optional()),
  OFFICE_HERMES_MEMORY: z.preprocess(emptyToUndefined, byteSize.optional()),
  OFFICE_HERMES_CPUS: z.preprocess(emptyToUndefined, z.coerce.number().positive().optional()),
  OFFICE_HERMES_PIDS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  // Per-agent sandboxes (SPEC §8, D18, #169); see SandboxConfig. Defaults: runners/sandbox.ts.
  OFFICE_SANDBOXES: bool(true),
  OFFICE_SANDBOX_MEMORY: z.preprocess(emptyToUndefined, byteSize.optional()),
  OFFICE_SANDBOX_CPUS: z.preprocess(emptyToUndefined, z.coerce.number().positive().optional()),
  OFFICE_SANDBOX_PIDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  OFFICE_SANDBOX_PORT_BASE: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1024).max(65535).optional(),
  ),
  OFFICE_SANDBOX_PORT_SPAN: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1000).optional(),
  ),
  OFFICE_SANDBOX_PORT_SLOTS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(65000).optional(),
  ),
});

/** The office GitHub App from GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY (#141; D14). */
export interface GithubAppEnvConfig {
  appId: number;
  clientId: string | null;
  privateKey: SecretValue<string>;
  webhookSecret: SecretValue<string> | undefined;
}

/** GitHub OAuth app used for human sign-in (SPEC §4.2 Auth); unrelated to agent credentials. */
export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: SecretValue<string>;
}

export interface OfficeConfig {
  /** Renamed variables still set under their old name (logged at boot, see deprecated-env.ts). */
  deprecatedEnv?: DeprecatedEnvUse[];
  /** TCP port to listen on. 0 picks a free port (tests). */
  port: number;
  /** Interface to bind. */
  host: string;
  /** Absolute path to the SQLite database, blobs and other persistent state. */
  dataDir: string;
  /**
   * Where operation repos are cloned: `<projectsDir>/<operation-slug>/<repo>` (SPEC §8).
   * Default `/srv/office/projects` in production, `<dataDir>/projects` otherwise.
   */
  projectsDir: string;
  /**
   * Base URL operation repos are cloned from, `<base>/<owner>/<name>.git`.
   * Default `https://github.com`; tests point it at local bare repos.
   */
  githubRemoteBase: string;
  /**
   * Per-agent git worktrees: `<worktreesDir>/<operation-slug>/<agentId>` (SPEC §8).
   * Default `/srv/office/worktrees` in production, `<dataDir>/worktrees` otherwise.
   */
  worktreesDir: string;
  /** GitHub REST base for pull requests. Default `https://api.github.com`; tests use a fake. */
  githubApiBase: string;
  /** GitHub web base the manifest form posts to. Default `https://github.com`. */
  githubWebBase: string;
  /** Office GitHub App from the environment; overrides the stored connection when set. */
  githubApp: GithubAppEnvConfig | undefined;
  /**
   * Board sync (#35): poll issues/PRs with conditional requests while no
   * webhooks arrive (OFFICE_GITHUB_POLLING, default true), every
   * OFFICE_GITHUB_POLL_SECONDS (30..3600, default 60).
   */
  githubSync: { polling: boolean; pollIntervalMs: number };
  /**
   * Time between two rounds of the office PM through the rooms it was granted (#60):
   * OFFICE_PM_ROUND_SECONDS (20..3600, default 900: four an hour, on the quarter).
   */
  pmRoundMs: number;
  /** Envelope-encryption root key (SPEC §8 rule 2). Absent means secrets cannot be stored. */
  masterKey: SecretValue<Uint8Array> | undefined;
  /** Externally reachable origin, used for links and OAuth callbacks. */
  publicUrl: string;
  logLevel: LogLevel;
  /** Absolute path to the built web client (apps/web/dist). */
  webDist: string;
  /** How long graceful shutdown waits for in-flight requests before forcing. */
  shutdownTimeoutMs: number;
  /** Better Auth signing/encryption secret. Absent means auth cannot start. */
  betterAuthSecret: SecretValue<string> | undefined;
  /** GitHub social login for humans; undefined disables the provider. */
  githubOAuth: GithubOAuthConfig | undefined;
  /**
   * Allow anyone to register as `member` once the office has an owner.
   * Default false: after the first user, sign-up needs an invite link.
   */
  openSignup: boolean;
  /**
   * Where agents run (SPEC §8). Default `docker` in production and `local`
   * otherwise; `local` (tmux as the office user, no isolation) is refused in
   * production.
   */
  runnerBackend: RunnerBackendChoice;
  /**
   * `OFFICE_RUNNER_OFFICE_URL`: the office's base URL as reachable from inside a runner, fed to
   * adapters as `RunnerContext.officeUrl` for Claude hooks and the statusline forwarder. Compose
   * sets `http://office:4600` (the office's alias on the runners network); the default,
   * `http://127.0.0.1:<port>`, suits the linux-user backend where runners share the host.
   */
  runnerOfficeUrl: string;
  /**
   * `OFFICE_CLAUDE_TRUST_WORKTREES` (default true): before a Claude Code henchman starts, mark its
   * own office-created worktree trusted in the runner's `~/.claude.json`, so Claude's workspace
   * trust dialog does not hold the henchman (#158). Never the human's clone or any other folder.
   */
  claudeTrustWorktrees: boolean;
  /** Docker runner backend settings; only used when that backend is selected. */
  docker: DockerBackendConfig;
  /**
   * Per-agent sandboxes (SPEC §8, D18, #169) for the docker and linux-user backends:
   * null when `OFFICE_SANDBOXES=false` (henchmen then run in their human's runner).
   */
  sandbox: SandboxConfig | null;
  /** Hermes run by the office (#57); null when `OFFICE_HERMES_IMAGE` is not set. */
  hermes: HermesConfig | null;
}

/**
 * `OFFICE_HERMES_*`: the pinned Hermes image (hermes-runner/Dockerfile) the
 * office starts one container per managed Hermes agent from, and that
 * container's limits (defaults: 2 GiB, 1 CPU, 512 pids). Docker backend only.
 */
export interface HermesConfig {
  image: string;
  memoryBytes?: number;
  cpus?: number;
  pids?: number;
}

/**
 * `OFFICE_SANDBOX_*`: limits and ports of each henchman's sandbox. Defaults
 * (runners/sandbox.ts) suit the 8 vCPU / 16 GB central VM (D11): 2 GiB, 2 CPUs,
 * 1024 pids, ports 20000 + 10 per slot, 2000 slots.
 */
export type SandboxConfig = SandboxSettings;

/**
 * Docker runner backend settings (SPEC §8): one runner container per human from
 * `image`, reached through `dockerHost` (the local socket, or a
 * docker-socket-proxy such as `tcp://docker-proxy:2375`).
 */
export interface DockerBackendConfig {
  /** `DOCKER_HOST`: `unix:///var/run/docker.sock` or `tcp://host:port` (no TLS). */
  dockerHost: string;
  image: string;
  /** Container/volume name prefix: `<prefix>-runner-<userId>`, `<prefix>-home-<userId>`. */
  prefix: string;
  /** Numeric non-root `uid:gid` the runner runs as (runner/Dockerfile: 1001). */
  user: string;
  /** HOME inside the runner; the human's credential volume is mounted here. */
  home: string;
  /**
   * Network for runners (so hooks can reach the office at `runnerOfficeUrl`); default bridge
   * when unset. Compose uses a dedicated `<project>_runners` network without docker-proxy.
   */
  network: string | undefined;
  memoryBytes: number | undefined;
  /** CPU limit in cores (Docker NanoCpus / 1e9). */
  cpus: number | undefined;
  pidsLimit: number;
  /** Roots under which a human's own `<root>/<operation>/<runner id>` dir is mounted (#114). */
  operationRoots: string[];
  /** Office paths that live in named volumes (Compose); mounted with a volume subpath. */
  volumeMap: { path: string; volume: string }[];
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Path of apps/web/dist relative to this file; overridable via OFFICE_WEB_DIST. */
const defaultWebDist = () => resolve(import.meta.dir, "../../web/dist");

/**
 * Parses the given environment (defaults to `process.env`) into an {@link OfficeConfig}.
 * Throws {@link ConfigError} with every offending variable named and no values echoed.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): OfficeConfig {
  const renamed = withRenamedEnv(env);
  const parsed = envSchema.safeParse(renamed.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "?"}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  if (Boolean(e.GITHUB_APP_ID) !== Boolean(e.GITHUB_APP_PRIVATE_KEY)) {
    throw new ConfigError(
      "Invalid environment:\n  GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY: set both to configure the office GitHub App, or neither",
    );
  }
  if (Boolean(e.GITHUB_CLIENT_ID) !== Boolean(e.GITHUB_CLIENT_SECRET)) {
    throw new ConfigError(
      "Invalid environment:\n  GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET: set both to enable GitHub login, or neither",
    );
  }
  const dataDir = resolve(e.OFFICE_DATA_DIR);
  const production = env.NODE_ENV === "production";
  if (production && e.OFFICE_RUNNER_BACKEND === "local") {
    throw new ConfigError(
      "Invalid environment:\n  OFFICE_RUNNER_BACKEND: local is for development only; use docker or linux-user",
    );
  }
  const worktreesDir = resolve(
    e.OFFICE_WORKTREES_DIR ?? (production ? DEFAULT_WORKTREES_DIR : join(dataDir, "worktrees")),
  );
  let sandbox: SandboxConfig | null = null;
  if (e.OFFICE_SANDBOXES) {
    try {
      sandbox = checkSandboxSettings({
        memoryBytes: e.OFFICE_SANDBOX_MEMORY ?? DEFAULT_SANDBOX_SETTINGS.memoryBytes,
        cpus: e.OFFICE_SANDBOX_CPUS ?? DEFAULT_SANDBOX_SETTINGS.cpus,
        pids: e.OFFICE_SANDBOX_PIDS ?? DEFAULT_SANDBOX_SETTINGS.pids,
        portBase: e.OFFICE_SANDBOX_PORT_BASE ?? DEFAULT_SANDBOX_SETTINGS.portBase,
        portSpan: e.OFFICE_SANDBOX_PORT_SPAN ?? DEFAULT_SANDBOX_SETTINGS.portSpan,
        portSlots: e.OFFICE_SANDBOX_PORT_SLOTS ?? DEFAULT_SANDBOX_SETTINGS.portSlots,
      });
    } catch {
      throw new ConfigError(
        "Invalid environment:\n  OFFICE_SANDBOX_PORT_*: base + span * slots must stay within 65536",
      );
    }
  }
  return {
    sandbox,
    hermes: e.OFFICE_HERMES_IMAGE
      ? {
          image: e.OFFICE_HERMES_IMAGE,
          memoryBytes: e.OFFICE_HERMES_MEMORY,
          cpus: e.OFFICE_HERMES_CPUS,
          pids: e.OFFICE_HERMES_PIDS,
        }
      : null,
    port: e.OFFICE_PORT,
    host: e.OFFICE_HOST,
    dataDir,
    projectsDir: resolve(
      e.OFFICE_PROJECTS_DIR ?? (production ? DEFAULT_PROJECTS_DIR : join(dataDir, "projects")),
    ),
    githubRemoteBase: (e.OFFICE_GITHUB_REMOTE_BASE ?? DEFAULT_GITHUB_REMOTE_BASE).replace(
      /\/+$/,
      "",
    ),
    worktreesDir,
    githubApiBase: (e.OFFICE_GITHUB_API_BASE ?? DEFAULT_GITHUB_API_BASE).replace(/\/+$/, ""),
    githubWebBase: (e.OFFICE_GITHUB_WEB_BASE ?? DEFAULT_GITHUB_WEB_BASE).replace(/\/+$/, ""),
    githubApp:
      e.GITHUB_APP_ID && e.GITHUB_APP_PRIVATE_KEY
        ? {
            appId: e.GITHUB_APP_ID,
            clientId: e.GITHUB_APP_CLIENT_ID ?? null,
            privateKey: e.GITHUB_APP_PRIVATE_KEY,
            webhookSecret: e.GITHUB_WEBHOOK_SECRET,
          }
        : undefined,
    githubSync: {
      polling: e.OFFICE_GITHUB_POLLING,
      pollIntervalMs: e.OFFICE_GITHUB_POLL_SECONDS * 1000,
    },
    pmRoundMs: e.OFFICE_PM_ROUND_SECONDS * 1000,
    masterKey: e.OFFICE_MASTER_KEY,
    publicUrl: e.OFFICE_PUBLIC_URL ?? `http://localhost:${e.OFFICE_PORT}`,
    logLevel: e.OFFICE_LOG_LEVEL,
    webDist: e.OFFICE_WEB_DIST ? resolve(e.OFFICE_WEB_DIST) : defaultWebDist(),
    shutdownTimeoutMs: e.OFFICE_SHUTDOWN_TIMEOUT_MS,
    betterAuthSecret: e.BETTER_AUTH_SECRET,
    githubOAuth:
      e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET
        ? { clientId: e.GITHUB_CLIENT_ID, clientSecret: e.GITHUB_CLIENT_SECRET }
        : undefined,
    openSignup: e.OFFICE_OPEN_SIGNUP,
    runnerBackend: e.OFFICE_RUNNER_BACKEND ?? (production ? "docker" : "local"),
    runnerOfficeUrl: (e.OFFICE_RUNNER_OFFICE_URL ?? `http://127.0.0.1:${e.OFFICE_PORT}`).replace(
      /\/+$/,
      "",
    ),
    claudeTrustWorktrees: e.OFFICE_CLAUDE_TRUST_WORKTREES,
    docker: {
      dockerHost: e.DOCKER_HOST,
      image: e.OFFICE_RUNNER_IMAGE,
      prefix: e.OFFICE_DOCKER_RUNNER_PREFIX,
      user: e.OFFICE_DOCKER_RUNNER_USER,
      home: e.OFFICE_DOCKER_RUNNER_HOME,
      network: e.OFFICE_DOCKER_RUNNER_NETWORK,
      memoryBytes: e.OFFICE_DOCKER_RUNNER_MEMORY,
      cpus: e.OFFICE_DOCKER_RUNNER_CPUS,
      pidsLimit: e.OFFICE_DOCKER_RUNNER_PIDS,
      // Default: the worktrees dir, which holds every human's own area (#114).
      operationRoots: e.OFFICE_DOCKER_OPERATION_ROOTS ?? [worktreesDir],
      volumeMap: e.OFFICE_DOCKER_VOLUME_MAP,
    },
    deprecatedEnv: renamed.deprecated,
  };
}

/** A copy of the config that is safe to log: secrets removed, presence reported as flags. */
export function redactConfig(config: OfficeConfig): Record<string, unknown> {
  const { masterKey, betterAuthSecret, githubOAuth, githubApp, ...rest } = config;
  return {
    ...rest,
    githubApp: githubApp
      ? { appId: githubApp.appId, clientId: githubApp.clientId, privateKeySet: true }
      : undefined,
    masterKeySet: Boolean(masterKey),
    betterAuthSecretSet: Boolean(betterAuthSecret),
    githubOAuth: githubOAuth ? { clientId: githubOAuth.clientId } : undefined,
  };
}
