/**
 * Server-side git for operation repos (SPEC §8): clone, inspect, and (in #31)
 * push. Runs the system `git` with a minimal, isolated environment.
 *
 * Credential handling: a repo's PAT is handed to one git command through
 * `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` as an
 * `http.extraHeader`, so it is never written to `.git/config`, never part of
 * a remote URL, and never in argv (visible in `ps`). Everything git prints
 * is passed through {@link redactGitOutput} before anyone sees it.
 */

export const DEFAULT_GIT_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_CHARS = 64_000;
const MAX_ERROR_CHARS = 1000;
export const REDACTED = "[redacted]";

/** `Authorization` header value GitHub accepts for a PAT over https. */
export function basicAuthHeader(token: string): string {
  return `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

/**
 * Env that makes git send the token as an extra HTTP header for this one
 * command. Merge into {@link gitBaseEnv}; never put it into an agent's env.
 */
export function gitAuthEnv(
  token: string | null | undefined,
  /** Send the header only to URLs under this prefix (`http.<url>.extraHeader`). */
  scopeUrl?: string,
): Record<string, string> {
  if (!token) return {};
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: scopeUrl ? `http.${scopeUrl}.extraHeader` : "http.extraHeader",
    GIT_CONFIG_VALUE_0: basicAuthHeader(token),
  };
}

/**
 * Isolated env for server-side git: no inherited secrets from the office
 * process, no user/system gitconfig (no credential helpers that could store
 * or leak the token), and never an interactive prompt.
 */
export function gitBaseEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: env.HOME ?? "/tmp",
    LANG: "C",
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GCM_INTERACTIVE: "never",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

/**
 * Strip credentials from git output: the token itself, its header form,
 * `user:pass@` in URLs and any `Authorization:` header echoed by curl traces.
 */
export function redactGitOutput(
  text: string,
  secrets: readonly (string | null | undefined)[] = [],
) {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    const forms = [secret, basicAuthHeader(secret).slice("Authorization: Basic ".length)];
    for (const form of forms) out = out.split(form).join(REDACTED);
  }
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`);
  out = out.replace(/(authorization:\s*)\S+(\s+\S+)?/gi, `$1${REDACTED}`);
  return out;
}

/** Short, redacted, single-paragraph reason for `operation_repos.cloneError`. */
export function summarizeGitError(stderr: string, secrets: readonly (string | null | undefined)[]) {
  const lines = redactGitOutput(stderr, secrets)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("Cloning into"));
  const text = lines.join(" ").trim() || "git failed without output";
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1)}…` : text;
}

export interface GitRunOptions {
  cwd?: string;
  /** PAT for this one command; sent as an http.extraHeader, redacted from output. */
  token?: string | null;
  /** Limit the token header to this URL prefix (e.g. the repo's remote URL). */
  tokenScope?: string;
  timeoutMs?: number;
  /** Override the binary (tests). */
  gitBinary?: string;
}

export interface GitResult {
  code: number;
  /** Redacted. */
  stdout: string;
  /** Redacted. */
  stderr: string;
  timedOut: boolean;
}

export type GitRunner = (args: readonly string[], options?: GitRunOptions) => Promise<GitResult>;

async function readCapped(stream: ReadableStream<Uint8Array> | undefined): Promise<string> {
  if (!stream) return "";
  const text = await new Response(stream).text();
  return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) : text;
}

/** Run `git <args>`; never throws for a non-zero exit, only when git cannot be started. */
export const runGit: GitRunner = async (args, options = {}) => {
  const token = options.token ?? null;
  const proc = Bun.spawn([options.gitBinary ?? "git", ...args], {
    cwd: options.cwd,
    env: { ...gitBaseEnv(), ...gitAuthEnv(token, options.tokenScope) },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
  try {
    const [stdout, stderr, code] = await Promise.all([
      readCapped(proc.stdout),
      readCapped(proc.stderr),
      proc.exited,
    ]);
    return {
      code: timedOut ? 124 : code,
      stdout: redactGitOutput(stdout, [token]),
      stderr: redactGitOutput(timedOut ? `${stderr}\ngit timed out` : stderr, [token]),
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
};
