/**
 * Per-agent bearer tokens for the office MCP server and the tool REST API
 * (SPEC §10 M5, §8; #271).
 *
 * A token is `roa_` + 32 random bytes (base64url). Only its SHA-256 is stored;
 * the plaintext is returned once, by `mint`, and never logged (`Authorization`
 * is on the logger's redaction list, and nothing here logs). A token names
 * exactly one agent, so it can never act as another.
 *
 * - `api` tokens are minted by whoever may configure the agent (for an
 *   external engine such as a Hermes gateway) and live until revoked. The
 *   office keeps who minted each: a shared agent called with one reads only
 *   what that person may read themselves (#301, tools/asking.ts);
 * - `session` tokens are minted by the office for one engine run and revoked
 *   when the agent stops;
 * - `turn` tokens are minted by the office for one turn of one person's
 *   conversation with the agent and revoked when that turn is over (#301):
 *   what the agent does with one is answered for that person.
 */
import { createHash, randomBytes } from "node:crypto";
import { OFFICE_AGENT_LIMITS, OFFICE_AGENT_TOKEN_PREFIX } from "@regulus/protocol";
import { and, asc, eq, ne } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { officeAgentTokens } from "../db/schema/index.ts";

export type OfficeAgentTokenKind = "api" | "session" | "turn";

export interface MintedToken {
  id: string;
  label: string;
  /** The plaintext: hand it over once and drop it. */
  token: string;
}

export const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

const TOKEN = new RegExp(`^${OFFICE_AGENT_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);

/** How often `lastUsedAt` is written at most. */
const TOUCH_EVERY_MS = 60_000;

export class OfficeAgentTokens {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** Null when the agent already holds the most `api` tokens it may. */
  mint(
    agentId: string,
    kind: OfficeAgentTokenKind,
    label: string,
    mintedBy: string | null = null,
    forUserId: string | null = null,
  ): MintedToken | null {
    if (kind === "api" && this.list(agentId).length >= OFFICE_AGENT_LIMITS.tokensPerAgent) {
      return null;
    }
    const token = `${OFFICE_AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const row = this.db
      .insert(officeAgentTokens)
      .values({ agentId, kind, label, tokenHash: hashToken(token), mintedBy, forUserId })
      .returning({ id: officeAgentTokens.id })
      .get();
    return { id: row.id, label, token };
  }

  /** The agent a presented token belongs to, or null. Malformed input never reaches the database. */
  verify(presented: string): {
    agentId: string;
    tokenId: string;
    kind: OfficeAgentTokenKind;
    mintedBy: string | null;
    forUserId: string | null;
  } | null {
    if (!TOKEN.test(presented)) return null;
    const row = this.db
      .select()
      .from(officeAgentTokens)
      .where(eq(officeAgentTokens.tokenHash, hashToken(presented)))
      .get();
    if (!row) return null;
    const now = this.now();
    if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      this.db
        .update(officeAgentTokens)
        .set({ lastUsedAt: new Date(now) })
        .where(eq(officeAgentTokens.id, row.id))
        .run();
    }
    return {
      agentId: row.agentId,
      tokenId: row.id,
      kind: row.kind,
      mintedBy: row.mintedBy,
      forUserId: row.forUserId,
    };
  }

  /** The agent's `api` tokens, without any secret material. */
  list(agentId: string) {
    return this.db
      .select({
        id: officeAgentTokens.id,
        label: officeAgentTokens.label,
        createdAt: officeAgentTokens.createdAt,
        lastUsedAt: officeAgentTokens.lastUsedAt,
      })
      .from(officeAgentTokens)
      .where(and(eq(officeAgentTokens.agentId, agentId), eq(officeAgentTokens.kind, "api")))
      .orderBy(asc(officeAgentTokens.createdAt))
      .all();
  }

  revoke(agentId: string, tokenId: string): boolean {
    return (
      this.db
        .delete(officeAgentTokens)
        .where(and(eq(officeAgentTokens.agentId, agentId), eq(officeAgentTokens.id, tokenId)))
        .returning({ id: officeAgentTokens.id })
        .all().length > 0
    );
  }

  /** Drop the tokens of the agent's engine runs and their turns (on stop, and before a new start). */
  revokeSessions(agentId: string): void {
    this.db
      .delete(officeAgentTokens)
      .where(and(eq(officeAgentTokens.agentId, agentId), ne(officeAgentTokens.kind, "api")))
      .run();
  }

  /** After a restart no engine run holds a session or turn token any more. */
  revokeAllSessions(): void {
    this.db.delete(officeAgentTokens).where(ne(officeAgentTokens.kind, "api")).run();
  }
}

/** The bearer token of a request, or null. */
export function bearerOf(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}
