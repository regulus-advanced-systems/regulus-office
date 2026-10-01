/**
 * The one funnel for agent events. Everything that learns something about an
 * agent publishes here: the AgentManager piping `AgentControl.events` (#26),
 * and the routes that receive out-of-band inputs (Claude http hooks and
 * statusline forwarder, Codex notify) after `AgentAdapter.ingest` mapped them.
 * The AgentManager's sink persists to `agent_events` and updates HenchmanState.
 */
import { AgentEvent } from "@regulus/protocol";

export interface AgentEventSink {
  publish(agentId: string, event: AgentEvent): void | Promise<void>;
}

/**
 * Wraps a sink so only schema-valid events reach it. Out-of-band payloads are
 * untrusted, so this sits in front of the real sink; invalid events are
 * dropped and reported to `onInvalid` (which must not log the raw payload).
 */
export function validatingSink(
  inner: AgentEventSink,
  onInvalid: (agentId: string, issues: string[]) => void = () => {},
): AgentEventSink {
  return {
    publish(agentId, event) {
      const parsed = AgentEvent.safeParse(event);
      if (!parsed.success) {
        onInvalid(
          agentId,
          parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
        );
        return;
      }
      return inner.publish(agentId, parsed.data);
    },
  };
}

/** Publishes to every sink in order; waits for async ones. */
export function fanOutSink(...sinks: AgentEventSink[]): AgentEventSink {
  return {
    async publish(agentId, event) {
      for (const sink of sinks) await sink.publish(agentId, event);
    },
  };
}

/** In-memory sink for tests; also lets a test await the next event. */
export class MemoryEventSink implements AgentEventSink {
  readonly events: { agentId: string; event: AgentEvent }[] = [];
  #waiters: {
    match: (e: AgentEvent) => boolean;
    agentId?: string;
    resolve: (e: AgentEvent) => void;
  }[] = [];

  publish(agentId: string, event: AgentEvent): void {
    this.events.push({ agentId, event });
    this.#waiters = this.#waiters.filter((w) => {
      if ((w.agentId !== undefined && w.agentId !== agentId) || !w.match(event)) return true;
      w.resolve(event);
      return false;
    });
  }

  for(agentId: string): AgentEvent[] {
    return this.events.filter((e) => e.agentId === agentId).map((e) => e.event);
  }

  /** Resolves with the next matching event published after this call. */
  next(match: (e: AgentEvent) => boolean = () => true, agentId?: string): Promise<AgentEvent> {
    return new Promise((resolve) => this.#waiters.push({ match, agentId, resolve }));
  }
}

/** Drain an `AgentControl.events` stream into a sink until it ends. */
export async function pipeEvents(
  agentId: string,
  events: AsyncIterable<AgentEvent>,
  sink: AgentEventSink,
): Promise<void> {
  for await (const event of events) await sink.publish(agentId, event);
}
