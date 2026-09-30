/**
 * Which container a docker-backend operation runs in, and the exec plumbing
 * for it: an agent's own sandbox when it has one (#169, sandboxes.ts), else
 * the human's runner container (created or started on demand, containers.ts).
 */
import type { RunnerContainers } from "./containers.ts";
import { DockerApiError, type EngineClient, type ExecOptions, type ExecResult } from "./engine.ts";
import type { DockerSandboxes } from "./sandboxes.ts";

/** A human, and the agent when the operation is about one. */
export interface Where {
  userId: string;
  agentId?: string;
}

interface Resolved {
  id: string;
  /** Set when `id` is the agent's sandbox. */
  sandbox?: string;
}

export class ExecRouter {
  /** Runner container ids by human. */
  readonly ids = new Map<string, string>();

  constructor(
    private readonly engine: EngineClient,
    private readonly containers: RunnerContainers,
    private readonly sandboxes: DockerSandboxes | undefined,
  ) {}

  /** The agent's sandbox container id, when it has one. */
  async sandboxOf(where: Where): Promise<string | undefined> {
    if (!where.agentId || !this.sandboxes) return undefined;
    const sb = await this.sandboxes.route(where.agentId);
    return sb && sb.userId === where.userId ? sb.id : undefined;
  }

  /** Container id: the sandbox, else the runner (cached, else looked up; created when `create`). */
  async resolve(where: Where, create: boolean): Promise<Resolved | null> {
    const sandbox = await this.sandboxOf(where);
    if (sandbox) return { id: sandbox, sandbox: where.agentId };
    const { userId } = where;
    const cached = this.ids.get(userId);
    if (cached) return { id: cached };
    const c = create
      ? await this.containers.ensure(userId)
      : await this.containers
          .lookup(userId)
          .then((found) => (found && !found.running ? this.containers.ensure(userId) : found));
    if (c) this.ids.set(userId, c.id);
    return c ? { id: c.id } : null;
  }

  async require(where: Where): Promise<string> {
    const found = await this.resolve(where, false);
    if (!found) throw new Error(`no runner container for user ${where.userId}`);
    return found.id;
  }

  /**
   * Exec where the operation belongs. A cached runner that vanished or stopped is
   * looked up again once; a sandbox that did is forgotten (its agent is gone).
   */
  run(where: Where, opts: ExecOptions): Promise<ExecResult>;
  run(where: Where, opts: ExecOptions, create: false): Promise<ExecResult | null>;
  async run(where: Where, opts: ExecOptions, create = true): Promise<ExecResult | null> {
    for (let attempt = 0; ; attempt++) {
      const found = await this.resolve(where, create);
      if (!found) {
        if (create) throw new Error(`no runner container for user ${where.userId}`);
        return null;
      }
      try {
        return await this.engine.exec(found.id, opts);
      } catch (e) {
        const stale = e instanceof DockerApiError && (e.status === 404 || e.status === 409);
        if (!stale) throw e;
        if (found.sandbox) {
          this.sandboxes?.forget(found.sandbox, found.id);
          if (create) throw new Error(`the sandbox of agent ${found.sandbox} is gone`);
          return null;
        }
        if (attempt > 0) throw e;
        this.ids.delete(where.userId);
      }
    }
  }

  tmux(where: Where, args: string[]): Promise<ExecResult>;
  tmux(where: Where, args: string[], create: false): Promise<ExecResult | null>;
  tmux(where: Where, args: string[], create = true): Promise<ExecResult | null> {
    const cmd = ["tmux", "-S", this.containers.tmuxSocket(where.userId), ...args];
    return create ? this.run(where, { cmd }) : this.run(where, { cmd }, false);
  }
}
