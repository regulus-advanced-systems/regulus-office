/**
 * Office approvals for a TUI-driven Claude Code session.
 *
 * Claude Code runs `PermissionRequest` hooks "when it's about to ask you for
 * permission", and an http hook answers by returning a 2xx JSON body with
 * `hookSpecificOutput.decision.behavior` = `allow` | `deny`
 * (https://code.claude.com/docs/en/hooks#permissionrequest-decision-control).
 * That is the documented way to answer from outside the terminal, so the
 * office holds the hook's HTTP response open until `respondPermission` is
 * called (or a bounded hold expires) and then answers through it. Sending
 * keystrokes to the permission dialog in the tmux pane is not used: the
 * dialog's options and key bindings are not a documented interface.
 *
 * When the hold expires, the office answers with an empty 2xx body (no
 * decision), Claude Code continues with its normal flow and the human can
 * still answer in the terminal.
 */
import type { PermissionDecision } from "@regulus/protocol";
import { isObject, type Json } from "./payload.ts";

interface Pending {
  suggestions: readonly unknown[];
  resolve: (decision: PermissionDecision | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Pending `PermissionRequest` hooks, keyed by agent and request id. One broker
 * belongs to one `ClaudeCodeAdapter`; the hook route waits on it and the
 * agent's `AgentControl.respondPermission` resolves it.
 */
export class PermissionBroker {
  readonly #pending = new Map<string, Map<string, Pending>>();

  /**
   * Waits for the office's decision; resolves null when `timeoutMs` passes,
   * `signal` aborts (Claude Code gave up on the hook) or the agent's pending
   * requests are cancelled.
   */
  wait(
    agentId: string,
    requestId: string,
    suggestions: readonly unknown[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<PermissionDecision | null> {
    return new Promise((resolve) => {
      const forAgent = this.#pending.get(agentId) ?? new Map<string, Pending>();
      this.#pending.set(agentId, forAgent);
      const finish = (decision: PermissionDecision | null) => {
        const entry = forAgent.get(requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        forAgent.delete(requestId);
        if (forAgent.size === 0) this.#pending.delete(agentId);
        signal?.removeEventListener("abort", onAbort);
        resolve(decision);
      };
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
      forAgent.set(requestId, { suggestions, resolve: finish, timer });
      if (signal?.aborted) finish(null);
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** True when a pending request was answered; false when unknown or expired. */
  resolve(agentId: string, requestId: string, decision: PermissionDecision): boolean {
    const entry = this.#pending.get(agentId)?.get(requestId);
    if (!entry) return false;
    entry.resolve(decision);
    return true;
  }

  /** Releases every pending request of an agent without a decision. */
  cancelAgent(agentId: string): void {
    for (const entry of [...(this.#pending.get(agentId)?.values() ?? [])]) entry.resolve(null);
  }

  pending(agentId: string): string[] {
    return [...(this.#pending.get(agentId)?.keys() ?? [])];
  }

  suggestions(agentId: string, requestId: string): readonly unknown[] {
    return this.#pending.get(agentId)?.get(requestId)?.suggestions ?? [];
  }
}

/**
 * The http hook response body for a decision.
 *
 * - `allow_once`: `behavior: "allow"`.
 * - `allow_always`: `allow` plus the request's own `permission_suggestions`
 *   echoed as `updatedPermissions` (documented as allowed), with the
 *   destination forced to `session` so nothing is written into the repo's
 *   `.claude/settings*.json` or the human's user settings.
 * - `reject`: `behavior: "deny"` with a message for Claude.
 */
export function permissionHookResponse(
  decision: PermissionDecision,
  suggestions: readonly unknown[] = [],
): Json {
  const body =
    decision === "reject"
      ? { behavior: "deny", message: "Rejected by the owner in Regulus Office." }
      : decision === "allow_always" && suggestions.length > 0
        ? { behavior: "allow", updatedPermissions: sessionScoped(suggestions) }
        : { behavior: "allow" };
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: body } };
}

function sessionScoped(suggestions: readonly unknown[]): Json[] {
  return suggestions.filter(isObject).map((s) => ({ ...s, destination: "session" }));
}
