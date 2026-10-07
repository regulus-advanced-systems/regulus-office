/**
 * What an office agent can run on, and what one does run on (#280; SPEC §8,
 * D2). Reads ids, names and kinds of key profiles only: never the encrypted
 * key, and the base URL only to tell which preset a profile is.
 *
 * The rules themselves are engines/credentials.ts; this lists what those
 * rules would accept, so the form offers nothing the server then refuses:
 * - a personal agent: its owner's login, their own keys, and the office key
 *   they may use for henchmen (`office:<provider>`, the oldest office key);
 * - a shared agent: each office-wide key by its own id, for owners and admins.
 */
import {
  CLI_SESSION_PROVIDERS,
  type OfficeAgentRunsOn,
  type OfficeAgentRunsOnResponse,
  officeProfileId,
  presetForProfile,
  type RunsOnChoice,
  sessionEngineRuns,
} from "@regulus/protocol";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { OFFICE_PROFILE_PREFIX } from "../agents/manager/credentials.ts";
import type { Db } from "../db/index.ts";
import { credentialProfiles } from "../db/schema/index.ts";
import { isOfficeManager, type OperationActor } from "../operations/access.ts";

const columns = {
  id: credentialProfiles.id,
  userId: credentialProfiles.userId,
  label: credentialProfiles.label,
  provider: credentialProfiles.provider,
  authKind: credentialProfiles.authKind,
  baseUrl: credentialProfiles.baseUrl,
  createdAt: credentialProfiles.createdAt,
};
type ProfileRow = {
  id: string;
  userId: string | null;
  label: string;
  provider: (typeof CLI_SESSION_PROVIDERS)[number] | RunsOnChoice["provider"];
  authKind: string;
  baseUrl: string | null;
};

const PROVIDERS = [...CLI_SESSION_PROVIDERS];

/** Key profiles of one owner (`null`: the office) that the session engine can use, oldest first. */
function keys(db: Db, userId: string | null): ProfileRow[] {
  return db
    .select(columns)
    .from(credentialProfiles)
    .where(
      and(
        userId === null ? isNull(credentialProfiles.userId) : eq(credentialProfiles.userId, userId),
        inArray(credentialProfiles.provider, PROVIDERS),
        ne(credentialProfiles.authKind, "cli_login"),
      ),
    )
    .orderBy(asc(credentialProfiles.createdAt))
    .all();
}

function choice(row: ProfileRow, profileId: string): RunsOnChoice | null {
  const preset = presetForProfile(row);
  if (!preset || !sessionEngineRuns(preset)) return null;
  return {
    profileId,
    kind: preset,
    label: row.label,
    owner: row.userId === null ? "office" : "me",
    provider: row.provider,
  };
}

const present = <T>(v: T | null): v is T => v !== null;

export function runsOnChoices(db: Db, actor: OperationActor): OfficeAgentRunsOnResponse {
  const office = keys(db, null);
  // What `office:<provider>` resolves to: the oldest office key of each provider.
  const officeDefault = PROVIDERS.map((provider) => {
    const row = office.find((r) => r.provider === provider);
    return row ? choice(row, officeProfileId(provider)) : null;
  }).filter(present);
  return {
    personal: [
      ...PROVIDERS.map(
        (provider): RunsOnChoice => ({ kind: "login", label: "", owner: "me", provider }),
      ),
      ...keys(db, actor.id)
        .map((row) => choice(row, row.id))
        .filter(present),
      ...officeDefault,
    ],
    shared: isOfficeManager(actor.role)
      ? office.map((row) => choice(row, row.id)).filter(present)
      : [],
  };
}

/** What this agent runs on. `withLabel`: for those who may configure it. */
export function runsOnOf(
  db: Db,
  agent: { provider: RunsOnChoice["provider"]; profileId: string | null },
  withLabel: boolean,
): OfficeAgentRunsOn {
  if (!agent.profileId) return { kind: "login", officeKey: false };
  const row = agent.profileId.startsWith(OFFICE_PROFILE_PREFIX)
    ? keys(db, null).find((r) => r.provider === agent.provider)
    : db
        .select(columns)
        .from(credentialProfiles)
        .where(eq(credentialProfiles.id, agent.profileId))
        .get();
  const preset = row ? presetForProfile(row) : null;
  if (!row || !preset) return { kind: "unknown", officeKey: false };
  return {
    kind: preset,
    officeKey: row.userId === null,
    ...(withLabel ? { label: row.label } : {}),
  };
}
