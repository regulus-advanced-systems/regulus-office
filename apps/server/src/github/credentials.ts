/**
 * Floor repo credentials (SPEC §8, D14 fallback): an admin-supplied
 * fine-grained PAT scoped to one repo, stored envelope-encrypted in
 * `floor_repos.encrypted_credential` with the AAD bound to the repo id, so a
 * ciphertext copied onto another row does not decrypt.
 *
 * This is a project credential for server-side git only (clone, and push /
 * PR in #31). It is never returned to clients, never logged, and never put
 * into an agent's environment.
 */
import {
  decryptSecretToString,
  encryptSecret,
  type MasterKeyring,
  type SecretContext,
} from "../secrets/index.ts";

export const REPO_CREDENTIAL_SECRET_NAME = "github_pat";

/** AAD context for a repo's PAT: `floor_repo:<repoId>|github_pat`. */
export function repoCredentialContext(repoId: string): SecretContext {
  return { userId: `floor_repo:${repoId}`, secretName: REPO_CREDENTIAL_SECRET_NAME };
}

export class RepoCredentialError extends Error {
  override name = "RepoCredentialError";
  constructor(readonly code: "master_key_missing" | "undecryptable") {
    super(code);
  }
}

export class RepoCredentialVault {
  readonly #keyring: MasterKeyring | undefined;

  constructor(keyring: MasterKeyring | undefined) {
    this.#keyring = keyring;
  }

  /** False when OFFICE_MASTER_KEY is not set: PATs cannot be stored. */
  get available(): boolean {
    return this.#keyring !== undefined;
  }

  seal(repoId: string, token: string): string {
    const ring = this.#keyring;
    if (!ring) throw new RepoCredentialError("master_key_missing");
    return encryptSecret(token, repoCredentialContext(repoId), ring.keys, ring.current);
  }

  /** Decrypt for one server-side git operation. Throws without echoing any material. */
  open(repoId: string, envelope: string): string {
    const ring = this.#keyring;
    if (!ring) throw new RepoCredentialError("master_key_missing");
    try {
      return decryptSecretToString(envelope, repoCredentialContext(repoId), ring.keys);
    } catch {
      throw new RepoCredentialError("undecryptable");
    }
  }
}
