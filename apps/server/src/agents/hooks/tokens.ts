/**
 * Per-agent hook tokens (SPEC §8). Each agent's Claude hooks and statusline
 * forwarder authenticate with a random bearer token that only that agent's
 * runner files contain. The AgentManager (#26) issues and stores them; the
 * hook routes only need `verify`.
 *
 * Tokens are never logged: the routes log the route pattern, and
 * `Authorization` is on the logger's redaction list.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface AgentTokenVerifier {
  /** True when `token` is the current hook token of `agentId`. Constant time. */
  verify(agentId: string, token: string): boolean;
}

/** Until the AgentManager (#26) lands: no agent has a token, every hook is 401. */
export const denyAllAgentTokens: AgentTokenVerifier = {
  verify: () => false,
};

/** 32 random bytes, base64url. */
export function newAgentToken(): string {
  return randomBytes(32).toString("base64url");
}

const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/**
 * Constant-time string equality. Both sides are hashed first so the
 * comparison takes the same time whatever the lengths.
 */
export function tokensEqual(expected: string, actual: string): boolean {
  return timingSafeEqual(digest(expected), digest(actual)) && expected.length > 0;
}

/**
 * In-memory token store: a reference implementation for #26 and the store
 * used by tests. Keeps only a SHA-256 digest of each token.
 */
export class MemoryAgentTokens implements AgentTokenVerifier {
  readonly #digests = new Map<string, Buffer>();

  /** Issues (or rotates) the agent's token and returns the plaintext once. */
  issue(agentId: string): string {
    const token = newAgentToken();
    this.#digests.set(agentId, digest(token));
    return token;
  }

  revoke(agentId: string): void {
    this.#digests.delete(agentId);
  }

  verify(agentId: string, token: string): boolean {
    const expected = this.#digests.get(agentId);
    // Compare against a dummy digest when unknown so timing does not reveal agent ids.
    const actual = digest(token);
    const ok = timingSafeEqual(expected ?? Buffer.alloc(actual.length), actual);
    return ok && expected !== undefined && token.length > 0;
  }
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S{1,512})\s*$/i.exec(header);
  return match?.[1] ?? null;
}
