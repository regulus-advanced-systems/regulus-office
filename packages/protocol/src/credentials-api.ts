/**
 * REST shapes for listing credential profiles (SPEC §5 `credential_profiles`,
 * §8). The list is read-only and secret-free: it names profiles by id so the
 * spawn dialog can pick one; the key itself never leaves the server.
 *
 * `owner: "office"` entries stand for the opt-in office-wide key of a metered
 * provider (SPEC §8 rule 3) and carry the id `office:<provider>` that
 * `agent.spawn` takes as `profileId`. The human's own CLI login is not listed:
 * it is the default (no `profileId`) and needs no row.
 */
import { z } from "zod";
import { Id } from "./common.ts";
import { CREDENTIAL_AUTH_KINDS, PROVIDER_IDS } from "./enums.ts";

export const CREDENTIAL_PROFILES_API_PATH = "/api/credential-profiles";

export const CREDENTIAL_PROFILE_OWNERS = ["me", "office"] as const;
export type CredentialProfileOwner = (typeof CREDENTIAL_PROFILE_OWNERS)[number];

/** Prefix of the profile id that selects the office key for a provider. */
export const OFFICE_PROFILE_ID_PREFIX = "office:";

export function officeProfileId(provider: (typeof PROVIDER_IDS)[number]): string {
  return `${OFFICE_PROFILE_ID_PREFIX}${provider}`;
}

export const CredentialProfileSummary = z
  .object({
    id: Id,
    label: z.string().max(200),
    provider: z.enum(PROVIDER_IDS),
    authKind: z.enum(CREDENTIAL_AUTH_KINDS),
    owner: z.enum(CREDENTIAL_PROFILE_OWNERS),
  })
  .strict();
export type CredentialProfileSummary = z.infer<typeof CredentialProfileSummary>;

export const CredentialProfileListResponse = z.object({
  profiles: z.array(CredentialProfileSummary),
});
export type CredentialProfileListResponse = z.infer<typeof CredentialProfileListResponse>;
