/**
 * Loads what the spawn dialog knows about each provider's credentials: the
 * human's CLI logins (`GET /api/provider-logins`, one request) and their own
 * profiles plus office keys (`GET /api/credential-profiles?provider=`).
 */
import { useEffect, useState } from "react";
import type { CredentialProfilesApi } from "./api.ts";
import type { AccessByProvider } from "./credentials.ts";
import { PROVIDER_PRESETS } from "./models.ts";

export interface ProviderAccessState {
  access: AccessByProvider;
  /** Logins and profiles have all answered. */
  loaded: boolean;
}

export function useProviderAccess(api: CredentialProfilesApi): ProviderAccessState {
  const [state, setState] = useState<ProviderAccessState>(() => ({
    access: Object.fromEntries(
      PROVIDER_PRESETS.map((p) => [p.id, { login: undefined, profiles: [] }]),
    ),
    loaded: false,
  }));
  useEffect(() => {
    let live = true;
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    void Promise.all([api.loginStatus(), Promise.all(ids.map((id) => api.list(id)))]).then(
      ([logins, lists]) => {
        if (!live) return;
        const access: AccessByProvider = {};
        ids.forEach((id, i) => {
          const list = lists[i];
          access[id] = {
            login: logins[id] ?? null,
            profiles: list?.ok ? list.profiles : [],
            ...(list && !list.ok ? { profilesError: true } : {}),
          };
        });
        setState({ access, loaded: true });
      },
    );
    return () => {
      live = false;
    };
  }, [api]);
  return state;
}
