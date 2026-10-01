/**
 * Pending permission requests per agent (SPEC §7 `permission_request`, §8
 * rule 4). The manager records each request when its event arrives and drops
 * it when it is answered through the office, when the adapter reports it
 * resolved (`AgentControl.onPermissionResolved`: Codex `serverRequest/resolved`,
 * Claude's held hook released), when it expires, or when the agent exits or
 * is sent home. Only for adapters without that per-request signal does the
 * agent leaving `waiting_permission` clear everything. Every change is
 * handed to `onChange` with the agent's full list so the OperationRoom can
 * deliver it to the henchman's controllers only. The public world only ever
 * sees `HenchmanState.handRaised`.
 *
 * Expiry: Claude Code holds a PermissionRequest hook for a bounded time, then
 * falls back to its own dialog in the terminal; after that the office can no
 * longer answer, so the request is dropped at `expiresAt`. Adapters without a
 * bound (Codex keeps approvals open) get a generous default.
 */
import type { PendingPermission, PermissionRequestEvent } from "@regulus/protocol";

/** Default lifetime of a request when the adapter does not bound it. */
export const DEFAULT_PERMISSION_TTL_MS = 30 * 60_000;
/** A henchman never has more than this many open requests; the oldest go first. */
const MAX_PER_AGENT = 20;

export type PermissionsListener = (agentId: string, requests: PendingPermission[]) => void;

export interface PendingPermissionsOptions {
  onChange: PermissionsListener;
  now: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Entry {
  request: PendingPermission;
  timer: unknown;
}

export class PendingPermissions {
  readonly #byAgent = new Map<string, Map<string, Entry>>();
  readonly #opts: PendingPermissionsOptions;
  readonly #setTimer: (fn: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;

  constructor(opts: PendingPermissionsOptions) {
    this.#opts = opts;
    this.#setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Record a request from its event; `ttlMs` bounds how long the office can answer it. */
  add(agentId: string, event: PermissionRequestEvent, ttlMs: number): void {
    const now = this.#opts.now();
    const request: PendingPermission = {
      requestId: event.requestId,
      toolName: event.toolName,
      description: event.description,
      options: [...event.options],
      requestedAt: now,
      expiresAt: now + ttlMs,
    };
    const forAgent = this.#byAgent.get(agentId) ?? new Map<string, Entry>();
    this.#byAgent.set(agentId, forAgent);
    const previous = forAgent.get(request.requestId);
    if (previous) this.#clearTimer(previous.timer);
    while (forAgent.size >= MAX_PER_AGENT && !previous) {
      const oldest = forAgent.keys().next().value as string;
      this.#clearTimer(forAgent.get(oldest)?.timer);
      forAgent.delete(oldest);
    }
    const timer = this.#setTimer(() => this.remove(agentId, request.requestId), Math.max(0, ttlMs));
    forAgent.set(request.requestId, { request, timer });
    this.#emit(agentId);
  }

  has(agentId: string, requestId: string): boolean {
    return this.#byAgent.get(agentId)?.has(requestId) ?? false;
  }

  list(agentId: string): PendingPermission[] {
    return [...(this.#byAgent.get(agentId)?.values() ?? [])].map((e) => e.request);
  }

  /** Drop one request (answered or expired). */
  remove(agentId: string, requestId: string): void {
    const forAgent = this.#byAgent.get(agentId);
    const entry = forAgent?.get(requestId);
    if (!forAgent || !entry) return;
    this.#clearTimer(entry.timer);
    forAgent.delete(requestId);
    if (forAgent.size === 0) this.#byAgent.delete(agentId);
    this.#emit(agentId);
  }

  /** Drop every request of an agent (it moved on, exited, or left). */
  clear(agentId: string): void {
    const forAgent = this.#byAgent.get(agentId);
    if (!forAgent) return;
    for (const entry of forAgent.values()) this.#clearTimer(entry.timer);
    this.#byAgent.delete(agentId);
    this.#emit(agentId);
  }

  /** Stop every timer without notifying (shutdown). */
  dispose(): void {
    for (const forAgent of this.#byAgent.values()) {
      for (const entry of forAgent.values()) this.#clearTimer(entry.timer);
    }
    this.#byAgent.clear();
  }

  #emit(agentId: string): void {
    this.#opts.onChange(agentId, this.list(agentId));
  }
}
