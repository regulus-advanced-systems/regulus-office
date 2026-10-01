/**
 * Connect a GitHub App the owner already has (#224; SPEC §8, D14), instead of
 * creating a second one with the manifest flow.
 *
 * Before anything is stored the office parses the private key, signs an app
 * JWT and asks GitHub `GET /app` with it: a wrong id/key pair fails here with
 * a plain message. The app's permissions and events are then compared with
 * what the office's manifest asks for ({@link APP_PERMISSIONS},
 * {@link APP_EVENTS}); gaps are reported as a warning, not a refusal, so the
 * owner can fix them on GitHub afterwards.
 *
 * The key and webhook secret only travel to the connection store, which
 * encrypts them exactly as for a manifest-created app; error text never
 * carries them.
 */
import {
  GITHUB_APP_SETUP_PATH,
  GITHUB_PERMISSION_LEVELS,
  type GitHubAppMissingPermission,
  type GitHubAppRequirements,
  type GitHubPermissionLevel,
} from "@regulus/protocol";
import type { GitHubCaller } from "./api.ts";
import { type AppCredentials, parseAppKey } from "./app-auth.ts";
import { APP_EVENTS, APP_PERMISSIONS, type ConvertedApp, webhookUrlFor } from "./manifest.ts";
import { GitHubApiError } from "./pulls.ts";

/** What to set on an existing app for this office (shown in Settings). */
export function appRequirements(publicUrl: string): GitHubAppRequirements {
  const base = publicUrl.replace(/\/+$/, "");
  return {
    webhookUrl: webhookUrlFor(publicUrl),
    setupUrl: `${base}${GITHUB_APP_SETUP_PATH}`,
    permissions: { ...APP_PERMISSIONS },
    events: [...APP_EVENTS],
  };
}

const rank = (level: unknown): number =>
  typeof level === "string" ? GITHUB_PERMISSION_LEVELS.indexOf(level as GitHubPermissionLevel) : -1;

/** Permissions the app lacks or has at a lower level than the office needs. */
export function missingPermissions(granted: Record<string, unknown>): GitHubAppMissingPermission[] {
  const out: GitHubAppMissingPermission[] = [];
  for (const [name, required] of Object.entries(APP_PERMISSIONS)) {
    const have = granted[name];
    if (rank(have) >= rank(required)) continue;
    out.push({ name, required, granted: typeof have === "string" ? have.slice(0, 20) : null });
  }
  return out;
}

/** Events the office subscribes to that the app does not. */
export function missingEvents(subscribed: readonly unknown[]): string[] {
  const have = new Set(subscribed.filter((e): e is string => typeof e === "string"));
  return APP_EVENTS.filter((e) => !have.has(e));
}

/** A plain reason the app could not be verified; never carries key material. */
export class ExistingAppError extends Error {
  override name = "ExistingAppError";
  constructor(
    readonly code: "invalid_private_key" | "github_rejected" | "app_id_mismatch",
    readonly detail: string,
  ) {
    super(detail);
  }
}

export interface ExistingAppInput {
  appId: number;
  privateKey: string;
  webhookSecret: string | null;
  clientId: string | null;
}

export interface VerifiedApp {
  app: ConvertedApp;
  missingPermissions: GitHubAppMissingPermission[];
  missingEvents: string[];
}

interface RawApp {
  id?: unknown;
  client_id?: unknown;
  slug?: unknown;
  name?: unknown;
  html_url?: unknown;
  owner?: { login?: unknown } | null;
  permissions?: unknown;
  events?: unknown;
}

const str = (v: unknown, max: number) =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;

/**
 * Verify the app with GitHub and return what to store. `checkEvents` is false
 * when the office has no public webhook URL (no deliveries; boards poll).
 */
export async function verifyExistingApp(
  api: GitHubCaller,
  input: ExistingAppInput,
  opts: { sign: (app: AppCredentials) => string; checkEvents: boolean },
): Promise<VerifiedApp> {
  const privateKey = input.privateKey.replace(/\\n/g, "\n").trim();
  try {
    parseAppKey(privateKey);
  } catch {
    throw new ExistingAppError(
      "invalid_private_key",
      "That is not a GitHub App private key (an RSA .pem file).",
    );
  }
  const jwt = opts.sign({ appId: input.appId, clientId: input.clientId, privateKey });
  let raw: RawApp;
  try {
    raw = await api.json<RawApp>({ path: "/app", bearer: jwt });
  } catch (err) {
    if (err instanceof GitHubApiError && (err.status === 401 || err.status === 404)) {
      throw new ExistingAppError(
        "github_rejected",
        input.clientId
          ? "GitHub did not accept the key for that app ID and client ID. Check both, and that the key belongs to this app."
          : "GitHub did not accept the key for that app ID. Check the app ID and that the key belongs to this app.",
      );
    }
    const detail = err instanceof GitHubApiError ? `${err.detail} (${err.status})` : "unreachable";
    throw new ExistingAppError("github_rejected", `GitHub could not check the app: ${detail}`);
  }
  if (raw.id !== input.appId) {
    throw new ExistingAppError(
      "app_id_mismatch",
      `That key belongs to app ${typeof raw.id === "number" ? raw.id : "?"}, not app ${input.appId}.`,
    );
  }
  const permissions =
    raw.permissions && typeof raw.permissions === "object"
      ? (raw.permissions as Record<string, unknown>)
      : {};
  return {
    app: {
      appId: input.appId,
      clientId: str(raw.client_id, 100) ?? input.clientId,
      slug: str(raw.slug, 100),
      name: str(raw.name, 100),
      htmlUrl: str(raw.html_url, 300),
      owner: str(raw.owner?.login, 100),
      privateKey,
      webhookSecret: input.webhookSecret,
    },
    missingPermissions: missingPermissions(permissions),
    missingEvents: opts.checkEvents
      ? missingEvents(Array.isArray(raw.events) ? raw.events : [])
      : [],
  };
}
