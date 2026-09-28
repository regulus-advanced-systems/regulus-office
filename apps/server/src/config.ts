/**
 * Typed office-server configuration parsed from the environment.
 *
 * Env names follow deploy/.env.example and deploy/docker-compose.yml
 * (docs/SPEC.md §4.2, §8). Secrets are wrapped in {@link SecretValue} so
 * they cannot leak through JSON.stringify, template strings or inspect;
 * {@link redactConfig} produces a dump that is safe to log.
 */
import { resolve } from "node:path";
import { inspect } from "node:util";
import { z } from "zod";

export const DEFAULT_PORT = 4600;
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

/** A non-empty string wrapped in {@link SecretValue} at parse time. */
const secretStr = (min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .transform((v) => new SecretValue(v));

/** Minimum length for BETTER_AUTH_SECRET; `openssl rand -base64 32` yields 44 characters. */
export const MIN_AUTH_SECRET_LENGTH = 32;

export const envSchema = z.object({
  OFFICE_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(65535).default(DEFAULT_PORT),
  ),
  OFFICE_HOST: z.preprocess(emptyToUndefined, str().default("0.0.0.0")),
  OFFICE_DATA_DIR: z.preprocess(emptyToUndefined, str().default("./data")),
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
  return {
    port: e.OFFICE_PORT,
    host: e.OFFICE_HOST,
    dataDir: resolve(e.OFFICE_DATA_DIR),
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
