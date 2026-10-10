/**
 * Turns the office itself gave an agent (#253: one part of a watchdog round):
 * which are open, the turn token each one holds, and who hears how it ended.
 *
 * The runtime (runtime.ts `instruct`) opens one, mints its token when the
 * engine asks for the turn's, and closes it when the engine reports the turn's
 * end or the office gives up on it.
 */
import type { Logger } from "../logging.ts";

/** How a turn the office itself asked for ended (`AgentRuntime.instruct`). */
export interface InstructionResult {
  agentId: string;
  /** What the office gave the turn for. */
  key: string;
  ok: boolean;
  /** The agent's last words, or why it could not do it. */
  text: string;
}

export class Instructions {
  /** `agentId key` → its turn token's id, once the engine asked for one. */
  readonly #open = new Map<string, string | null>();
  readonly #listeners = new Set<(result: InstructionResult) => void>();

  constructor(
    private readonly revoke: (agentId: string, tokenId: string) => void,
    private readonly logger: Logger,
  ) {}

  /** Hear how the office's own instructions ended. */
  listen(listener: (result: InstructionResult) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  open(agentId: string, key: string): void {
    this.#open.set(`${agentId} ${key}`, null);
  }

  isOpen(agentId: string, key: string): boolean {
    return this.#open.has(`${agentId} ${key}`);
  }

  /** The turn's token was minted: it is revoked when the turn is closed. */
  holds(agentId: string, key: string, tokenId: string): void {
    this.#open.set(`${agentId} ${key}`, tokenId);
  }

  /** Close it without telling anyone: its token stops working at once. */
  close(agentId: string, key: string): void {
    const tokenId = this.#open.get(`${agentId} ${key}`);
    this.#open.delete(`${agentId} ${key}`);
    if (tokenId) this.revoke(agentId, tokenId);
  }

  /** The engine says the turn ended. False when this was no turn of the office's own. */
  ended(agentId: string, key: string, ok: boolean, text: string): boolean {
    if (!this.isOpen(agentId, key)) return false;
    this.close(agentId, key);
    for (const listener of [...this.#listeners]) {
      try {
        listener({ agentId, key, ok, text });
      } catch (err) {
        this.logger.error({ agentId, err: String(err).slice(0, 300) }, "instruction listener");
      }
    }
    return true;
  }
}
