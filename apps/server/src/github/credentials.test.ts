import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { RepoCredentialError, RepoCredentialVault } from "./credentials.ts";

const PAT = "github_pat_FAKE_token_for_tests_only_0123456789";
const ring = { current: 1, keys: Object.freeze({ 1: randomBytes(32) }) };

describe("RepoCredentialVault", () => {
  test("round-trips a PAT and never stores it in the clear", () => {
    const vault = new RepoCredentialVault(ring);
    const sealed = vault.seal("repo-1", PAT);
    expect(sealed).not.toContain(PAT);
    expect(Buffer.from(sealed, "base64url").toString()).not.toContain(PAT);
    expect(vault.open("repo-1", sealed)).toBe(PAT);
  });

  test("the ciphertext is bound to its repo id", () => {
    const vault = new RepoCredentialVault(ring);
    const sealed = vault.seal("repo-1", PAT);
    expect(() => vault.open("repo-2", sealed)).toThrow(RepoCredentialError);
    try {
      vault.open("repo-2", sealed);
    } catch (err) {
      expect((err as RepoCredentialError).code).toBe("undecryptable");
      expect(String((err as Error).stack)).not.toContain(PAT);
    }
  });

  test("without a master key nothing can be sealed or opened", () => {
    const vault = new RepoCredentialVault(undefined);
    expect(vault.available).toBe(false);
    expect(() => vault.seal("r", PAT)).toThrow("master_key_missing");
  });
});
