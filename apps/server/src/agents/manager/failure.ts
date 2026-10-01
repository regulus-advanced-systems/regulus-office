/**
 * Why a henchman is in `error`, in a form every operation viewer may see (#130).
 *
 * A start failure (spawn, resume, boot relaunch) becomes a short code and a
 * one-line message; `HenchmanState.statusReason` carries `<code>: <message>` so
 * the UI and the e2e can show it, and the status event persists the same text.
 * The full error summary only goes to the server log.
 *
 * SPEC §8: the published text never holds a path (the workdir, mount and HOME
 * are inside a human's area), an env assignment, a token or credential-shaped
 * string. Known errors get a fixed message built from safe fields; anything
 * else is passed through {@link safeReason}, which reuses the git output
 * redaction (URL credentials, `Authorization:` headers) and then removes paths,
 * `NAME=value` pairs and long token-like runs.
 */

import { CliMissingError } from "../../credentials/cli-probe.ts";
import { redactGitOutput } from "../../github/git.ts";
import { DockerApiError } from "../../runners/docker/engine.ts";
import { HijackError } from "../../runners/docker/hijack.ts";
import { RunnerImageMissingError } from "../../runners/docker/image.ts";
import { MountRefusedError, RunnerBusyError } from "../../runners/docker/mounts.ts";
import { HelperError } from "../../runners/linux-user/helper-client.ts";
import { WorkspaceError, type WorkspaceErrorCode } from "../../worktrees/types.ts";
import { AgentManagerError } from "./errors.ts";

/** `HenchmanState.statusReason` limit (protocol operation-state.ts). */
export const MAX_STATUS_REASON = 200;

export type StartFailureCode =
  | "runner_busy"
  | "mount_refused"
  | "runner_api"
  | "runner_image_missing"
  | "runner_helper"
  | "cli_missing"
  | WorkspaceErrorCode
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unavailable"
  | "failed"
  | "start_failed";

export interface StartFailure {
  code: StartFailureCode;
  /** One line, redacted, safe for every operation viewer. */
  message: string;
}

const REDACTED = "[redacted]";

const RULES: readonly [RegExp, string][] = [
  // Provider keys and GitHub tokens, whatever surrounds them.
  [/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})/g, REDACTED],
  // Env assignments: keep the name, drop the value.
  [/\b([A-Z][A-Z0-9_]{1,63})=("[^"]*"|'[^']*'|\S*)/g, `$1=${REDACTED}`],
  // Absolute and home-relative paths (workdirs, mounts, HOME, sockets, API paths).
  [/(^|[\s'"`(=:,[])(?:~|\.{1,2})?\/[^\s'"`),;:\]]*/g, "$1<path>"],
  // Long token-like runs: keys, container and exec ids, base64 blobs.
  [/[A-Za-z0-9+/_=-]{32,}/g, REDACTED],
];

/**
 * Make free text safe to publish: one line, redacted, at most `max` chars.
 * Idempotent, so text that is already safe passes through unchanged.
 */
export function safeReason(text: string | undefined, max = MAX_STATUS_REASON): string {
  if (!text) return "";
  let out = redactGitOutput(text);
  for (const [re, to] of RULES) out = out.replace(re, to);
  // Control characters (escape sequences, NULs) are dropped along with line breaks.
  out = out.replace(/[\p{Cc}\s]+/gu, " ").trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Classify a start failure; the message is safe for {@link safeReason}'s audience. */
export function startFailure(err: unknown): StartFailure {
  if (err instanceof RunnerBusyError) {
    // Piped labels are a program name and up to two subcommand words (piped-tracker.ts).
    const parts: string[] = [];
    if (err.sessions.length) parts.push(plural(err.sessions.length, "tmux session"));
    if (err.piped.length) {
      parts.push(`${plural(err.piped.length, "piped process")} (${err.piped.join(", ")})`);
    }
    return {
      code: "runner_busy",
      message: `the runner needs a new mount but still runs ${parts.join(" and ") || "work"}`,
    };
  }
  if (err instanceof MountRefusedError) {
    return { code: "mount_refused", message: "the workdir is outside its owner's own area" };
  }
  if (err instanceof RunnerImageMissingError) {
    // The image name comes from the office's config, not from any human.
    return {
      code: "runner_image_missing",
      message: `the runner image ${err.image} is not on the Docker host and could not be pulled`,
    };
  }
  if (err instanceof CliMissingError) return { code: "cli_missing", message: err.message };
  if (err instanceof DockerApiError || err instanceof HijackError) {
    return { code: "runner_api", message: `Docker Engine: ${err.message}` };
  }
  if (err instanceof HelperError) {
    return { code: "runner_helper", message: `office-runner-helper ${err.verb} failed` };
  }
  if (err instanceof WorkspaceError) return { code: err.code, message: err.message };
  if (err instanceof AgentManagerError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: "start_failed", message: err.message };
  return { code: "start_failed", message: "unknown error" };
}

/** `<code>: <message>`, redacted and cut to the `HenchmanState.statusReason` limit. */
export function startFailureReason(err: unknown): string {
  const { code, message } = startFailure(err);
  return safeReason(`${code}: ${message}`);
}
