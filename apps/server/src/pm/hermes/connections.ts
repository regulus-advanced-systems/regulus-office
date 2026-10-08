/**
 * A person's connection to their own Hermes gateway (#58): the address and
 * the access token, as a credential of that person (SPEC §8).
 *
 * - Stored as one envelope (AES-256-GCM under `OFFICE_MASTER_KEY`) whose
 *   context binds it to the owner and the agent: a row copied to another
 *   agent or another person does not decrypt.
 * - Decrypted only by `resolve`, for the engine and the connection test, and
 *   only for the agent's own owner.
 * - `view` is all a browser ever gets: that a connection is there.
 */
import { Secret } from "@regulus/agent-adapters";
import {
  type HermesConnectionInput,
  type HermesConnectionView,
  normalizeHermesUrl,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { officeAgentConnections } from "../../db/schema/index.ts";
import {
  decryptSecretToString,
  encryptSecret,
  type MasterKeyring,
  type SecretContext,
} from "../../secrets/index.ts";
import { EngineRefusal } from "../engines/types.ts";

/** A connection in use. `token` never prints. */
export interface HermesConnection {
  url: string;
  token: Secret;
  /** The session the owner asked to continue, if any. */
  sessionId?: string;
}

export interface ConnectionSubject {
  id: string;
  ownerUserId: string | null;
}

const context = (agent: { id: string; ownerUserId: string }): SecretContext => ({
  userId: agent.ownerUserId,
  secretName: `office_agent_connection:${agent.id}`,
});

export class HermesConnections {
  constructor(
    private readonly db: Db,
    private readonly keyring: MasterKeyring | undefined,
  ) {}

  /** Whether a connection could be stored at all (the office has its master key). */
  get usable(): boolean {
    return this.keyring !== undefined;
  }

  /** Store (or replace) the owner's connection for their agent. */
  save(agent: ConnectionSubject, input: HermesConnectionInput): void {
    if (agent.ownerUserId === null) {
      throw new EngineRefusal("personal_only", "only a personal agent can connect to a Hermes");
    }
    if (!this.keyring) {
      throw new EngineRefusal(
        "master_key_missing",
        "OFFICE_MASTER_KEY is not set, so the office cannot keep a connection safely",
      );
    }
    const owner = { id: agent.id, ownerUserId: agent.ownerUserId };
    const plaintext = JSON.stringify({
      url: normalizeHermesUrl(input.url),
      token: input.token,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    const encryptedSecret = encryptSecret(
      plaintext,
      context(owner),
      this.keyring.keys,
      this.keyring.current,
    );
    const values = {
      ownerUserId: agent.ownerUserId,
      encryptedSecret,
      continuesSession: input.sessionId !== undefined,
    };
    this.db
      .insert(officeAgentConnections)
      .values({ agentId: agent.id, ...values })
      .onConflictDoUpdate({ target: officeAgentConnections.agentId, set: values })
      .run();
  }

  /** What may be shown: that it exists, nothing of what it holds. */
  view(agentId: string): HermesConnectionView {
    const row = this.#row(agentId);
    if (!row) return { connected: false, continuesSession: false };
    return {
      connected: true,
      continuesSession: row.continuesSession,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  /** The connection in the clear, for the agent's own owner only. Throws {@link EngineRefusal}. */
  resolve(agent: ConnectionSubject): HermesConnection {
    const row = this.#row(agent.id);
    // Someone else's row is indistinguishable from a missing one.
    if (!row || agent.ownerUserId === null || row.ownerUserId !== agent.ownerUserId) {
      throw new EngineRefusal(
        "hermes_not_connected",
        "this agent has no Hermes connection yet: enter its address and access token",
      );
    }
    if (!this.keyring) {
      throw new EngineRefusal(
        "master_key_missing",
        "OFFICE_MASTER_KEY is not set; the Hermes connection cannot be read",
      );
    }
    try {
      const value = JSON.parse(
        decryptSecretToString(
          row.encryptedSecret,
          context({ id: agent.id, ownerUserId: agent.ownerUserId }),
          this.keyring.keys,
        ),
      ) as { url?: unknown; token?: unknown; sessionId?: unknown };
      if (typeof value.url !== "string" || typeof value.token !== "string") throw new Error();
      return {
        url: value.url,
        token: Secret.of(value.token),
        ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
      };
    } catch {
      throw new EngineRefusal(
        "hermes_connection_unreadable",
        "the stored Hermes connection cannot be read: enter its address and access token again",
      );
    }
  }

  delete(agentId: string): void {
    this.db.delete(officeAgentConnections).where(eq(officeAgentConnections.agentId, agentId)).run();
  }

  #row(agentId: string) {
    return this.db
      .select()
      .from(officeAgentConnections)
      .where(eq(officeAgentConnections.agentId, agentId))
      .get();
  }
}
