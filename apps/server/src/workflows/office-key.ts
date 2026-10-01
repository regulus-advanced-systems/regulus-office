/**
 * The model key a workflow henchman runs on (#155 owner decision, SPEC §8 rule
 * 3, D2): only an office-wide API key for a metered provider, added by an
 * admin (`credential_profiles` row with `userId` null and `authKind`
 * `api_key`). Never a human's profile, never a CLI (subscription) login and
 * never a base-URL plan key. Usage is attributed to `office`.
 *
 * The key is decrypted only here, right before the henchman's plan is built, and
 * lives only in that plan's `SecretEnv`.
 */
import { Secret } from "@regulus/agent-adapters";
import type { WorkflowProvider } from "@regulus/protocol";
import { and, asc, eq, isNull } from "drizzle-orm";
import { credentialProfileContext } from "../agents/manager/credentials.ts";
import type { Db } from "../db/index.ts";
import { credentialProfiles } from "../db/schema/index.ts";
import { decryptSecretToString, type MasterKeyring } from "../secrets/index.ts";
import { WorkflowRefusal } from "./github-app.ts";

function officeProfile(db: Db, provider: WorkflowProvider) {
  return db
    .select()
    .from(credentialProfiles)
    .where(
      and(
        isNull(credentialProfiles.userId),
        eq(credentialProfiles.provider, provider),
        eq(credentialProfiles.authKind, "api_key"),
      ),
    )
    .orderBy(asc(credentialProfiles.createdAt))
    .get();
}

/** Is there an office API key for the provider (no decryption)? */
export function hasOfficeKey(db: Db, provider: WorkflowProvider): boolean {
  return officeProfile(db, provider)?.encryptedSecret != null;
}

export function officeKey(
  db: Db,
  keyring: MasterKeyring | undefined,
  provider: WorkflowProvider,
): Secret {
  const row = officeProfile(db, provider);
  if (!row?.encryptedSecret) {
    throw new WorkflowRefusal(
      "office_key_required",
      `no office API key for ${provider}; an admin adds one under Connect providers`,
    );
  }
  if (!keyring) throw new WorkflowRefusal("master_key_missing", "OFFICE_MASTER_KEY is not set");
  try {
    return Secret.of(
      decryptSecretToString(row.encryptedSecret, credentialProfileContext(row), keyring.keys),
    );
  } catch {
    throw new WorkflowRefusal("office_key_unreadable", "the office API key cannot be decrypted");
  }
}
