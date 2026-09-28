/**
 * Structured logging (docs/SPEC.md §11): pino, JSON lines on stdout.
 *
 * Redaction is defence in depth for SPEC §8: provider tokens, API keys and
 * OFFICE_MASTER_KEY must never be logged. Callers still must not put them
 * in log objects; these paths only catch the obvious field names.
 */
import pino, { type DestinationStream, type Logger } from "pino";
import type { LogLevel } from "./config.ts";

export type { Logger } from "pino";

/** Field names that are censored wherever they appear (top level or one level down). */
export const SECRET_FIELDS = [
  "masterKey",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "secret",
  "password",
  "OFFICE_MASTER_KEY",
  "BETTER_AUTH_SECRET",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "LIVEKIT_API_SECRET",
  "POSTGRES_PASSWORD",
] as const;

const HEADER_FIELDS = ["authorization", "cookie", "set-cookie", "x-office-token"] as const;

export function redactPaths(): string[] {
  const paths: string[] = [];
  for (const f of SECRET_FIELDS) {
    paths.push(f, `*.${f}`, `*.*.${f}`);
  }
  for (const h of HEADER_FIELDS) {
    paths.push(`req.headers.${h}`, `res.headers.${h}`, `headers.${h}`);
  }
  return paths;
}

export interface LoggerOptions {
  level: LogLevel;
  /** Where lines go; defaults to stdout. Tests pass a capturing stream. */
  destination?: DestinationStream;
  /** Extra fields bound to every line (e.g. `{ service: "office-server" }`). */
  base?: Record<string, unknown>;
}

export function createLogger(options: LoggerOptions): Logger {
  const pinoOptions: pino.LoggerOptions = {
    level: options.level,
    base: { service: "office-server", ...options.base },
    redact: { paths: redactPaths(), censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions);
}
