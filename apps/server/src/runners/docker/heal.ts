/**
 * Self-healing of broken runner containers (#151).
 *
 * A runner container outlives the office and can outlive the host's Docker
 * storage: after a storage corruption the daemon still lists and inspects it,
 * but `POST /containers/{id}/start` answers `500 RWLayer of container … is
 * unexpectedly nil`, forever. Reusing it failed every sign-in and spawn of that
 * human. `RunnerContainers` (containers.ts) removes and recreates such a
 * container from the current runner image, keeping the HOME volume (CLI
 * logins), and only while it is not running: no tmux session can be alive in
 * a stopped container. This module decides which Docker failures qualify.
 *
 * Recreated:
 * - start fails with a known unrecoverable 5xx (missing RW layer, image or
 *   layer gone, see {@link BROKEN});
 * - start fails with any other 5xx twice in a row (a failure that repeats);
 * - the container is in the `dead` state;
 * - inspecting it fails with a 5xx and the container list says it is not running;
 * - start answers 404 (it vanished in between): a new one is created.
 *
 * Not recreated: a running container (ever), a daemon that cannot be reached
 * (no HTTP answer), other 4xx answers (409 paused or being removed, 403 from
 * the socket proxy), and failed execs.
 */
import { DockerApiError } from "./engine.ts";

/** Recreates and skipped recreates are logged here, with a redacted reason. */
export interface RunnerLog {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Daemon messages that mean this container's storage or image is gone for good. */
const BROKEN: readonly RegExp[] = [
  /RWLayer of container \S+ is unexpectedly nil/i,
  /no such image/i,
  /layer does not exist/i,
  /failed to get (?:rw ?)?layer/i,
  /error (?:getting|mounting) (?:rw ?)?layer/i,
  /no such file or directory.*\/(?:overlay2?|image|layerdb)\//i,
];

export type StartFailureKind =
  /** Unrecoverable: remove and recreate (if not running). */
  | "broken"
  /** A 5xx that may pass: start once more, and recreate if it fails again. */
  | "retry"
  /** The container is gone: create a new one. */
  | "gone"
  /** Anything else: report it, touch nothing. */
  | "other";

export function classifyStartFailure(err: unknown): StartFailureKind {
  if (!(err instanceof DockerApiError)) return "other";
  if (err.status === 404) return "gone";
  if (err.status < 500) return "other";
  return BROKEN.some((re) => re.test(err.message)) ? "broken" : "retry";
}

/** Container inspect 5xx: its metadata is broken too (404 is "no container", handled apart). */
export const isInspectBroken = (err: unknown): err is DockerApiError =>
  err instanceof DockerApiError && err.status >= 500;
