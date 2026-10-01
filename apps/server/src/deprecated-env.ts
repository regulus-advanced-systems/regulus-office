/**
 * Environment variables that were renamed (#226: floors are called
 * operations). The old name keeps working: its value is used when the new
 * name is unset, and the server logs a deprecation warning at boot.
 */

/** Old name → new name. */
export const RENAMED_ENV: Readonly<Record<string, string>> = {
  OFFICE_DOCKER_FLOOR_ROOTS: "OFFICE_DOCKER_OPERATION_ROOTS",
};

export interface DeprecatedEnvUse {
  /** The deprecated name found in the environment. */
  old: string;
  /** The name to use instead. */
  now: string;
  /** False when the new name was set too and won. */
  used: boolean;
}

/**
 * `env` with every deprecated variable copied to its new name (unless the new
 * one is set), plus which deprecated names were found. Never echoes values.
 */
export function withRenamedEnv(env: Record<string, string | undefined>): {
  env: Record<string, string | undefined>;
  deprecated: DeprecatedEnvUse[];
} {
  const out = { ...env };
  const deprecated: DeprecatedEnvUse[] = [];
  for (const [old, now] of Object.entries(RENAMED_ENV)) {
    if (env[old] === undefined) continue;
    const used = env[now] === undefined || env[now] === "";
    if (used) out[now] = env[old];
    deprecated.push({ old, now, used });
  }
  return { env: out, deprecated };
}

/** The boot log line for one deprecated variable. */
export function deprecatedEnvMessage(use: DeprecatedEnvUse): string {
  return use.used
    ? `${use.old} is deprecated; rename it to ${use.now}`
    : `${use.old} is deprecated and ignored because ${use.now} is set; remove it`;
}
