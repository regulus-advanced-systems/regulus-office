/**
 * What the spawn dialog reads about credentials: `GET /api/credential-profiles`
 * (read-only; ids and labels, never a key) for the human's own profiles and
 * the office keys of the chosen provider, and `GET /api/provider-logins`
 * (#32) for whether their CLI login in the runner is connected.
 */
import {
  CREDENTIAL_PROFILES_API_PATH,
  CredentialProfileListResponse,
  type CredentialProfileSummary,
  PROVIDER_LOGINS_API_PATH,
  type ProviderId,
  ProviderLoginStatusResponse,
} from "@regulus/protocol";

export type ProfilesResult =
  | { ok: true; profiles: CredentialProfileSummary[] }
  | { ok: false; code: string };

/** CLI login per provider: true / false, null when it could not be checked. */
export type LoginStatus = Partial<Record<ProviderId, boolean | null>>;

export interface CredentialProfilesApi {
  list(provider: ProviderId): Promise<ProfilesResult>;
  /** The human's CLI logins in their runner (one request for every provider). */
  loginStatus(): Promise<LoginStatus>;
}

export function createCredentialProfilesApi(
  options: { fetch?: typeof fetch; baseUrl?: string } = {},
): CredentialProfilesApi {
  const getJson = async (url: string): Promise<unknown> => {
    const doFetch = options.fetch ?? fetch;
    try {
      const res = await doFetch(url, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  return {
    async loginStatus() {
      const parsed = ProviderLoginStatusResponse.safeParse(
        await getJson(`${options.baseUrl ?? ""}${PROVIDER_LOGINS_API_PATH}`),
      );
      if (!parsed.success) return {};
      return Object.fromEntries(parsed.data.providers.map((p) => [p.provider, p.connected]));
    },
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
