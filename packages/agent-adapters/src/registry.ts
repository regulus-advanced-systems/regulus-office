/** Adapter registry keyed by `ProviderId` (SPEC §7). */
import { isProviderId, type ProviderId } from "@regulus/protocol";
import type { AgentAdapter } from "./types.ts";

export class AdapterRegistry {
  readonly #adapters = new Map<ProviderId, AgentAdapter>();

  constructor(adapters: Iterable<AgentAdapter> = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: AgentAdapter): this {
    if (!isProviderId(adapter.id)) throw new Error(`Unknown provider id: ${String(adapter.id)}`);
    if (this.#adapters.has(adapter.id)) {
      throw new Error(`Adapter already registered for provider: ${adapter.id}`);
    }
    this.#adapters.set(adapter.id, adapter);
    return this;
  }

  has(id: ProviderId): boolean {
    return this.#adapters.has(id);
  }

  /** The adapter for `id`, or undefined when that provider is not installed. */
  find(id: ProviderId): AgentAdapter | undefined {
    return this.#adapters.get(id);
  }

  /** The adapter for `id`; throws when none is registered. */
  get(id: ProviderId): AgentAdapter {
    const adapter = this.#adapters.get(id);
    if (!adapter) throw new Error(`No adapter registered for provider: ${id}`);
    return adapter;
  }

  providers(): ProviderId[] {
    return [...this.#adapters.keys()];
  }
}
