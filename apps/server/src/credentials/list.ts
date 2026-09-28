/**
 * `GET /api/credential-profiles?provider=<id>`: read-only list of the
 * credential profiles a human may spawn with (spawn dialog, #29; SPEC §8,
 * D2): their own profiles plus one `office:<provider>` entry per provider
 * that has an office-wide key. Only id, label, provider and auth kind are
 * selected; the encrypted secret and base URL are never read here.
 *
 * The office entry mirrors `CredentialResolver` (agents/manager/credentials.ts):
 * `office:<provider>` resolves to the oldest office key of that provider, so
 * its label is shown.
 */
import {
  CREDENTIAL_PROFILES_API_PATH,
  type CredentialProfileSummary,
  isProviderId,
  officeProfileId,
  type ProviderId,
} from "@regulus/protocol";
import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, unauthorized } from "../auth/errors.ts";
import type { Db } from "../db/index.ts";
import { credentialProfiles } from "../db/schema/index.ts";
import { json, type Router } from "../http/router.ts";

const OFFICE_KEY_KINDS = ["api_key", "base_url_key"] as const;

const summaryColumns = {
  id: credentialProfiles.id,
  label: credentialProfiles.label,
  provider: credentialProfiles.provider,
  authKind: credentialProfiles.authKind,
};

export function listCredentialProfiles(
  db: Db,
  userId: string,
  provider?: ProviderId,
): CredentialProfileSummary[] {
  const byProvider = (extra: SQL | undefined): SQL | undefined =>
    provider ? and(extra, eq(credentialProfiles.provider, provider)) : extra;

  const own = db
    .select(summaryColumns)
    .from(credentialProfiles)
    .where(byProvider(eq(credentialProfiles.userId, userId)))
    .orderBy(asc(credentialProfiles.provider), asc(credentialProfiles.createdAt))
    .all()
    .map((row): CredentialProfileSummary => ({ ...row, owner: "me" }));

  const officeRows = db
    .select(summaryColumns)
    .from(credentialProfiles)
    .where(
      byProvider(
        and(
          isNull(credentialProfiles.userId),
          inArray(credentialProfiles.authKind, [...OFFICE_KEY_KINDS]),
        ),
      ),
    )
    .orderBy(asc(credentialProfiles.createdAt))
    .all();
  const office = new Map<ProviderId, CredentialProfileSummary>();
  for (const row of officeRows) {
    if (office.has(row.provider)) continue;
    office.set(row.provider, {
      id: officeProfileId(row.provider),
      label: row.label,
      provider: row.provider,
      authKind: row.authKind,
      owner: "office",
    });
  }
  return [...own, ...office.values()];
}

/** Session-cookie auth; ids and labels only, never a key, an envelope or a base URL. */
export function mountCredentialProfileRoutes(
  router: Router,
  deps: { auth: Pick<OfficeAuth, "getSessionFromRequest">; db: Db },
): void {
  router.get(CREDENTIAL_PROFILES_API_PATH, async ({ request, url }) => {
    try {
      const user = await deps.auth.getSessionFromRequest(request);
      if (!user) throw unauthorized();
      const provider = url.searchParams.get("provider");
      if (provider !== null && provider !== "" && !isProviderId(provider)) {
        throw new AuthHttpError(400, "invalid_provider");
      }
      const profiles = listCredentialProfiles(deps.db, user.id, provider || undefined);
      return json({ profiles }, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof AuthHttpError) return err.toResponse();
      throw err;
    }
  });
}
