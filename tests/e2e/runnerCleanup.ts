/**
 * Runner containers and volumes the e2e suites may leave on the host Docker (#215).
 *
 * Each run names its office's runners with its own prefix (OFFICE_DOCKER_RUNNER_PREFIX):
 * `rgo2e-<run>` for the main suite (playwright.config.ts), `rge2e-<run>` for the agents
 * suite (agents.e2e.ts). The office lists and reaps containers by prefix, so a shared prefix
 * would let parallel runs (and a developer's own `office`) disturb each other.
 *
 * Deletion is strict: only names that start with a checked e2e prefix and carry the same
 * prefix label are removed, by exact name. Never prune, never `office-*` or `deploy-*`.
 * - {@link removeRunPrefix}: the main suite's teardown removes exactly its own prefix.
 * - {@link sweepStale}: the pre-run sweep removes e2e prefixes older than an hour, left by
 *   a teardown that crashed.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/** The label the office's docker runner backend puts on its containers and volumes. */
export const PREFIX_LABEL = "org.regulus.office.prefix";
/** The main suite's prefix: `rgo2e-` and a run id (base36 time, then 4 hex digits). */
export const OFFICE_E2E_PREFIX = /^rgo2e-[a-z0-9]{8,16}$/;
/** The agents suite's default prefix: `rge2e-` and its run id (base36 time). */
export const AGENTS_E2E_PREFIX = /^rge2e-[a-z0-9]{6,16}$/;
/** What the sweep may touch; nothing else is ever deleted. */
export const SWEEP_PREFIXES: readonly RegExp[] = [OFFICE_E2E_PREFIX, AGENTS_E2E_PREFIX];
/** Leftovers younger than this may belong to a run that is still going. */
export const SWEEP_MIN_AGE_MS = 60 * 60 * 1000;

/** A container or volume as Docker reports it. */
export interface DockerEntry {
  name: string;
  /** The {@link PREFIX_LABEL} value, "" when missing. */
  prefixLabel: string;
  /** Creation time in ms; NaN when unknown. */
  createdAt: number;
}

/** What the cleanup needs from Docker (the CLI in {@link dockerCli}; fakes in tests). */
export interface DockerOps {
  /** Containers (all states) and volumes whose name starts with `namePrefix`. */
  containers(namePrefix: string): DockerEntry[];
  volumes(namePrefix: string): DockerEntry[];
  removeContainers(names: string[]): void;
  removeVolumes(names: string[]): void;
}

/** A new run id: base36 time (for humans reading `docker ps`) and 4 random hex digits. */
export function newRunId(now = Date.now()): string {
  return `${now.toString(36)}${randomBytes(2).toString("hex")}`;
}

/** The main suite's runner prefix for `runId`; throws unless it is a well-formed e2e prefix. */
export function officeRunnerPrefix(runId: string | undefined): string {
  return checkedPrefix(`rgo2e-${runId ?? ""}`, [OFFICE_E2E_PREFIX]);
}

/** `prefix` when it matches one of `allowed`; anything else (empty, `office`, ...) throws. */
export function checkedPrefix(prefix: string, allowed: readonly RegExp[] = SWEEP_PREFIXES): string {
  if (!prefix || !allowed.some((p) => p.test(prefix))) {
    throw new Error(`refusing to clean up runners: unexpected prefix ${JSON.stringify(prefix)}`);
  }
  return prefix;
}

/** The `<root>-<run>` prefix a name starts with, or "" when it has none. */
function prefixOf(name: string): string {
  const m = /^([a-z0-9]+-[a-z0-9]+)-/.exec(name);
  return m?.[1] ?? "";
}

/** Entries that belong to `prefix`: named `<prefix>-...` and labelled with it. */
export function ownedBy(prefix: string, entries: readonly DockerEntry[]): string[] {
  checkedPrefix(prefix);
  return entries
    .filter((e) => e.name.startsWith(`${prefix}-`) && e.prefixLabel === prefix)
    .map((e) => e.name);
}

/** Entries of any e2e prefix, labelled to match, older than `minAgeMs`. */
export function staleEntries(
  entries: readonly DockerEntry[],
  now: number,
  minAgeMs = SWEEP_MIN_AGE_MS,
): string[] {
  return entries
    .filter((e) => {
      const prefix = prefixOf(e.name);
      return (
        SWEEP_PREFIXES.some((p) => p.test(prefix)) &&
        e.prefixLabel === prefix &&
        Number.isFinite(e.createdAt) &&
        now - e.createdAt > minAgeMs
      );
    })
    .map((e) => e.name);
}

/** Removes exactly `prefix`'s containers, then its volumes; returns the names removed. */
export function removeRunPrefix(prefix: string, ops: DockerOps): string[] {
  checkedPrefix(prefix, [OFFICE_E2E_PREFIX]);
  const containers = ownedBy(prefix, ops.containers(`${prefix}-`));
  if (containers.length) ops.removeContainers(containers);
  const volumes = ownedBy(prefix, ops.volumes(`${prefix}-`));
  if (volumes.length) ops.removeVolumes(volumes);
  return [...containers, ...volumes];
}

/** Removes containers, then volumes, of e2e prefixes older than an hour; returns the names. */
export function sweepStale(ops: DockerOps, now = Date.now()): string[] {
  const removed: string[] = [];
  for (const root of ["rgo2e-", "rge2e-"]) {
    const containers = staleEntries(ops.containers(root), now);
    if (containers.length) ops.removeContainers(containers);
    const volumes = staleEntries(ops.volumes(root), now);
    if (volumes.length) ops.removeVolumes(volumes);
    removed.push(...containers, ...volumes);
  }
  return removed;
}

// ---- the docker CLI ----------------------------------------------------------------------

function docker(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  }).trim();
}

/** True when the host's Docker daemon answers (DOCKER_HOST as the developer set it). */
export function dockerAvailable(): boolean {
  try {
    docker(["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

/** A name Docker returned that cannot be read as a flag or anything but one name. */
const SAFE_NAME = /^[a-z0-9][a-z0-9_.-]*$/;

/** Lines of `name|created|label`, kept only when the name starts with `namePrefix`. */
function parseEntries(out: string, namePrefix: string): DockerEntry[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", created = "", label = ""] = line.split("|");
      const prefixLabel = label === "<no value>" ? "" : label;
      return { name: name.replace(/^\//, ""), prefixLabel, createdAt: Date.parse(created) };
    })
    .filter((e) => SAFE_NAME.test(e.name) && e.name.startsWith(namePrefix));
}

/** Names from a list command, kept only when they start with `namePrefix`. */
function names(out: string, namePrefix: string): string[] {
  return out.split("\n").filter((n) => SAFE_NAME.test(n) && n.startsWith(namePrefix));
}

/** {@link DockerOps} over the docker CLI; every filter is the literal, checked name prefix. */
export function dockerCli(): DockerOps {
  const root = (namePrefix: string) => {
    // Only prefixes of the e2e roots are ever listed.
    if (!/^(rgo2e|rge2e)-([a-z0-9]{6,16}-)?$/.test(namePrefix)) {
      throw new Error(`refusing to list runners: unexpected prefix ${JSON.stringify(namePrefix)}`);
    }
    return namePrefix;
  };
  const label = `{{index .Config.Labels "${PREFIX_LABEL}"}}`;
  return {
    containers(namePrefix) {
      const p = root(namePrefix);
      const found = names(
        docker(["ps", "-a", "--filter", `name=^${p}`, "--format", "{{.Names}}"]),
        p,
      );
      if (!found.length) return [];
      return parseEntries(
        docker(["container", "inspect", "--format", `{{.Name}}|{{.Created}}|${label}`, ...found]),
        p,
      );
    },
    volumes(namePrefix) {
      const p = root(namePrefix);
      const found = names(
        docker(["volume", "ls", "--filter", `name=${p}`, "--format", "{{.Name}}"]),
        p,
      );
      if (!found.length) return [];
      return parseEntries(
        docker([
          ...["volume", "inspect", "--format"],
          `{{.Name}}|{{.CreatedAt}}|{{index .Labels "${PREFIX_LABEL}"}}`,
          ...found,
        ]),
        p,
      );
    },
    removeContainers(list) {
      docker(["rm", "-f", "--", ...list]);
    },
    removeVolumes(list) {
      docker(["volume", "rm", "--", ...list]);
    },
  };
}
