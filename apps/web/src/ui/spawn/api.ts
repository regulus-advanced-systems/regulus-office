/**
 * Browser client for `GET /api/credential-profiles` (read-only; ids and
 * labels, never a key). The spawn dialog lists the human's own profiles and
 * the office keys for the chosen provider.
 */
import {
  CREDENTIAL_PROFILES_API_PATH,
  CredentialProfileListResponse,
  type CredentialProfileSummary,
  type ProviderId,
} from "@regulus/protocol";

export type ProfilesResult =
  | { ok: true; profiles: CredentialProfileSummary[] }
  | { ok: false; code: string };

export interface CredentialProfilesApi {
  list(provider: ProviderId): Promise<ProfilesResult>;
}

export function createCredentialProfilesApi(
  options: { fetch?: typeof fetch; baseUrl?: string } = {},
): CredentialProfilesApi {
  return {
    async list(provider) {
      const doFetch = options.fetch ?? fetch;
      const url = `${options.baseUrl ?? ""}${CREDENTIAL_PROFILES_API_PATH}?provider=${encodeURIComponent(provider)}`;
      let res: Response;
      try {
        res = await doFetch(url, {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
      } catch {
        return { ok: false, code: "network_error" };
      }
      if (!res.ok) return { ok: false, code: `http_${res.status}` };
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { ok: false, code: "unexpected_response" };
      }
      const parsed = CredentialProfileListResponse.safeParse(body);
      if (!parsed.success) return { ok: false, code: "unexpected_response" };
      return { ok: true, profiles: parsed.data.profiles.filter((p) => p.provider === provider) };
    },
  };
}

/** Options for the credential select: own login first, then own profiles, then office keys. */
export function profileOptions(
  provider: string,
  providerLabel: string,
  profiles: readonly CredentialProfileSummary[],
): { value: string; label: string }[] {
  const kind = (p: CredentialProfileSummary) =>
    p.authKind === "cli_login" ? "login" : p.authKind === "api_key" ? "API key" : "plan key";
  return [
    { value: "", label: `Your ${providerLabel} login` },
    ...profiles
      .filter((p) => p.provider === provider && p.owner === "me")
      .map((p) => ({ value: p.id, label: `${p.label} (${kind(p)})` })),
    ...profiles
      .filter((p) => p.provider === provider && p.owner === "office")
      .map((p) => ({ value: p.id, label: `Office key: ${p.label}` })),
  ];
}
