/**
 * Which model credential an office agent runs on (SPEC §8, D2; #271).
 *
 * - A **shared** agent runs on an office-wide key only: `office:<provider>`
 *   (the first office key of the provider) or one named office profile (so
 *   the watchdog can use the office's DeepSeek profile while the PM uses the
 *   Anthropic key). Never a person's profile and never a CLI (subscription)
 *   login: with no office key the agent does not start. Usage goes to `office`.
 * - A **personal** agent runs in its owner's runner with what its owner may
 *   use for their own henchmen: their CLI login (no profile), one of their own
 *   profiles, or the opt-in office key. That check is the henchmen's own
 *   `CredentialResolver`, so the rules cannot drift apart.
 *
 * Keys are decrypted only by `resolve`, right before a turn's plan is built.
 */
import { Secret, type SpawnCredential } from "@regulus/agent-adapters";
import {
  engineBringsOwnModel,
  type OfficeAgentEngineKind,
  type ProviderId,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import {
  CredentialResolver,
  credentialProfileContext,
  OFFICE_PROFILE_PREFIX,
} from "../../agents/manager/credentials.ts";
import { AgentManagerError } from "../../agents/manager/errors.ts";
import type { Db } from "../../db/index.ts";
import { credentialProfiles } from "../../db/schema/index.ts";
import { decryptSecretToString, type MasterKeyring } from "../../secrets/index.ts";
import { EngineRefusal } from "./types.ts";

export interface CredentialSubject {
  /** Given: an engine that brings its own provider and model needs no credential from the office (#58). */
  engine?: OfficeAgentEngineKind;
  ownerUserId: string | null;
  provider: ProviderId;
  profileId: string | null;
}

export interface AgentCredential {
  credential: SpawnCredential;
  /** Who the usage is charged to. */
  attributedTo: "office" | { userId: string };
}

export class AgentCredentials {
  readonly #resolver: CredentialResolver;

  constructor(
    private readonly db: Db,
    private readonly keyring: MasterKeyring | undefined,
  ) {
    this.#resolver = new CredentialResolver(db, keyring);
  }

  /** Refuse a choice the agent may not use, without decrypting anything. */
  check(agent: CredentialSubject): void {
    if (agent.engine && engineBringsOwnModel(agent.engine)) return;
    if (agent.ownerUserId === null) {
      this.#officeProfile(agent);
      return;
    }
    this.#personal(() =>
      this.#resolver.check(
        agent.ownerUserId as string,
        agent.provider,
        agent.profileId ?? undefined,
      ),
    );
  }

  resolve(agent: CredentialSubject): AgentCredential {
    if (agent.ownerUserId === null) {
      const row = this.#officeProfile(agent);
      if (row === "office-prefix") {
        const resolved = this.#personal(() =>
          this.#resolver.resolve("", agent.provider, agent.profileId ?? undefined),
        );
        return { credential: resolved.credential, attributedTo: "office" };
      }
      return { credential: this.#decrypt(row), attributedTo: "office" };
    }
    const userId = agent.ownerUserId;
    const resolved = this.#personal(() =>
      this.#resolver.resolve(userId, agent.provider, agent.profileId ?? undefined),
    );
    const office =
      resolved.credential.kind !== "cli_login" && resolved.credential.attributedTo === "office";
    return { credential: resolved.credential, attributedTo: office ? "office" : { userId } };
  }

  #personal<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof AgentManagerError) throw new EngineRefusal("credential", err.message);
      throw err;
    }
  }

  /** The office profile a shared agent names; throws when it names anything else. */
  #officeProfile(agent: CredentialSubject) {
    const refuse = (message: string) => new EngineRefusal("office_key_required", message);
    if (!agent.profileId) {
      throw refuse(
        "a shared agent runs on an office key only: pick an office-wide key for its provider",
      );
    }
    if (agent.profileId.startsWith(OFFICE_PROFILE_PREFIX)) {
      // Throws when there is no office key for the provider.
      this.#personal(() => this.#resolver.check("", agent.provider, agent.profileId ?? undefined));
      return "office-prefix" as const;
    }
    const row = this.db
      .select()
      .from(credentialProfiles)
      .where(eq(credentialProfiles.id, agent.profileId))
      .get();
    // A person's profile is indistinguishable from a missing one.
    if (!row || row.userId !== null || row.authKind === "cli_login") {
      throw refuse("a shared agent runs on an office key only: that is not an office-wide key");
    }
    if (row.provider !== agent.provider) {
      throw refuse("that office key is for another provider");
    }
    return row;
  }

  #decrypt(row: typeof credentialProfiles.$inferSelect): SpawnCredential {
    if (!row.encryptedSecret) throw new EngineRefusal("credential", "the office key is empty");
    if (!this.keyring) {
      throw new EngineRefusal("credential", "OFFICE_MASTER_KEY is not set; keys are unavailable");
    }
    let apiKey: Secret;
    try {
      apiKey = Secret.of(
        decryptSecretToString(
          row.encryptedSecret,
          credentialProfileContext(row),
          this.keyring.keys,
        ),
      );
    } catch {
      throw new EngineRefusal("credential", "the office key cannot be decrypted");
    }
    if (row.authKind === "api_key") return { kind: "api_key", apiKey, attributedTo: "office" };
    if (!row.baseUrl) throw new EngineRefusal("credential", "the office key has no base URL");
    return {
      kind: "base_url_key",
      baseUrl: row.baseUrl,
      apiKey,
      attributedTo: "office",
      modelOverrides: overrides(row.modelOverridesJson),
    };
  }
}

function overrides(json: string | null): Record<string, string> | undefined {
  if (!json) return undefined;
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object") return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return undefined;
  }
}
