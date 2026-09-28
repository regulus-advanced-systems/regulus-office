/**
 * Which credential a spawn uses (SPEC §8, D2) and, for key profiles, the
 * decrypted key as a `Secret`, produced only here and only at spawn time.
 *
 * - No profile: the human's own CLI login in their runner HOME (`cli_login`);
 *   stored as `login:<provider>`.
 * - `office:<provider>`: the opt-in office-wide key for a metered provider
 *   (a `credential_profiles` row with `userId` null), attributed to `office`.
 * - A profile id: must belong to the spawning human and match the provider.
 *
 * Key envelopes are bound (AAD) to `{ userId: <owner id or "office">,
 * secretName: "credential_profile:<profileId>" }`; the credential profiles
 * panel (#32) encrypts with {@link credentialProfileContext}.
 */
import { Secret, type SpawnCredential } from "@regulus/agent-adapters";
import type { ProviderId } from "@regulus/protocol";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { credentialProfiles } from "../../db/schema/index.ts";
import {
  decryptSecretToString,
  type MasterKeyring,
  type SecretContext,
} from "../../secrets/index.ts";
import { AgentManagerError } from "./errors.ts";

export const OFFICE_PROFILE_PREFIX = "office:";
export const LOGIN_PROFILE_PREFIX = "login:";

export function credentialProfileContext(profile: {
  id: string;
  userId: string | null;
}): SecretContext {
  return { userId: profile.userId ?? "office", secretName: `credential_profile:${profile.id}` };
}

export interface ResolvedCredential {
  /** Value for `agents.profileId`. */
  profileId: string;
  credential: SpawnCredential;
}

type ProfileRow = typeof credentialProfiles.$inferSelect;

export class CredentialResolver {
  constructor(
    private readonly db: Db,
    private readonly keyring: MasterKeyring | undefined,
  ) {}

  /** Check the choice without decrypting anything (used before a spawn is persisted). */
  check(userId: string, provider: ProviderId, profileId: string | undefined): string {
    return this.#pick(userId, provider, profileId).profileId;
  }

  /** Resolve and, for key profiles, decrypt. Call only right before `buildSpawn`. */
  resolve(userId: string, provider: ProviderId, profileId: string | undefined): ResolvedCredential {
    const picked = this.#pick(userId, provider, profileId);
    if (!picked.row || picked.row.authKind === "cli_login") {
      return { profileId: picked.profileId, credential: { kind: "cli_login" } };
    }
    const row = picked.row;
    const apiKey = this.#decrypt(row);
    const attributedTo = row.userId === null ? "office" : "user";
    if (row.authKind === "api_key") {
      return { profileId: picked.profileId, credential: { kind: "api_key", apiKey, attributedTo } };
    }
    if (!row.baseUrl) throw new AgentManagerError("bad_request", "profile has no base URL");
    return {
      profileId: picked.profileId,
      credential: {
        kind: "base_url_key",
        baseUrl: row.baseUrl,
        apiKey,
        attributedTo,
        modelOverrides: parseOverrides(row.modelOverridesJson),
      },
    };
  }

  #pick(
    userId: string,
    provider: ProviderId,
    profileId: string | undefined,
  ): { profileId: string; row?: ProfileRow } {
    if (profileId === undefined || profileId === `${LOGIN_PROFILE_PREFIX}${provider}`) {
      return { profileId: `${LOGIN_PROFILE_PREFIX}${provider}` };
    }
    if (profileId.startsWith(OFFICE_PROFILE_PREFIX)) {
      if (profileId !== `${OFFICE_PROFILE_PREFIX}${provider}`) {
        throw new AgentManagerError("bad_request", "office key is for another provider");
      }
      const row = this.db
        .select()
        .from(credentialProfiles)
        .where(
          and(
            isNull(credentialProfiles.userId),
            eq(credentialProfiles.provider, provider),
            inArray(credentialProfiles.authKind, ["api_key", "base_url_key"]),
          ),
        )
        .orderBy(asc(credentialProfiles.createdAt))
        .get();
      if (!row) throw new AgentManagerError("bad_request", "no office key for this provider");
      return { profileId, row };
    }
    const row = this.db
      .select()
      .from(credentialProfiles)
      .where(eq(credentialProfiles.id, profileId))
      .get();
    // Another human's profile is indistinguishable from a missing one (SPEC §8 rule 4).
    if (!row || row.userId !== userId) {
      throw new AgentManagerError("bad_request", "unknown credential profile");
    }
    if (row.provider !== provider) {
      throw new AgentManagerError("bad_request", "credential profile is for another provider");
    }
    return { profileId, row };
  }

  #decrypt(row: ProfileRow): Secret {
    if (!row.encryptedSecret) throw new AgentManagerError("bad_request", "profile has no key");
    if (!this.keyring) {
      throw new AgentManagerError("unavailable", "OFFICE_MASTER_KEY is not set; keys unavailable");
    }
    try {
      return Secret.of(
        decryptSecretToString(
          row.encryptedSecret,
          credentialProfileContext(row),
          this.keyring.keys,
        ),
      );
    } catch {
      throw new AgentManagerError("unavailable", "credential profile key cannot be decrypted");
    }
  }
}

function parseOverrides(json: string | null): Record<string, string> | undefined {
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
