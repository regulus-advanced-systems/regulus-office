/**
 * API-key and plan-key profiles (SPEC §5 `credential_profiles`, §8 rules 2
 * and 3, D2): create, re-verify (by re-entering the key), delete, list.
 *
 * - The key arrives in a request body, is wrapped in a `Secret` at once, is
 *   verified with one list-models call, then encrypted with exactly the
 *   context the AgentManager decrypts with at spawn time
 *   (`credentialProfileContext`: owner id or "office", `credential_profile:<id>`).
 * - The office never decrypts a stored key here: rule 2 allows that only at
 *   spawn. Re-verification therefore takes the key again and replaces the
 *   stored envelope.
 * - Responses, logs and audit metadata carry ids, providers, presets and
 *   outcomes, never the key, its envelope or a hint of it.
 * - Office keys (`userId` null) are created and deleted by owners/admins
 *   only, and only for metered presets; subscription plans stay personal.
 */
import { Secret } from "@regulus/agent-adapters";
import {
  CreateKeyProfileRequest,
  isOfficeKeyPreset,
  KEY_PRESETS,
  type KeyPresetId,
  type KeyProfileInfo,
  type KeyProfileWriteResponse,
  type KeyVerifyOutcome,
  presetForProfile,
} from "@regulus/protocol";
import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import type { z } from "zod";
import { credentialProfileContext } from "../agents/manager/credentials.ts";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import { AuthHttpError, forbidden } from "../auth/errors.ts";
import { isAdminOrOwner } from "../auth/roles.ts";
import type { Db } from "../db/index.ts";
import { credentialProfiles } from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";
import { encryptSecret, type MasterKeyring } from "../secrets/index.ts";
import type { CredentialActor } from "./http.ts";
import type { KeyVerifier } from "./verify.ts";

type ProfileRow = typeof credentialProfiles.$inferSelect;
type CreateInput = z.output<typeof CreateKeyProfileRequest>;

export interface KeyProfileServiceDeps {
  db: Db;
  keyring: MasterKeyring | undefined;
  verify: KeyVerifier;
  logger: Logger;
  now?: () => number;
}

const notFound = () => new AuthHttpError(404, "not_found");

export function profileInfo(row: ProfileRow): KeyProfileInfo {
  let baseUrlHost: string | null = null;
  if (row.baseUrl) {
    try {
      baseUrlHost = new URL(row.baseUrl).host;
    } catch {
      baseUrlHost = null;
    }
  }
  return {
    id: row.id,
    label: row.label,
    provider: row.provider,
    authKind: row.authKind,
    preset: presetForProfile(row),
    owner: row.userId === null ? "office" : "me",
    baseUrlHost,
    verifiedAt: row.verifiedAt ? row.verifiedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
  };
}

export class KeyProfileService {
  readonly #deps: KeyProfileServiceDeps;
  readonly #log: Logger;

  constructor(deps: KeyProfileServiceDeps) {
    this.#deps = deps;
    this.#log = deps.logger.child({ component: "credential-profiles" });
  }

  get #now(): number {
    return (this.#deps.now ?? Date.now)();
  }

  /** The actor's own key profiles, then every office key (all providers). */
  list(actor: CredentialActor): KeyProfileInfo[] {
    return this.#deps.db
      .select()
      .from(credentialProfiles)
      .where(
        and(
          or(eq(credentialProfiles.userId, actor.id), isNull(credentialProfiles.userId)),
          ne(credentialProfiles.authKind, "cli_login"),
        ),
      )
      .orderBy(asc(credentialProfiles.createdAt))
      .all()
      .map(profileInfo)
      .sort((a, b) => (a.owner === b.owner ? 0 : a.owner === "me" ? -1 : 1));
  }

  async create(actor: CredentialActor, input: CreateInput): Promise<KeyProfileWriteResponse> {
    const preset = KEY_PRESETS[input.preset];
    this.#assertMayConnect(actor);
    const office = input.owner === "office";
    if (office) {
      if (!isAdminOrOwner(actor.role)) throw forbidden("owner_or_admin_required");
      if (!isOfficeKeyPreset(preset.id)) throw new AuthHttpError(400, "office_key_not_metered");
    }
    const baseUrl = this.#baseUrlFor(preset.id, input.baseUrl);
    const keyring = this.#keyring();
    const key = Secret.of(input.apiKey);
    const verification = await this.#deps.verify(preset.id, key);
    const id = crypto.randomUUID();
    const userId = office ? null : actor.id;
    if (verification === "rejected") {
      this.#audit(actor, AUDIT_ACTIONS.credentialProfileVerify, null, {
        preset: preset.id,
        owner: input.owner,
        outcome: verification,
        stored: false,
      });
      throw new AuthHttpError(422, "key_rejected");
    }
    const encryptedSecret = encryptSecret(
      key.reveal(),
      credentialProfileContext({ id, userId }),
      keyring.keys,
      keyring.current,
    );
    const now = new Date(this.#now);
    const row = this.#deps.db.transaction((tx) => {
      tx.insert(credentialProfiles)
        .values({
          id,
          userId,
          provider: preset.provider,
          label: input.label,
          authKind: preset.authKind,
          encryptedSecret,
          baseUrl,
          modelOverridesJson: preset.modelOverrides ? JSON.stringify(preset.modelOverrides) : null,
          verifiedAt: verification === "ok" ? now : null,
          createdAt: now,
        })
        .run();
      this.#audit(
        actor,
        AUDIT_ACTIONS.credentialProfileCreate,
        id,
        {
          provider: preset.provider,
          preset: preset.id,
          owner: input.owner,
          verification,
        },
        tx,
      );
      return tx.select().from(credentialProfiles).where(eq(credentialProfiles.id, id)).get();
    });
    if (!row) throw new Error("credential profile insert failed");
    this.#log.info(
      { profileId: id, provider: preset.provider, preset: preset.id, office, verification },
      "credential profile created",
    );
    return { profile: profileInfo(row), verification };
  }

  /** Verify a re-entered key for a stored profile and, unless rejected, store it instead. */
  async reverify(
    actor: CredentialActor,
    profileId: string,
    apiKey: string,
  ): Promise<KeyProfileWriteResponse> {
    const row = this.#writable(actor, profileId);
    const preset: KeyPresetId | null = presetForProfile(row);
    const keyring = this.#keyring();
    const key = Secret.of(apiKey);
    const verification: KeyVerifyOutcome = preset
      ? await this.#deps.verify(preset, key)
      : "unsupported";
    const meta = { provider: row.provider, preset, outcome: verification };
    if (verification === "rejected") {
      this.#audit(actor, AUDIT_ACTIONS.credentialProfileVerify, row.id, { ...meta, stored: false });
      throw new AuthHttpError(422, "key_rejected");
    }
    const encryptedSecret = encryptSecret(
      key.reveal(),
      credentialProfileContext(row),
      keyring.keys,
      keyring.current,
    );
    const verifiedAt = verification === "ok" ? new Date(this.#now) : null;
    const updated = this.#deps.db.transaction((tx) => {
      tx.update(credentialProfiles)
        .set({ encryptedSecret, verifiedAt })
        .where(eq(credentialProfiles.id, row.id))
        .run();
      this.#audit(
        actor,
        AUDIT_ACTIONS.credentialProfileVerify,
        row.id,
        { ...meta, stored: true },
        tx,
      );
      return tx.select().from(credentialProfiles).where(eq(credentialProfiles.id, row.id)).get();
    });
    if (!updated) throw notFound();
    this.#log.info({ profileId: row.id, provider: row.provider, verification }, "key re-verified");
    return { profile: profileInfo(updated), verification };
  }

  delete(actor: CredentialActor, profileId: string): void {
    const row = this.#writable(actor, profileId);
    this.#deps.db.transaction((tx) => {
      tx.delete(credentialProfiles).where(eq(credentialProfiles.id, row.id)).run();
      this.#audit(
        actor,
        AUDIT_ACTIONS.credentialProfileDelete,
        row.id,
        { provider: row.provider, owner: row.userId === null ? "office" : "me" },
        tx,
      );
    });
    this.#log.info({ profileId: row.id, provider: row.provider }, "credential profile deleted");
  }

  /** Viewers only watch (SPEC §8 rule 4); they never run agents, so they connect nothing. */
  #assertMayConnect(actor: CredentialActor): void {
    if (actor.role === "viewer") throw forbidden("viewers_cannot_connect");
  }

  /** Own key profile, or an office key for owners/admins; anything else is "not found". */
  #writable(actor: CredentialActor, profileId: string): ProfileRow {
    this.#assertMayConnect(actor);
    const row = this.#deps.db
      .select()
      .from(credentialProfiles)
      .where(eq(credentialProfiles.id, profileId))
      .get();
    if (!row || row.authKind === "cli_login") throw notFound();
    if (row.userId === null) {
      if (!isAdminOrOwner(actor.role)) throw notFound();
    } else if (row.userId !== actor.id) {
      throw notFound();
    }
    return row;
  }

  #baseUrlFor(presetId: KeyPresetId, requested: string | undefined): string | null {
    const preset = KEY_PRESETS[presetId];
    if (preset.authKind === "api_key") {
      if (requested) throw new AuthHttpError(400, "base_url_not_allowed");
      return null;
    }
    if (preset.baseUrl) {
      if (requested && requested !== preset.baseUrl) {
        throw new AuthHttpError(400, "base_url_not_allowed");
      }
      return preset.baseUrl;
    }
    if (!requested) throw new AuthHttpError(400, "base_url_required");
    return requested;
  }

  #keyring(): MasterKeyring {
    if (!this.#deps.keyring) throw new AuthHttpError(400, "master_key_required");
    return this.#deps.keyring;
  }

  #audit(
    actor: CredentialActor,
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    targetId: string | null,
    meta: Record<string, unknown>,
    tx: Parameters<typeof writeAudit>[0] = this.#deps.db,
  ): void {
    writeAudit(tx, { userId: actor.id, action, targetKind: "credential_profile", targetId, meta });
  }
}
