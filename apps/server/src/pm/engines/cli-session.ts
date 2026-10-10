/**
 * The CLI session engine (SPEC §10 M5, D2, D3; #271): an office agent as a
 * Claude Code session with a role prompt and the office MCP server.
 *
 * Each conversation (agent and person) has its own Claude session, so what
 * one person told a shared agent is not in the context of its answer to
 * another. A message is one headless turn of that session (cli-plan.ts): the
 * CLI resumes the session, works through the office tools, prints its answer
 * and exits. Between turns nothing runs, and after an office restart the
 * next turn resumes the same session (the session ids are the engine state
 * the office keeps).
 *
 * Where it runs (SPEC §8):
 * - a personal agent in its owner's runner identity, with the credential its
 *   owner chose (their own CLI login, one of their profiles, or the office
 *   key): the login never leaves their HOME and the office never reads it;
 * - a shared agent in the office agents' own runner identity, which is no
 *   human's and holds no login, with an office-wide metered key only.
 *
 * Soul and memories (#136, D20): the soul the agent was started with and a
 * digest of what it remembers go into each turn's system prompt, from the
 * office's copy, in a file only its runner identity can read; the agent
 * saves and looks up memories and notes through the office tools. A change
 * to the soul stops the agent, so the next message starts it with the new one.
 *
 * Each turn has its own office token (#301): it is written into that turn's
 * MCP configuration, is bound to the person whose message it is, and is
 * revoked when the turn ends, however it ends. So whatever the agent does in
 * a turn is answered for that person, and a process that outlives its turn
 * holds a token the office no longer knows.
 *
 * Turns of one agent run one at a time, in order.
 */
import { type Secret, SecretEnv } from "@regulus/agent-adapters";
import { CLI_SESSION_PROVIDERS } from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import type { Runner } from "../../runners/types.ts";
import { agentUsageKey } from "../cost.ts";
import { agentDir, buildClaudeTurn, parseClaudeTurn } from "./cli-plan.ts";
import type { AgentCredentials } from "./credentials.ts";
import {
  type EngineAgent,
  type EngineEvent,
  EngineEvents,
  type EngineHealth,
  type EngineMessage,
  type EngineOffice,
  EngineRefusal,
  type OfficeAgentEngine,
} from "./types.ts";

/** The runner identity every shared agent runs as: no human's HOME, logins or areas. */
export const OFFICE_AGENT_RUNNER_USER = "officeagents";

export const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;
const STDOUT_MAX = 4 * 1024 * 1024;

export interface CliSessionEngineOptions {
  runner: Pick<Runner, "provision" | "spawnPiped" | "backend">;
  credentials: AgentCredentials;
  logger: Logger;
  turnTimeoutMs?: number;
  /** CLI override (tests: the fake `claude`). */
  command?: string;
  newSessionId?: () => string;
}

interface Run {
  agent: EngineAgent;
  office: EngineOffice;
  /** Claude session id per person. */
  sessions: Record<string, string>;
  /** How often each person's conversation was started over; a turn from before does not put its session back. */
  resets: Record<string, number>;
  /** The turn in flight and the ones behind it. */
  tail: Promise<void>;
  kill?: () => void;
  stopped: boolean;
  lastError: string | null;
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

function sessionsOf(state: Record<string, unknown>): Record<string, string> {
  const raw = state.sessions;
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

export class CliSessionEngine implements OfficeAgentEngine {
  readonly kind = "cli-session" as const;
  readonly #events = new EngineEvents();
  readonly #runs = new Map<string, Run>();

  constructor(private readonly opts: CliSessionEngineOptions) {}

  check(agent: EngineAgent): void {
    if (!(CLI_SESSION_PROVIDERS as readonly string[]).includes(agent.provider)) {
      throw new EngineRefusal(
        "provider_not_supported",
        "the CLI session engine runs Claude Code only for now",
      );
    }
    this.opts.credentials.check(agent);
  }

  async start(agent: EngineAgent, office: EngineOffice): Promise<void> {
    this.check(agent);
    await this.stop(agent.id);
    this.#runs.set(agent.id, {
      agent,
      office,
      sessions: sessionsOf(agent.state),
      resets: {},
      tail: Promise.resolve(),
      stopped: false,
      lastError: null,
    });
    this.#events.emit({ type: "status", agentId: agent.id, status: "ready" });
  }

  async stop(agentId: string): Promise<void> {
    const run = this.#runs.get(agentId);
    if (!run) return;
    run.stopped = true;
    this.#runs.delete(agentId);
    run.kill?.();
    await run.tail.catch(() => {});
  }

  async send(agentId: string, message: EngineMessage): Promise<void> {
    const run = this.#runs.get(agentId);
    if (!run) throw new EngineRefusal("not_started", "the agent is not started");
    run.tail = run.tail.then(() => this.#turn(run, message)).catch(() => {});
  }

  forgetConversation(agentId: string, userId: string): void {
    const run = this.#runs.get(agentId);
    if (!run) return;
    // A turn of theirs that is still running must not bring its session back when it ends.
    run.resets[userId] = (run.resets[userId] ?? 0) + 1;
    const sessionId = run.sessions[userId];
    if (sessionId === undefined) return;
    // The next turn starts a new Claude session; the old one is never resumed, and what the
    // CLI kept of it goes before that turn runs.
    delete run.sessions[userId];
    this.#events.emit({ type: "state", agentId, state: { sessions: { ...run.sessions } } });
    run.tail = run.tail.then(() => this.#erase(run, sessionId)).catch(() => {});
  }

  /**
   * Delete what the CLI wrote for a session that was dropped: its transcript
   * under `~/.claude/projects`, and the last system prompt in the agent's folder.
   */
  async #erase(run: Run, sessionId: string): Promise<void> {
    const { agent } = run;
    try {
      const user = { userId: agent.ownerUserId ?? OFFICE_AGENT_RUNNER_USER };
      const { home } = await this.opts.runner.provision(user);
      const dir = agentDir(home, agent.id);
      const proc = await this.opts.runner.spawnPiped(user, {
        agentId: agent.id,
        provider: "claude-code",
        argv: [
          "find",
          `${home.replace(/\/+$/, "")}/.claude/projects`,
          dir,
          "-type",
          "f",
          "(",
          "-name",
          `${sessionId}.jsonl`,
          "-o",
          "-name",
          "prompt.md",
          ")",
          "-delete",
        ],
        env: SecretEnv.of({ HOME: home }),
        cwd: dir,
        tmuxSession: `agent-${agent.id}`,
        files: [],
      });
      await Promise.all([
        readCapped(proc.stdout, 1024),
        readCapped(proc.stderr, 1024),
        proc.exited,
      ]);
    } catch (err) {
      this.opts.logger.warn(
        { agentId: agent.id, err: err instanceof Error ? err.message.slice(0, 200) : "unknown" },
        "could not delete a dropped session's files",
      );
    }
  }

  async health(agentId: string): Promise<EngineHealth> {
    const run = this.#runs.get(agentId);
    if (!run) return { ok: false, detail: "not started" };
    return run.lastError
      ? { ok: false, detail: run.lastError }
      : { ok: true, detail: "ready for the next message" };
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    return this.#events.on(listener);
  }

  /** Resolves when the agent has no turn in flight (tests and shutdown). */
  async idle(agentId: string): Promise<void> {
    await this.#runs.get(agentId)?.tail;
  }

  async #turn(run: Run, message: EngineMessage): Promise<void> {
    const { agent } = run;
    if (run.stopped) {
      // Its person is told, so they are not left waiting for an answer that will not come.
      this.#events.emit({
        type: "error",
        agentId: agent.id,
        userId: message.userId,
        message: "Not answered: the agent was stopped before it got to your message.",
      });
      return;
    }
    const emit = (event: EngineEvent) => {
      if (!run.stopped) this.#events.emit(event);
    };
    emit({ type: "status", agentId: agent.id, status: "busy" });
    try {
      const reply = await this.#runTurn(run, message);
      run.lastError = null;
      emit({ type: "message", agentId: agent.id, userId: message.userId, text: reply });
    } catch (err) {
      const text =
        err instanceof EngineRefusal ? err.message : "the agent could not answer (engine error)";
      run.lastError = text;
      if (!(err instanceof EngineRefusal)) {
        this.opts.logger.warn(
          { agentId: agent.id, err: err instanceof Error ? err.message.slice(0, 200) : "unknown" },
          "office agent turn failed",
        );
      }
      // Also when the run was stopped meanwhile: the person's turn is over either way.
      this.#events.emit({
        type: "error",
        agentId: agent.id,
        userId: message.userId,
        message: text,
      });
    }
    emit({ type: "status", agentId: agent.id, status: "ready" });
  }

  /** One turn with a token of its own, which is gone when the turn is, whichever way it ended. */
  async #runTurn(run: Run, message: EngineMessage): Promise<string> {
    const turn = run.office.turn?.(message.userId);
    try {
      return await this.#runWith(run, message, turn?.token ?? run.office.token);
    } finally {
      turn?.end();
    }
  }

  async #runWith(run: Run, message: EngineMessage, token: Secret): Promise<string> {
    const { agent, office } = run;
    const resets = run.resets[message.userId] ?? 0;
    // Decrypted here, for this turn only; refused when the owner may no longer use it.
    const { credential, attributedTo } = this.opts.credentials.resolve(agent);
    const user = { userId: agent.ownerUserId ?? OFFICE_AGENT_RUNNER_USER };
    const handle = await this.opts.runner.provision(user);
    const known = run.sessions[message.userId];
    const sessionId = known ?? (this.opts.newSessionId ?? (() => crypto.randomUUID()))();
    const plan = buildClaudeTurn({
      agent,
      home: handle.home,
      backend: this.opts.runner.backend,
      mcpUrl: office.mcpUrl,
      token,
      credential,
      sessionId,
      resume: known !== undefined,
      // The soul is the one it was started with; what it remembers is read from the office now.
      // A shared agent's: only what this person may see (#301).
      memory: office.mind.digest(message.userId),
      prompt: `[From ${message.fromName}, user id ${message.userId}]\n${message.text}`,
      command: this.opts.command,
    });
    if (run.stopped) throw new EngineRefusal("stopped", "the agent was stopped");
    const proc = await this.opts.runner.spawnPiped(user, plan);
    let timedOut = false;
    const kill = () => proc.kill("SIGKILL");
    run.kill = kill;
    const timeoutMs = this.opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    let stdout: string;
    try {
      [stdout] = await Promise.all([
        readCapped(proc.stdout, STDOUT_MAX),
        readCapped(proc.stderr, 64 * 1024),
        proc.exited,
      ]);
    } finally {
      clearTimeout(timer);
      run.kill = undefined;
    }
    if (run.stopped) throw new EngineRefusal("stopped", "the agent was stopped");
    if (timedOut) {
      throw new EngineRefusal(
        "timeout",
        `the agent did not answer within ${Math.max(1, Math.round(timeoutMs / 60_000))} min`,
      );
    }
    const result = parseClaudeTurn(stdout);
    // Not when their conversation was started over meanwhile: this session holds what it must not.
    const current = (run.resets[message.userId] ?? 0) === resets;
    if (known === undefined && result.error === null && current) {
      run.sessions[message.userId] = sessionId;
      this.#events.emit({
        type: "state",
        agentId: agent.id,
        state: { sessions: { ...run.sessions } },
      });
    }
    const u = result.usage;
    if (u.inputTokens + u.outputTokens > 0) {
      this.#events.emit({
        type: "usage",
        agentId: agent.id,
        usage: u,
        attributedTo,
        dedupeKey: agentUsageKey(agent.id, message.id),
      });
    }
    if (result.reply === null) throw new EngineRefusal("no_answer", result.error ?? "no answer");
    return result.reply;
  }
}
