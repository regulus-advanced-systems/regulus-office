/**
 * The office's internal access bus (SPEC D27; #267). The access service
 * emits `access-changed` whenever a person's permission on one or more office
 * repos changed in the snapshot: gained, raised, lowered or lost (a revoked
 * token and an unlink lose them all).
 *
 *   const off = access.events.on("access-changed", ({ userId, repoIds }) => {
 *     // #244: close what this person may no longer see; #270: re-check live state
 *   });
 *
 * The event says which repos to look at again, not what the new permission
 * is: ask `repoPermissionFor(userId, repoId)`, which is already up to date
 * when a handler runs. Handlers are called without being awaited; one that
 * throws or rejects is logged and does not affect the others.
 */
import type { Logger } from "../../logging.ts";

export type AccessChangeReason = "refresh" | "revoked" | "unlinked";

export interface AccessChangedEvent {
  userId: string;
  /** Office repo ids (`operation_repos.id`) whose permission changed for this person. */
  repoIds: string[];
  reason: AccessChangeReason;
}

type Handler = (event: AccessChangedEvent) => void | Promise<void>;

export class AccessEventBus {
  readonly #handlers = new Set<Handler>();
  readonly #logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.#logger = logger;
  }

  /** Subscribe; returns an unsubscribe function. */
  on(_name: "access-changed", handler: Handler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  emit(_name: "access-changed", event: AccessChangedEvent): void {
    for (const handler of [...this.#handlers]) {
      try {
        const result = handler(event);
        if (result instanceof Promise) result.catch((err) => this.#failed(event, err));
      } catch (err) {
        this.#failed(event, err);
      }
    }
  }

  get listenerCount(): number {
    return this.#handlers.size;
  }

  #failed(event: AccessChangedEvent, err: unknown): void {
    this.#logger?.error({ userId: event.userId, err }, "access-changed handler failed");
  }
}
