/**
 * Test double for `Runner`: runs tmux as the current user on a private socket
 * in a fresh temp dir (`tmux -S <dir>/sock -f /dev/null`), so tests never touch
 * a developer's tmux server or config. Not a backend: no user separation,
 * `mountProject` is the identity, one tmux server for every "human".
 *
 * Env handling follows SPEC §8 like a real backend would: values go into a
 * 0600 file that the session sources and deletes, never onto a command line.
 * Call `dispose()` (e.g. in `afterEach`) to kill the server and remove the dir.
 */
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type PipedProcess, type SpawnPlan, tmuxSessionName } from "@regulus/agent-adapters";
import type { TerminalMode } from "@regulus/protocol";
import type {
  AgentRef,
  AttachCommand,
  FloorRepoRef,
  MountedProject,
  PortInfo,
  ProcessInfo,
  Runner,
  RunnerHandle,
  RunnerUser,
  TmuxSessionRef,
} from "../types.ts";

export const hasTmux = (): boolean => Bun.which("tmux") !== null;

/** POSIX single-quote a word for `sh`. */
export function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export class LocalTmuxRunner implements Runner {
  readonly backend = "linux-user" as const;
  readonly socket: string;
  #envCounter = 0;

  private constructor(readonly dir: string) {
    this.socket = join(dir, "sock");
  }

  static async create(): Promise<LocalTmuxRunner> {
    return new LocalTmuxRunner(await mkdtemp(join(tmpdir(), "rgo-tmux-")));
  }

  async dispose(): Promise<void> {
    await this.#tmux(["kill-server"]);
    await rm(this.dir, { recursive: true, force: true });
  }

  async provision(user: RunnerUser): Promise<RunnerHandle> {
    const home = join(this.dir, "home", user.userId);
    await mkdir(home, { recursive: true, mode: 0o700 });
    return { userId: user.userId, backend: this.backend, home, tmuxSocket: this.socket };
  }

  async mountProject(_user: RunnerUser, repo: FloorRepoRef): Promise<MountedProject> {
    return { workdir: repo.workdir };
  }

  async exec(user: RunnerUser, plan: SpawnPlan): Promise<TmuxSessionRef> {
    await this.#writeFiles(plan);
    const envFile = join(this.dir, `env-${this.#envCounter++}`);
    const lines = Object.entries(plan.env.reveal()).map(([k, v]) => `export ${k}=${shellQuote(v)}`);
    await writeFile(envFile, `${lines.join("\n")}\n`, { mode: 0o600 });
    const envRef = shellQuote(envFile);
    const command = `. ${envRef}; rm -f ${envRef}; exec ${plan.argv.map(shellQuote).join(" ")}`;
    const res = await this.#tmux([
      "new-session",
      "-d",
      "-s",
      plan.tmuxSession,
      "-x",
      "160",
      "-y",
      "45",
      "-c",
      plan.cwd,
      command,
    ]);
    if (res.code !== 0) {
      await rm(envFile, { force: true });
      throw new Error(`tmux new-session failed: ${res.stderr.trim()}`);
    }
    return { userId: user.userId, name: plan.tmuxSession };
  }

  async spawnPiped(_user: RunnerUser, plan: SpawnPlan): Promise<PipedProcess> {
    await this.#writeFiles(plan);
    const proc = Bun.spawn([...plan.argv], {
      cwd: plan.cwd,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...plan.env.reveal() },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      pid: proc.pid,
      stdout: proc.stdout,
      stderr: proc.stderr,
      exited: proc.exited.then((code) => (proc.signalCode ? null : code)),
      async write(chunk) {
        proc.stdin.write(chunk);
        await proc.stdin.flush();
      },
      kill: (signal) => proc.kill(signal),
    };
  }

  attach(session: TmuxSessionRef, mode: TerminalMode): AttachCommand {
    const readOnly = mode === "watch" ? ["-r"] : [];
    return {
      argv: ["tmux", "-S", this.socket, "attach-session", ...readOnly, "-t", target(session)],
    };
  }

  async capturePane(session: TmuxSessionRef, lines: number): Promise<string> {
    const res = await this.#tmux([
      "capture-pane",
      "-p",
      "-J",
      "-t",
      paneTarget(session),
      "-S",
      `-${lines}`,
    ]);
    if (res.code !== 0) throw new Error(`capture-pane failed: ${res.stderr.trim()}`);
    return res.stdout;
  }

  async paneTitle(session: TmuxSessionRef): Promise<string> {
    return (await this.#display(session, "#{pane_title}")) ?? "";
  }

  async sendKeys(session: TmuxSessionRef, keys: string, opts?: { enter?: boolean }): Promise<void> {
    const res = await this.#tmux(["send-keys", "-t", paneTarget(session), "-l", keys]);
    if (res.code !== 0) throw new Error(`send-keys failed: ${res.stderr.trim()}`);
    if (opts?.enter) await this.#tmux(["send-keys", "-t", paneTarget(session), "Enter"]);
  }

  async sessionExists(session: TmuxSessionRef): Promise<boolean> {
    return (await this.#tmux(["has-session", "-t", target(session)])).code === 0;
  }

  async listSessions(_user: RunnerUser): Promise<string[]> {
    const res = await this.#tmux(["list-sessions", "-F", "#{session_name}"]);
    return res.code === 0 ? res.stdout.split("\n").filter(Boolean) : [];
  }

  async listProcesses(agent: AgentRef): Promise<ProcessInfo[]> {
    const root = Number(await this.#display(sessionOf(agent), "#{pane_pid}"));
    if (!Number.isInteger(root) || root <= 0) return [];
    const ps = await run(["ps", "-eo", "pid=,ppid=,comm="]);
    const all = ps.stdout
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] ?? "" }));
    const tree = new Set([root]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const p of all) {
        if (!tree.has(p.pid) && tree.has(p.ppid)) {
          tree.add(p.pid);
          grew = true;
        }
      }
    }
    return all.filter((p) => tree.has(p.pid));
  }

  async listPorts(agent: AgentRef): Promise<PortInfo[]> {
    if (!Bun.which("ss")) return [];
    const pids = new Set((await this.listProcesses(agent)).map((p) => p.pid));
    const res = await run(["ss", "-Hltnp"]);
    const ports: PortInfo[] = [];
    for (const line of res.stdout.split("\n")) {
      const local = line.trim().split(/\s+/)[3];
      const pid = Number(line.match(/pid=(\d+)/)?.[1]);
      const at = local?.lastIndexOf(":") ?? -1;
      if (!local || at < 0 || !pids.has(pid)) continue;
      ports.push({ address: local.slice(0, at), port: Number(local.slice(at + 1)), pid });
    }
    return ports;
  }

  async kill(agent: AgentRef): Promise<void> {
    const procs = await this.listProcesses(agent);
    await this.#tmux(["kill-session", "-t", target(sessionOf(agent))]);
    for (const p of procs) {
      try {
        process.kill(p.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }

  async readTextFile(_user: RunnerUser, path: string): Promise<string | null> {
    const file = Bun.file(path);
    return (await file.exists()) ? file.text() : null;
  }

  async listDir(_user: RunnerUser, path: string): Promise<string[]> {
    try {
      return (await readdir(path)).sort();
    } catch {
      return [];
    }
  }

  async #writeFiles(plan: SpawnPlan): Promise<void> {
    for (const file of plan.files) {
      await mkdir(dirname(file.path), { recursive: true, mode: 0o700 });
      const contents = typeof file.contents === "string" ? file.contents : file.contents.reveal();
      await writeFile(file.path, contents, { mode: file.mode ?? 0o600 });
      await chmod(file.path, file.mode ?? 0o600);
    }
  }

  async #display(session: TmuxSessionRef, format: string): Promise<string | null> {
    const res = await this.#tmux(["display-message", "-p", "-t", paneTarget(session), format]);
    return res.code === 0 ? res.stdout.trim() : null;
  }

  #tmux(args: string[]): Promise<Result> {
    return run(["tmux", "-S", this.socket, "-f", "/dev/null", ...args]);
  }
}

/** Exact-match target so `agent-a1` never matches `agent-a10` by prefix. */
function target(session: TmuxSessionRef): string {
  return `=${session.name}`;
}

/** The active pane of that session (`=name:`); pane commands need the window part. */
function paneTarget(session: TmuxSessionRef): string {
  return `${target(session)}:`;
}

function sessionOf(agent: AgentRef): TmuxSessionRef {
  return { userId: agent.userId, name: tmuxSessionName(agent.agentId) };
}

async function run(argv: string[]): Promise<Result> {
  const env = { ...process.env };
  delete env.TMUX;
  const proc = Bun.spawn(argv, { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}
