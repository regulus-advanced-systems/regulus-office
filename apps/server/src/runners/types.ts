/**
 * Runner backends (SPEC §8): one runner identity per human, agents inside that
 * human's tmux server (SPEC §4.4). Implemented by `linux-user` (#22) and
 * `docker` (#23); `testing/local-tmux-runner.ts` is a test double.
 *
 * Adapters never see a `Runner` directly: the server binds one to a human and
 * passes it to them as `RunnerOps` (@regulus/agent-adapters), which is why the
 * tmux-level operations (`sendKeys`, `paneTitle`, `spawnPiped`, `readTextFile`,
 * `listDir`) are here too, and `bindRunnerOps` adapts one to the other.
 */
import type { PipedProcess, RunnerOps, SpawnPlan } from "@regulus/agent-adapters";
import type { BackendId, TerminalMode } from "@regulus/protocol";

/** The human whose runner is addressed. */
export interface RunnerUser {
  userId: string;
}

/** What `provision` set up for a human. */
export interface RunnerHandle {
  userId: string;
  backend: BackendId;
  /** HOME of the runner identity, where CLIs keep their own credentials. */
  home: string;
  /** That human's tmux server socket (as seen by the backend). */
  tmuxSocket: string;
  /** linux-user backend: the `office-u-<id>` uid. */
  uid?: number;
  /** docker backend: the runner container. */
  containerId?: string;
}

/** An agent inside a human's runner. */
export interface AgentRef {
  userId: string;
  agentId: string;
}

/** A tmux session on a human's tmux server. */
export interface TmuxSessionRef {
  userId: string;
  /** `agent-<agentId>`. */
  name: string;
}

/**
 * A command the terminal bridge (#24) spawns in a PTY to attach to a session,
 * e.g. `tmux -S <sock> attach-session -r -t agent-a1`. Carries no secrets.
 * Backends whose tmux is reachable from the office host (linux-user, the test
 * runner) return this. `kind` is optional so existing `{ argv }` literals stay
 * valid; narrow with `cmd.kind === "stream"`.
 */
export interface AttachArgv {
  kind?: "argv";
  argv: readonly string[];
  env?: Readonly<Record<string, string>>;
}

/** Terminal size in character cells. */
export interface TtySize {
  cols: number;
  rows: number;
}

/**
 * A live TTY attached to a tmux session, already allocated by the backend (no
 * local PTY needed). The docker backend returns this: the office image has no
 * docker CLI, so it runs `tmux attach` through an Engine API exec with a TTY
 * and hands over the hijacked connection.
 */
export interface DuplexTty {
  /** Raw terminal output (not multiplexed). Ends when the attach ends. */
  readonly output: ReadableStream<Uint8Array>;
  /** Raw terminal input (keystrokes, escape sequences). */
  write(data: string | Uint8Array): Promise<void>;
  resize(size: TtySize): Promise<void>;
  /** Detach: closes the connection; the tmux session keeps running. */
  close(): void;
  /** Resolves once the attach has ended (detach, session gone, `close()`). */
  readonly closed: Promise<void>;
}

/** Opens a {@link DuplexTty} per viewer; `watch` sessions are read-only (`attach -r`). */
export interface AttachStream {
  kind: "stream";
  open(size: TtySize): Promise<DuplexTty>;
}

/** How the terminal bridge attaches to a session: a PTY command or a ready TTY stream. */
export type AttachCommand = AttachArgv | AttachStream;

export interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
}

export interface PortInfo {
  port: number;
  address: string;
  pid?: number;
}

/** A `floor_repos` row as far as the runner is concerned (SPEC §5). */
export interface FloorRepoRef {
  floorId: string;
  repoId: string;
  /** Host path of the checkout, e.g. `/srv/office/projects/<floor>/<repo>`. */
  workdir: string;
}

export interface MountedProject {
  /** Path of the checkout inside the runner. */
  workdir: string;
}

export interface Runner {
  readonly backend: BackendId;

  /** Create (idempotently) the human's runner identity, HOME and tmux server. */
  provision(user: RunnerUser): Promise<RunnerHandle>;
  /** Make a floor repo reachable (and writable by the runner group) inside the runner. */
  mountProject(user: RunnerUser, repo: FloorRepoRef): Promise<MountedProject>;

  /**
   * Write `plan.files`, then start `plan.argv` in a detached tmux session named
   * `plan.tmuxSession` with `plan.env`. Env values must not appear on any
   * command line or in logs (SPEC §8 rule 2).
   */
  exec(user: RunnerUser, plan: SpawnPlan): Promise<TmuxSessionRef>;
  /** Side process with piped stdio (e.g. `codex app-server`), same env rules. */
  spawnPiped(user: RunnerUser, plan: SpawnPlan): Promise<PipedProcess>;

  /** How to attach a terminal; `watch` must be read-only (`attach -r`). */
  attach(session: TmuxSessionRef, mode: TerminalMode): AttachCommand;
  capturePane(session: TmuxSessionRef, lines: number): Promise<string>;
  paneTitle(session: TmuxSessionRef): Promise<string>;
  sendKeys(session: TmuxSessionRef, keys: string, opts?: { enter?: boolean }): Promise<void>;
  sessionExists(session: TmuxSessionRef): Promise<boolean>;
  /** Session names on the human's tmux server (for re-adoption on boot). */
  listSessions(user: RunnerUser): Promise<string[]>;

  /** Processes belonging to the agent (its cgroup / pane process tree). */
  listProcesses(agent: AgentRef): Promise<ProcessInfo[]>;
  /** Listening TCP ports of those processes (dev-server detection). */
  listPorts(agent: AgentRef): Promise<PortInfo[]>;
  /** Kill the agent's session and every process it started. Idempotent. */
  kill(agent: AgentRef): Promise<void>;

  /** Read a UTF-8 file as the runner identity; null when absent. */
  readTextFile(user: RunnerUser, path: string): Promise<string | null>;
  listDir(user: RunnerUser, path: string): Promise<string[]>;
}

/**
 * Bind a runner to one human so adapters can use it as `RunnerOps`
 * (@regulus/agent-adapters). Session arguments are bare tmux session names.
 */
export function bindRunnerOps(runner: Runner, user: RunnerUser): RunnerOps {
  const ref = (name: string): TmuxSessionRef => ({ userId: user.userId, name });
  return {
    sendKeys: (session, keys, opts) => runner.sendKeys(ref(session), keys, opts),
    capturePane: (session, lines) => runner.capturePane(ref(session), lines),
    paneTitle: (session) => runner.paneTitle(ref(session)),
    spawnPiped: (plan) => runner.spawnPiped(user, plan),
    readTextFile: (path) => runner.readTextFile(user, path),
    listDir: (path) => runner.listDir(user, path),
  };
}
