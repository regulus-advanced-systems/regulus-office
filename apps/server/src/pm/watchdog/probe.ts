/**
 * Reading a host over SSH (#253, D30; SPEC §8).
 *
 * The `ssh` process runs where the watchdog itself runs: in the office
 * agents' runner identity, never in the office server's own process tree.
 *
 * The private key is on the runner's volume only while a check runs. It is
 * decrypted for that one check, written as a 0600 file into a folder of the
 * watchdog's own, and that folder is removed in a `finally`, on every path:
 * success, failure, timeout. It is never on argv, in the environment or in a
 * log.
 *
 * The host's key (hostkey.ts): a pinned host is checked with
 * `StrictHostKeyChecking=yes` against the pin from the office's database.
 * A host without a pin is met once with `accept-new`, and the key it showed
 * is handed back to be stored as its pin. A pinned host that shows another
 * key fails with {@link HostKeyChanged}, carrying what it showed.
 *
 * Read-only: the two commands of pm2.ts and nothing else. Only named fields
 * of `pm2 jlist` are read (it also prints each process's whole environment,
 * which is dropped unread). What comes back is capped, cleaned of control
 * characters and scrubbed (evidence.ts) before anything else sees it.
 */
import type { PlannedFile, Secret, SpawnPlan } from "@regulus/agent-adapters";
import { SecretEnv } from "@regulus/agent-adapters";
import type { Logger } from "../../logging.ts";
import type { Runner } from "../../runners/types.ts";
import { agentDir } from "../engines/cli-plan.ts";
import { OFFICE_AGENT_RUNNER_USER } from "../engines/cli-session.ts";
import { knownHostsFile, pinOf } from "./hostkey.ts";
import {
  type AppMarks,
  type AppReading,
  logLines,
  PM2_LIST,
  parseJlist,
  pm2Logs,
  readApp,
  sshArgv,
} from "./pm2.ts";
import type { WatchdogAppRow, WatchdogHostRow } from "./store.ts";

const STDOUT_MAX = 2 * 1024 * 1024;
export const DEFAULT_SSH_TIMEOUT_MS = 45_000;

/** Why a host could not be read, in words safe to hand to the model and to people. */
export class ProbeError extends Error {
  override name = "ProbeError";
}

/** The host showed a key that is not its pin. `offered`: what it showed (`keytype base64` lines). */
export class HostKeyChanged extends ProbeError {
  override name = "HostKeyChanged";
  constructor(readonly offered: string) {
    super("the host shows another key than the one that is pinned");
  }
}

export interface HostReading {
  apps: Array<{ app: WatchdogAppRow; reading: AppReading }>;
  /** First contact with a host that had no pin: the key it showed, to be stored as its pin. */
  learnedKey?: string;
}

export interface HostProbe {
  check(
    agentId: string,
    host: WatchdogHostRow,
    key: Secret,
    apps: readonly WatchdogAppRow[],
    marks: (app: WatchdogAppRow) => AppMarks,
  ): Promise<HostReading>;
  /** Remove whatever an agent's checks could have left in its folder. Best effort. */
  forget(agentId: string): Promise<void>;
}

export interface SshProbeOptions {
  runner: Pick<Runner, "provision" | "spawnPiped">;
  logger: Logger;
  timeoutMs?: number;
  now?: () => number;
  /** Program overrides (tests: stand-ins). */
  command?: string;
  keyscanCommand?: string;
}

async function readCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size < cap) chunks.push(value.subarray(0, cap - size));
    size += value.length;
  }
  return Buffer.concat(chunks).toString("utf8");
}

const HOST_KEY = "the host shows another key than the one that is pinned";

/** What `ssh` itself said, reduced to a cause. Never the raw text: it can quote a banner. */
function sshFailure(stderr: string, code: number | null): string {
  const text = stderr.toLowerCase();
  if (text.includes("host key verification failed") || text.includes("host key")) return HOST_KEY;
  if (text.includes("permission denied")) return "the host refused the key";
  if (text.includes("could not resolve")) return "the host name does not resolve";
  if (text.includes("timed out")) return "the connection timed out";
  if (text.includes("connection refused")) return "the connection was refused";
  if (text.includes("command not found") || code === 127) return "pm2 was not found on the host";
  return `ssh ended with code ${code ?? "none"}`;
}

export class SshProbe implements HostProbe {
  constructor(private readonly opts: SshProbeOptions) {}

  /** The folder a check's files are in: made for the check, removed after it. */
  #dir(home: string, agentId: string): string {
    return `${agentDir(home, agentId)}/watchdog`;
  }

  #plan(agentId: string, home: string, argv: string[], files: PlannedFile[] = []): SpawnPlan {
    return {
      agentId,
      provider: "custom",
      argv,
      env: SecretEnv.of({ HOME: home, LANG: "C.UTF-8" }),
      cwd: home,
      tmuxSession: `agent-${agentId}`,
      files,
    };
  }

  async #run(plan: SpawnPlan): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const proc = await this.opts.runner.spawnPiped({ userId: OFFICE_AGENT_RUNNER_USER }, plan);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, this.opts.timeoutMs ?? DEFAULT_SSH_TIMEOUT_MS);
    try {
      const [stdout, stderr, code] = await Promise.all([
        readCapped(proc.stdout, STDOUT_MAX),
        readCapped(proc.stderr, STDOUT_MAX),
        proc.exited,
      ]);
      if (timedOut) throw new ProbeError("the host did not answer in time");
      return { stdout, stderr, code };
    } finally {
      clearTimeout(timer);
    }
  }

  async check(
    agentId: string,
    host: WatchdogHostRow,
    key: Secret,
    apps: readonly WatchdogAppRow[],
    marks: (app: WatchdogAppRow) => AppMarks,
  ): Promise<HostReading> {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(host.id)) throw new Error("invalid host id");
    const handle = await this.opts.runner.provision({ userId: OFFICE_AGENT_RUNNER_USER });
    const dir = this.#dir(handle.home, agentId);
    const keyPath = `${dir}/${host.id}.key`;
    const knownHostsPath = `${dir}/${host.id}.known_hosts`;
    const pinned = host.hostKey.trim().length > 0;
    const files: PlannedFile[] = [
      { path: keyPath, contents: key, mode: 0o600 },
      // Pinned: exactly the pin. Not pinned: empty, so `accept-new` writes what the host shows.
      {
        path: knownHostsPath,
        contents: pinned ? knownHostsFile(host.host, host.port, host.hostKey) : "",
        mode: 0o600,
      },
    ];
    const target = {
      host: host.host,
      port: host.port,
      username: host.username,
      keyPath,
      knownHostsPath,
      pinned,
    };
    let first = true;
    const ssh = async (remote: readonly string[]) => {
      const argv = sshArgv(target, remote);
      if (this.opts.command) argv[0] = this.opts.command;
      // The files are written once: a second write would empty the key ssh just learned.
      const out = await this.#run(this.#plan(agentId, handle.home, argv, first ? files : []));
      first = false;
      if (out.code !== 0) throw new ProbeError(sshFailure(out.stderr, out.code));
      return out;
    };
    try {
      const list = parseJlist((await ssh(PM2_LIST)).stdout);
      if (!list) throw new ProbeError("pm2 did not print a process list");
      const now = (this.opts.now ?? Date.now)();
      const out: HostReading = { apps: [] };
      for (const app of apps) {
        const process = list.find((p) => p.name === app.name);
        let log: string[] | null = null;
        if (process) {
          try {
            // PM2 prints its headers to stdout and the error log itself to stderr (seen with 6.0.14).
            const logs = await ssh(pm2Logs(app.name));
            log = logLines(`${logs.stdout}\n${logs.stderr}`);
          } catch (err) {
            // The state is still worth reporting; the log is read again next round.
            this.opts.logger.warn(
              {
                hostId: host.id,
                appId: app.id,
                err: err instanceof ProbeError ? err.message : "error",
              },
              "watchdog could not read an app's log",
            );
          }
        }
        out.apps.push({ app, reading: readApp(app, process, log, marks(app), now) });
      }
      if (!pinned) {
        const learned = await this.#run(
          this.#plan(agentId, handle.home, ["cat", "--", knownHostsPath]),
        );
        const pin = pinOf(learned.stdout);
        if (pin) out.learnedKey = pin;
      }
      return out;
    } catch (err) {
      if (pinned && err instanceof ProbeError && err.message === HOST_KEY) {
        throw new HostKeyChanged(await this.#offered(agentId, handle.home, host));
      }
      throw err;
    } finally {
      await this.#clean(agentId, handle.home);
    }
  }

  /** What the host shows now, for an admin to compare and accept; empty when it cannot be read. */
  async #offered(agentId: string, home: string, host: WatchdogHostRow): Promise<string> {
    try {
      const argv = [
        this.opts.keyscanCommand ?? "ssh-keyscan",
        "-T",
        "10",
        "-p",
        String(host.port),
        "--",
        host.host,
      ];
      return pinOf((await this.#run(this.#plan(agentId, home, argv))).stdout);
    } catch {
      return "";
    }
  }

  /** Remove the check's folder with the key in it. A failure is logged, never thrown. */
  async #clean(agentId: string, home: string): Promise<void> {
    try {
      const out = await this.#run(
        this.#plan(agentId, home, ["rm", "-rf", "--", this.#dir(home, agentId)]),
      );
      if (out.code !== 0) throw new Error("rm failed");
    } catch {
      this.opts.logger.error({ agentId }, "watchdog could not remove a host's key file");
    }
  }

  async forget(agentId: string): Promise<void> {
    try {
      const handle = await this.opts.runner.provision({ userId: OFFICE_AGENT_RUNNER_USER });
      await this.#clean(agentId, handle.home);
    } catch {
      this.opts.logger.warn({ agentId }, "watchdog could not clean an agent's folder");
    }
  }
}
