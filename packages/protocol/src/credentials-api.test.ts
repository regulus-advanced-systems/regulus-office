import { describe, expect, test } from "bun:test";
import {
  CredentialProfileListResponse,
  CredentialProfileSummary,
  officeProfileId,
} from "./credentials-api.ts";

describe("credential profile list shapes", () => {
  const profile = {
    id: "p1",
    label: "My Anthropic key",
    provider: "claude-code",
    authKind: "api_key",
    owner: "me",
  } as const;

  test("a summary has no room for secrets", () => {
    expect(CredentialProfileSummary.parse(profile)).toEqual(profile);
    expect(
      CredentialProfileSummary.safeParse({ ...profile, encryptedSecret: "v1.x" }).success,
    ).toBe(false);
    expect(CredentialProfileSummary.safeParse({ ...profile, apiKey: "sk-x" }).success).toBe(false);
  });

  test("owner is me or office; office ids name the provider", () => {
    expect(CredentialProfileSummary.safeParse({ ...profile, owner: "u2" }).success).toBe(false);
    expect(officeProfileId("codex")).toBe("office:codex");
    expect(CredentialProfileListResponse.parse({ profiles: [profile] }).profiles).toHaveLength(1);
  });
});
