/**
 * The docker backend's per-session and per-agent calls (tmux, processes,
 * ports, files), each run where it belongs: the robot's own sandbox when it
 * has one (#169), else the human's runner (exec-router.ts). DockerRunner
 * (docker-runner.ts) adds provisioning, mounts, spawning and kill.
 */
import { agentIdFromSession, tmuxSessionName } from "@regulus/agent-adapters";
import type { TerminalMode } from "@regulus/protocol";
import { PASTE_SCRIPT, pasteBufferName, pasteMode } from "../keys.ts";
import type {
  AgentRef,
  AttachStream,
  PortInfo,
  ProcessInfo,
  RunnerUser,
  TmuxSessionRef,
} from "../types.ts";
import type { RunnerContainers } from "./containers.ts";
import type { EngineClient, ExecResult } from "./engine.ts";
import { ExecRouter, type Where } from "./exec-router.ts";
import { openTty } from "./interactive.ts";
import {
  PORT_SCRIPT,
  PROCESS_SCRIPT,
  parsePortOutput,
  parseProcessOutput,
  parseSandboxProcesses,
  SANDBOX_PROCESS_SCRIPT,
} from "./procfs.ts";
import type { DockerSandboxes } from "./sandboxes.ts";

export const target = (s: TmuxSessionRef) => `=${s.name}`;
export const paneTarget = (s: TmuxSessionRef) => `=${s.name}:`;
export const sessionOf = (a: AgentRef): TmuxSessionRef => ({
  userId: a.userId,
  name: tmuxSessionName(a.agentId),
});
/** Where a session's calls go: its agent's sandbox, if it has one (#169). */
export const whereOf = (s: TmuxSessionRef): Where => ({
  userId: s.userId,
  agentId: agentIdFromSession(s.name) ?? undefined,
});

export abstract class DockerSessionOps {
  protected readonly router: ExecRouter;

  constructor(
    readonly engine: EngineClient,
    readonly containers: RunnerContainers,
    /** Per-agent sandboxes, when turned on (#169). */
    readonly sandboxes: DockerSandboxes | undefined,
  ) {
    this.router = new ExecRouter(engine, containers, sandboxes);
  }

  attach(session: TmuxSessionRef, mode: TerminalMode): AttachStream {
    const readOnly = mode === "watch" ? ["-r"] : [];
    const argv = [
      ...["tmux", "-S", this.containers.tmuxSocket(session.userId), "attach-session"],
      ...[...readOnly, "-t", target(session)],
    ];
    return {
      kind: "stream",
      open: async (size) => {
        const id = await this.router.require(whereOf(session));
        return openTty(this.engine, { containerId: id, argv, size });
      },
    };
  }

  async capturePane(session: TmuxSessionRef, lines: number): Promise<string> {
    const res = await this.tmuxOn(session, [
      ...["capture-pane", "-p", "-J", "-t", paneTarget(session), "-S", `-${lines}`],
    ]);
    if (res.code !== 0) throw new Error(`capture-pane failed: ${res.stderr.trim()}`);
    return res.stdout;
  }

  async paneTitle(session: TmuxSessionRef): Promise<string> {
    const res = await this.tmuxOn(session, [
      ...["display-message", "-p", "-t", paneTarget(session), "#{pane_title}"],
    ]);
    return res.code === 0 ? res.stdout.trim() : "";
  }

  /** Buffer paste in one exec, input on its stdin; works while a watcher is attached (keys.ts). */
  async sendKeys(session: TmuxSessionRef, keys: string, opts?: { enter?: boolean }): Promise<void> {
    if (keys.length === 0 && !opts?.enter) return;
    const bytes = new TextEncoder().encode(keys);
    const socket = this.containers.tmuxSocket(session.userId);
    const args = [socket, pasteBufferName(), paneTarget(session), `${bytes.byteLength}`];
    const cmd = ["sh", "-c", PASTE_SCRIPT, "sh", ...args, pasteMode(keys), opts?.enter ? "1" : "0"];
    const res = await this.engine.execWithInput(
      await this.router.require(whereOf(session)),
      { cmd },
      bytes,
    );
    if (res.code !== 0) throw new Error(`paste into ${session.name} failed: ${res.stderr.trim()}`);
  }

  async sessionExists(session: TmuxSessionRef): Promise<boolean> {
    const args = ["has-session", "-t", target(session)];
    const res = await this.router.tmux(whereOf(session), args, false);
    return res?.code === 0;
  }

  /** The runner's sessions (logins, robots from before sandboxes) and every robot sandbox's. */
  async listSessions(user: RunnerUser): Promise<string[]> {
    const sandboxes = (await this.sandboxes?.of(user.userId)) ?? [];
    const lists = await Promise.all([
      this.runnerSessions(user),
      ...sandboxes.map((s) => this.sessionsIn({ userId: user.userId, agentId: s.agentId })),
    ]);
    return [...new Set(lists.flat())];
  }

  protected runnerSessions(user: RunnerUser): Promise<string[]> {
    return this.sessionsIn({ userId: user.userId });
  }

  protected async sessionsIn(where: Where): Promise<string[]> {
    const res = await this.router.tmux(where, ["list-sessions", "-F", "#{session_name}"], false);
    return res?.code === 0 ? res.stdout.split("\n").filter(Boolean) : [];
  }

  async listProcesses(agent: AgentRef): Promise<ProcessInfo[]> {
    if (await this.router.sandboxOf(agent)) {
      const res = await this.router.run(
        agent,
        { cmd: ["sh", "-c", SANDBOX_PROCESS_SCRIPT] },
        false,
      );
      return res?.code === 0 ? parseSandboxProcesses(res.stdout) : [];
    }
    return this.runnerProcesses(agent);
  }

  protected async runnerProcesses(agent: AgentRef): Promise<ProcessInfo[]> {
    const socket = this.containers.tmuxSocket(agent.userId);
    const res = await this.router.run(
      { userId: agent.userId },
      { cmd: ["sh", "-c", PROCESS_SCRIPT, "sh", socket, paneTarget(sessionOf(agent))] },
      false,
    );
    return res?.code === 0 ? parseProcessOutput(res.stdout) : [];
  }

  async listPorts(agent: AgentRef): Promise<PortInfo[]> {
    const pids = (await this.listProcesses(agent)).map((p) => `${p.pid}`);
    if (pids.length === 0) return [];
    const cmd = ["sh", "-c", PORT_SCRIPT, "sh", ...pids];
    const res = await this.router.run(agent, { cmd }, false);
    return res?.code === 0 ? parsePortOutput(res.stdout) : [];
  }

  async readTextFile(user: RunnerUser, path: string): Promise<string | null> {
    const res = await this.router.run(
      { userId: user.userId },
      { cmd: ["sh", "-c", '[ -f "$1" ] || exit 44; exec cat -- "$1"', "sh", path] },
      false,
    );
    if (!res || res.code === 44) return null;
    if (res.code !== 0) throw new Error(`read ${path} failed: ${res.stderr.trim()}`);
    return res.stdout;
  }

  async listDir(user: RunnerUser, path: string): Promise<string[]> {
    const cmd = ["ls", "-A1", "--", path];
    const res = await this.router.run({ userId: user.userId }, { cmd }, false);
    return res?.code === 0 ? res.stdout.split("\n").filter(Boolean).sort() : [];
  }

  /** tmux against an existing runner or sandbox; a missing one is an error. */
  protected async tmuxOn(session: TmuxSessionRef, args: string[]): Promise<ExecResult> {
    const res = await this.router.tmux(whereOf(session), args, false);
    if (!res) throw new Error(`no runner container for user ${session.userId}`);
    return res;
  }
}
