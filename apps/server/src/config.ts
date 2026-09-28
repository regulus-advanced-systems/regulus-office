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
import { z } from "zod";

export const DEFAULT_PORT = 4600;
/** Production clone root for floor repos (SPEC §8). */
export const DEFAULT_PROJECTS_DIR = "/srv/office/projects";
export const DEFAULT_GITHUB_REMOTE_BASE = "https://github.com";
/** Production root for per-agent git worktrees (SPEC §8). */
export const DEFAULT_WORKTREES_DIR = "/srv/office/worktrees";
export const DEFAULT_GITHUB_API_BASE = "https://api.github.com";
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
  // Runner backend (SPEC §8, D6): docker (Compose default), linux-user (bare
  // install), or local (dev/test only: agents run as the office user).
  OFFICE_RUNNER_BACKEND: z.preprocess(emptyToUndefined, z.enum(RUNNER_BACKENDS).optional()),
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
  OFFICE_DOCKER_FLOOR_ROOTS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default("/srv/office/projects,/srv/office/worktrees")
      .transform((v) => splitList(v))
      .pipe(z.array(absPath()).min(1)),
  ),
  OFFICE_DOCKER_VOLUME_MAP: z.preprocess(emptyToUndefined, volumeMap.default([])),
});

/** GitHub OAuth app used for human sign-in (SPEC §4.2 Auth); unrelated to agent credentials. */
export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: SecretValue<string>;
}

export interface OfficeConfig {
  /** TCP port to listen on. 0 picks a free port (tests). */
  port: number;
  /** Interface to bind. */
  host: string;
  /** Absolute path to the SQLite database, blobs and other persistent state. */
  dataDir: string;
  /**
   * Where floor repos are cloned: `<projectsDir>/<floor-slug>/<repo>` (SPEC §8).
   * Default `/srv/office/projects` in production, `<dataDir>/projects` otherwise.
   */
  projectsDir: string;
  /**
   * Base URL floor repos are cloned from, `<base>/<owner>/<name>.git`.
   * Default `https://github.com`; tests point it at local bare repos.
   */
  githubRemoteBase: string;
  /**
   * Per-agent git worktrees: `<worktreesDir>/<floor-slug>/<agentId>` (SPEC §8).
   * Default `/srv/office/worktrees` in production, `<dataDir>/worktrees` otherwise.
   */
  worktreesDir: string;
  /** GitHub REST base for pull requests. Default `https://api.github.com`; tests use a fake. */
  githubApiBase: string;
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
  /** Docker runner backend settings; only used when that backend is selected. */
  docker: DockerBackendConfig;
}

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
  /** Network for runners (so hooks can reach the office); default bridge when unset. */
  network: string | undefined;
  memoryBytes: number | undefined;
  /** CPU limit in cores (Docker NanoCpus / 1e9). */
  cpus: number | undefined;
  pidsLimit: number;
  /** Floor directories are mounted per `<root>/<floor>` for each root. */
  floorRoots: string[];
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
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "?"}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
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
  return {
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
    worktreesDir: resolve(
      e.OFFICE_WORKTREES_DIR ?? (production ? DEFAULT_WORKTREES_DIR : join(dataDir, "worktrees")),
    ),
    githubApiBase: (e.OFFICE_GITHUB_API_BASE ?? DEFAULT_GITHUB_API_BASE).replace(/\/+$/, ""),
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
      floorRoots: e.OFFICE_DOCKER_FLOOR_ROOTS,
      volumeMap: e.OFFICE_DOCKER_VOLUME_MAP,
    },
  };
}

/** A copy of the config that is safe to log: secrets removed, presence reported as flags. */
export function redactConfig(config: OfficeConfig): Record<string, unknown> {
  const { masterKey, betterAuthSecret, githubOAuth, ...rest } = config;
  return {
    ...rest,
    masterKeySet: Boolean(masterKey),
    betterAuthSecretSet: Boolean(betterAuthSecret),
    githubOAuth: githubOAuth ? { clientId: githubOAuth.clientId } : undefined,
  };
}
