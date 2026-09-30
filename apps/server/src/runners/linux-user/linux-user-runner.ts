/**
 * `linux-user` Runner backend (SPEC §4.4, §8; research 01 §10, §12; research
 * 04 "Multi-user credential isolation"): each human runs as their own
 * `office-u-<rid>` account (ids.ts) with a HOME only they can read, their own
 * tmux server (socket owned by them), and one systemd scope per agent
 * (`agent-<agentId>.scope`) so process listing and kill are exact.
 *
 * office-server itself is unprivileged: everything that crosses users goes
 * through the helper (helper/office-runner-helper) via `sudo -n`. The sudoers
 * lines and the reasoning are in docs/deploy/linux-user-runner.md.
 *
 * Secrets (SPEC §8 rule 2): `plan.env` becomes a shell script sent on the
 * helper's stdin, written by the runner account to a 0600 file in its 0700
 * `~/.office/env`, sourced by the agent's wrapper and deleted before exec. It
 * never appears on a command line (sudo, helper, tmux, systemd-run) or in logs.
 * `plan.files` travel the same way (stdin of `write-file`).
 *
 * Sandboxes (D18, #169): with `sandboxes` set, `sandbox()` gives a robot its
 * own network namespace on the sandbox bridge (the office reaches its ports at
 * its address), a pid namespace, and limits on its scopes (the helper's
 * `sandbox-up`); `exec`/`spawnPiped` of that robot then run there, and `kill`
 * removes it.
 */
import type { PipedProcess, SpawnPlan } from "@regulus/agent-adapters";
import { tmuxSessionName } from "@regulus/agent-adapters";
import type { TerminalMode } from "@regulus/protocol";
import { pasteMode } from "../keys.ts";
import { FLOOR_SLUG } from "../layout.ts";
import { pickSlot, portRange, type SandboxSettings, sandboxEnv } from "../sandbox.ts";
import type {
  AgentRef,
  AttachArgv,
  FloorRepoRef,
  MountedProject,
  PortInfo,
  ProcessInfo,
  Runner,
  RunnerHandle,
  RunnerUser,
  SandboxInfo,
  SandboxSpec,
  TmuxSessionRef,
} from "../types.ts";
import { Helper, type HelperOptions } from "./helper-client.ts";
import { checkAgentId, checkRunnerPath, checkSessionName, runnerId } from "./ids.ts";
import { agentPids, listeningPorts, parseSocketInodes, processInfo } from "./proc.ts";

export interface LinuxUserRunnerOptions extends HelperOptions {
  /** Where systemd puts the agent scopes (the helper uses `Slice=system.slice`). */
  cgroupDir?: string;
  procRoot?: string;
  /** Per-agent sandboxes (#169); without it robots run on their human's tmux server. */
  sandboxes?: SandboxSettings;
}

interface KnownSandbox extends SandboxInfo {
  slot: number;
}

/** POSIX single-quote a word for `sh`. */
export function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The env script the agent's wrapper sources (sent on stdin, NUL-terminated). */
export function envScript(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([name, value]) => `export ${name}=${shellQuote(value)}\n`)
    .join("");
}

function parseKeyValues(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out.set(line.slice(0, at), line.slice(at + 1));
  }
  return out;
}

export class LinuxUserRunner implements Runner {
  readonly backend = "linux-user" as const;
  readonly helper: Helper;
  readonly #cgroupDir: string;
  readonly #procRoot: string;
  readonly #settings: SandboxSettings | undefined;
  /** Sandboxes by agent id; read from the helper once, then kept in step. */
  readonly #sandboxes = new Map<string, KnownSandbox>();
  #loaded: Promise<void> | undefined;

  constructor(opts: LinuxUserRunnerOptions = {}) {
    this.helper = new Helper(opts);
    this.#cgroupDir = opts.cgroupDir ?? "/sys/fs/cgroup/system.slice";
    this.#procRoot = opts.procRoot ?? "/proc";
    this.#settings = opts.sandboxes;
  }

  /**
   * The robot's sandbox (#169): network namespace, limits, ports. Idempotent;
   * null when sandboxes are off. The slot (address and ports) is kept while the
   * sandbox exists and preferred again after it was removed (sandbox.ts).
   */
  async sandbox(agent: AgentRef, _spec: SandboxSpec): Promise<SandboxInfo | null> {
    const s = this.#settings;
    if (!s) return null;
    const agentId = checkAgentId(agent.agentId);
    await this.#load();
    const known = this.#sandboxes.get(agentId);
    const taken = new Set(
      [...this.#sandboxes.values()].filter((k) => k.agentId !== agentId).map((k) => k.slot),
    );
    const slot = known?.slot ?? pickSlot(agentId, taken, s);
    const res = await this.helper.call("sandbox-up", [
      runnerId(agent.userId),
      agentId,
      String(slot),
      String(Math.round(s.memoryBytes)),
      String(Math.max(1, Math.round(s.cpus * 100))),
      String(s.pids),
      agent.userId,
    ]);
    const host = parseKeyValues(res.stdout).get("address");
    if (!host) throw new Error("office-runner-helper sandbox-up: unexpected output");
    const info: KnownSandbox = {
      userId: agent.userId,
      agentId,
      host,
      ports: portRange(slot, s),
      slot,
      createdAt: known?.createdAt ?? Date.now(),
    };
    this.#sandboxes.set(agentId, info);
    return info;
  }

  async listSandboxes(): Promise<SandboxInfo[]> {
    if (!this.#settings) return [];
    const found = await this.#readSandboxes();
    for (const k of found) if (!this.#sandboxes.has(k.agentId)) this.#sandboxes.set(k.agentId, k);
    return found;
  }

  /** `sandbox-list`: `<agentId> <rid> <slot> <address> <owner>` lines. */
  async #readSandboxes(): Promise<KnownSandbox[]> {
    const s = this.#settings;
    if (!s) return [];
    const res = await this.helper.call("sandbox-list", []);
    const out: KnownSandbox[] = [];
    for (const line of res.stdout.split("\n")) {
      const [agentId, rid, slotText, host, userId] = line.split(" ");
      const slot = Number(slotText);
      if (!agentId || !host || !userId || !Number.isInteger(slot) || slot >= s.portSlots) continue;
      if (rid !== runnerId(userId)) continue;
      out.push({ userId, agentId, host, slot, ports: portRange(slot, s) });
    }
    return out;
  }

  #load(): Promise<void> {
    this.#loaded ??= this.listSandboxes().then(
      () => {},
      (err) => {
        this.#loaded = undefined;
        throw err;
      },
    );
    return this.#loaded;
  }

  /** `PORT` and the port range for a sandboxed robot's processes (not secret). */
  async #sandboxEnv(user: RunnerUser, agentId: string): Promise<Record<string, string>> {
    if (!this.#settings) return {};
    await this.#load();
    const known = this.#sandboxes.get(agentId);
    return known && known.userId === user.userId ? sandboxEnv(known.ports) : {};
  }

  async provision(user: RunnerUser): Promise<RunnerHandle> {
    const res = await this.helper.call("provision", [runnerId(user.userId)]);
    const kv = parseKeyValues(res.stdout);
    const uid = Number(kv.get("uid"));
    const home = kv.get("home");
    const socket = kv.get("socket");
    if (!Number.isInteger(uid) || !home || !socket) {
      throw new Error("office-runner-helper provision: unexpected output");
    }
    return { userId: user.userId, backend: this.backend, home, tmuxSocket: socket, uid };
  }

  /** Not part of `Runner`: remove the human's account, HOME and processes. */
  async deprovision(user: RunnerUser): Promise<void> {
    await this.helper.call("deprovision", [runnerId(user.userId)]);
  }

  async mountProject(user: RunnerUser, repo: FloorRepoRef): Promise<MountedProject> {
    await this.helper.call("mount-project", [runnerId(user.userId), checkRunnerPath(repo.workdir)]);
    return { workdir: repo.workdir };
  }

  /**
   * Not part of `Runner`: hand a directory shared with runners before #114
   * (the projects root, or a per-agent worktree directly in a floor dir) back
   * to the office alone: owner, no runner ACLs, no "other" access.
   */
  async reclaim(dir: string): Promise<void> {
    await this.helper.call("reclaim", [checkRunnerPath(dir)]);
  }

  /**
   * Not part of `Runner`: a deleted floor's dirs (#150), `<projects>/<slug>`
   * and `<worktrees>/<slug>` with every human's area in it. Root, because the
   * areas hold files of runner accounts; the helper checks the slug first.
   */
  async removeFloorDirs(slug: string): Promise<string[]> {
    if (!FLOOR_SLUG.test(slug)) throw new Error("invalid floor slug");
    const res = await this.helper.call("remove-floor", [slug]);
    return res.stdout
      .split("\n")
      .filter((l) => l.startsWith("removed="))
      .map((l) => l.slice("removed=".length));
  }

  async exec(user: RunnerUser, plan: SpawnPlan): Promise<TmuxSessionRef> {
    const agentId = checkAgentId(plan.agentId);
    if (plan.tmuxSession !== tmuxSessionName(agentId)) {
      throw new Error("plan.tmuxSession must be agent-<agentId>");
    }
    const env = { ...(await this.#sandboxEnv(user, agentId)), ...plan.env.reveal() };
    await this.#writeFiles(user, plan);
    await this.helper.call("exec", this.#spawnArgs(user, plan), {
      stdin: `${envScript(env)}\0`,
    });
    return { userId: user.userId, name: plan.tmuxSession };
  }

  async spawnPiped(user: RunnerUser, plan: SpawnPlan): Promise<PipedProcess> {
    const env = { ...(await this.#sandboxEnv(user, plan.agentId)), ...plan.env.reveal() };
    await this.#writeFiles(user, plan);
    const proc = this.helper.spawn("spawn-piped", this.#spawnArgs(user, plan));
    await proc.write(`${envScript(env)}\0`);
    return proc;
  }

  /** A PTY command (`sudo -n <helper> attach ...`); the bridge spawns it. */
  attach(session: TmuxSessionRef, mode: TerminalMode): AttachArgv {
    const args = [runnerId(session.userId), checkSessionName(session.name)];
    return {
      kind: "argv",
      argv: this.helper.argv("attach", [...args, mode === "watch" ? "ro" : "rw"]),
    };
  }

  async capturePane(session: TmuxSessionRef, lines: number): Promise<string> {
    const n = Math.max(0, Math.min(999_999, Math.floor(lines)));
    return (await this.helper.call("capture", [...this.#sessionArgs(session), String(n)])).stdout;
  }

  async paneTitle(session: TmuxSessionRef): Promise<string> {
    const res = await this.helper.call("pane-title", this.#sessionArgs(session));
    return res.stdout.replace(/\n$/, "");
  }

  /** Pasted through tmux buffers by the helper (keys on stdin), so watchers don't block it. */
  async sendKeys(session: TmuxSessionRef, keys: string, opts?: { enter?: boolean }): Promise<void> {
    if (keys.length === 0 && !opts?.enter) return;
    const args = [...this.#sessionArgs(session), opts?.enter ? "1" : "0", pasteMode(keys)];
    await this.helper.call("send-keys", args, { stdin: keys });
  }

  async sessionExists(session: TmuxSessionRef): Promise<boolean> {
    const res = await this.helper.call("has-session", this.#sessionArgs(session), { ok: [0, 1] });
    return res.code === 0;
  }

  async listSessions(user: RunnerUser): Promise<string[]> {
    const res = await this.helper.call("list-sessions", [runnerId(user.userId)]);
    return res.stdout.split("\n").filter(Boolean);
  }

  async listProcesses(agent: AgentRef): Promise<ProcessInfo[]> {
    const pids = await agentPids(this.#cgroupDir, checkAgentId(agent.agentId));
    const infos = await Promise.all(pids.map((pid) => processInfo(this.#procRoot, pid)));
    return infos.filter((p): p is ProcessInfo => p !== null).sort((a, b) => a.pid - b.pid);
  }

  async listPorts(agent: AgentRef): Promise<PortInfo[]> {
    const args = [runnerId(agent.userId), checkAgentId(agent.agentId)];
    const res = await this.helper.call("sockets", args);
    return listeningPorts(this.#procRoot, parseSocketInodes(res.stdout));
  }

  /** Also removes the robot's sandbox (network namespace, record). */
  async kill(agent: AgentRef): Promise<void> {
    await this.helper.call("kill", [runnerId(agent.userId), checkAgentId(agent.agentId)]);
    const known = this.#sandboxes.get(agent.agentId);
    if (known?.userId === agent.userId) this.#sandboxes.delete(agent.agentId);
  }

  async readTextFile(user: RunnerUser, path: string): Promise<string | null> {
    const args = [runnerId(user.userId), checkRunnerPath(path)];
    const res = await this.helper.call("read-file", args, { ok: [0, 3] });
    return res.code === 3 ? null : res.stdout;
  }

  async listDir(user: RunnerUser, path: string): Promise<string[]> {
    const args = [runnerId(user.userId), checkRunnerPath(path)];
    const res = await this.helper.call("list-dir", args, { ok: [0, 1, 3] });
    return res.code === 0 ? res.stdout.split("\0").filter(Boolean).sort() : [];
  }

  async #writeFiles(user: RunnerUser, plan: SpawnPlan): Promise<void> {
    const rid = runnerId(user.userId);
    for (const file of plan.files) {
      const mode = (file.mode ?? 0o600).toString(8).padStart(3, "0");
      const contents = typeof file.contents === "string" ? file.contents : file.contents.reveal();
      await this.helper.call("write-file", [rid, checkRunnerPath(file.path), mode], {
        stdin: contents,
      });
    }
  }

  #spawnArgs(user: RunnerUser, plan: SpawnPlan): string[] {
    if (plan.argv.length === 0 || !plan.argv[0]) throw new Error("plan.argv is empty");
    return [
      runnerId(user.userId),
      checkAgentId(plan.agentId),
      checkRunnerPath(plan.cwd),
      "--",
      ...plan.argv,
    ];
  }

  #sessionArgs(session: TmuxSessionRef): string[] {
    return [runnerId(session.userId), checkSessionName(session.name)];
  }
}
