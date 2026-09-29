/**
 * Which credential a spawn uses when the human does not pick one (SPEC §8,
 * D2): their own connected CLI login, else one of their own key profiles,
 * else the office key. Only profile ids are handled here, never a secret;
 * "" means "my own CLI login in my runner" (no `profileId` on the wire).
 */
import type { CredentialProfileSummary, ProviderId } from "@regulus/protocol";

export interface ProviderAccess {
  /** CLI login: true / false, null = unknown, undefined = still checking. */
  login: boolean | null | undefined;
  /** Own profiles and office keys for this provider (ids and labels only). */
  profiles: readonly CredentialProfileSummary[];
  /** The profile list could not be loaded. */
  profilesError?: boolean;
}

export type AccessByProvider = Partial<Record<ProviderId, ProviderAccess>>;

export const OWN_LOGIN = "";

/**
 * A provider can be spawned with unless its login is known to be missing and
 * there is no key to fall back on. Unknown (the check failed or is still
 * running) counts as usable; the server has the last word.
 */
export function providerUsable(access: ProviderAccess | undefined): boolean {
  if (!access) return true;
  return access.login !== false || access.profiles.length > 0;
}

/** The credential used when the human leaves the choice alone. */
export function defaultCredential(access: ProviderAccess | undefined): string {
  if (!access || access.login === true) return OWN_LOGIN;
  const own = access.profiles.find((p) => p.owner === "me");
  if (own) return own.id;
  const office = access.profiles.find((p) => p.owner === "office");
  if (office) return office.id;
  return OWN_LOGIN;
}

export interface CredentialOption {
  value: string;
  label: string;
}

/** Options for the credential select: own login first, then own profiles, then office keys. */
export function credentialOptions(
  providerLabel: string,
  access: ProviderAccess | undefined,
): CredentialOption[] {
  const profiles = access?.profiles ?? [];
  const kind = (p: CredentialProfileSummary) =>
    p.authKind === "cli_login" ? "login" : p.authKind === "api_key" ? "API key" : "plan key";
  const loginNote =
    access?.login === false ? " (not connected)" : access?.login === true ? " (connected)" : "";
  return [
    { value: OWN_LOGIN, label: `Your ${providerLabel} login${loginNote}` },
    ...profiles
      .filter((p) => p.owner === "me")
      .map((p) => ({ value: p.id, label: `${p.label} (${kind(p)})` })),
    ...profiles
      .filter((p) => p.owner === "office")
      .map((p) => ({ value: p.id, label: `Office key: ${p.label}` })),
  ];
}
