/**
 * Login sessions: tmux sessions in a human's runner that are not agents,
 * where the unmodified CLI runs its own subscription login (`claude auth
 * login`, SPEC §8 rule 1). They share the terminal bridge under
 * `/ws/term/login-<id>` but not the agent ACL: a login terminal belongs to
 * the human logging in and nobody else, admins included, because the pasted
 * code and the account picker are theirs alone. Others get 404, as if it did
 * not exist. No scrollback is recorded to disk for them.
 *
 * The credentials module (#32) registers a session when it starts one and
 * unregisters it when the login finishes, is cancelled or times out.
 */
import { LOGIN_TERMINAL_PREFIX } from "@regulus/protocol";
import type { Runner, TmuxSessionRef } from "../runners/types.ts";
import type { TerminalTarget, TerminalTargets } from "./targets.ts";

export const LOGIN_TERMINAL_ID_PATTERN = /^login-[A-Za-z0-9_-]{1,58}$/;

export const isLoginTerminalId = (id: string): boolean => id.startsWith(LOGIN_TERMINAL_PREFIX);

export interface LoginSession {
  /** `login-…`: the path segment of `/ws/term/<id>`. */
  terminalId: string;
  ownerUserId: string;
  session: TmuxSessionRef;
  runner: Runner;
}

/** Whether `user` may open a login terminal: only its owner, in any mode. */
export function mayUseLoginTerminal(user: { id: string }, ownerUserId: string): boolean {
  return user.id === ownerUserId;
}

export class LoginSessionTargets implements TerminalTargets {
  readonly #sessions = new Map<string, LoginSession>();

  register(session: LoginSession): void {
    if (!LOGIN_TERMINAL_ID_PATTERN.test(session.terminalId)) {
      throw new Error("login terminal id must be login-<id>");
    }
    this.#sessions.set(session.terminalId, session);
  }

  unregister(terminalId: string): void {
    this.#sessions.delete(terminalId);
  }

  has(terminalId: string): boolean {
    return this.#sessions.has(terminalId);
  }

  async resolve(terminalId: string): Promise<TerminalTarget | null> {
    const found = this.#sessions.get(terminalId);
    if (!found) return null;
    return {
      kind: "login",
      agentId: found.terminalId,
      ownerUserId: found.ownerUserId,
      operationId: "",
      session: found.session,
      runner: found.runner,
    };
  }
}
