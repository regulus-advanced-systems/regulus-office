/**
 * Per-agent hook tokens backed by `agents.hook_token_hash` (SPEC §8: agent
 * tokens are stored hashed). The plaintext is returned once by `issue` and
 * goes straight into the spawn's `RunnerContext.agentToken` (a `Secret`),
 * from where the adapter writes it into 0600 files in the human's runner.
 * Persisting the digest lets hooks from agents that survived an office
 * restart authenticate again after re-adoption.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { agents } from "../../db/schema/index.ts";
import { type AgentTokenVerifier, newAgentToken } from "../hooks/tokens.ts";

const sha256 = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

export class DbAgentTokens implements AgentTokenVerifier {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Issue (or rotate) the agent's token; the row must exist. Returns the plaintext once. */
  issue(agentId: string): string {
    const token = newAgentToken();
    this.#db
      .update(agents)
      .set({ hookTokenHash: sha256(token).toString("hex") })
      .where(eq(agents.id, agentId))
      .run();
    return token;
  }

  revoke(agentId: string): void {
    this.#db.update(agents).set({ hookTokenHash: null }).where(eq(agents.id, agentId)).run();
  }

  verify(agentId: string, token: string): boolean {
    const row = this.#db
      .select({ hash: agents.hookTokenHash })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get();
    const actual = sha256(token);
    const expected = row?.hash ? Buffer.from(row.hash, "hex") : undefined;
    // Compare against a dummy when unknown so timing does not reveal agent ids.
    const ok = timingSafeEqual(
      expected?.length === actual.length ? expected : Buffer.alloc(actual.length),
      actual,
    );
    return ok && expected !== undefined && token.length > 0;
  }
}
