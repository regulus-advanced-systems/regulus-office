/**
 * The GitHub App manifest flow (D14; #141):
 * https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 *
 * 1. An owner/admin asks for a manifest; the office mints a one-time `state`
 *    bound to that user and returns the github.com form action and manifest.
 * 2. The browser POSTs the manifest to GitHub, where the owner names and
 *    creates the app.
 * 3. GitHub redirects to the callback with `code` and `state`. The office
 *    accepts the state once, only for the same signed-in user within an hour
 *    (GitHub's own limit for the code), and converts the code into the app id,
 *    private key and webhook secret (`POST /app-manifests/{code}/conversions`).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  GITHUB_APP_SETUP_PATH,
  GITHUB_MANIFEST_CALLBACK_PATH,
  GITHUB_WEBHOOK_PATH,
} from "@regulus/protocol";
import type { GitHubCaller } from "./api.ts";

export const MANIFEST_STATE_TTL_MS = 60 * 60_000;
const MAX_PENDING_STATES = 50;

/**
 * Repo permissions the office needs: git, PRs, boards (#141, #35), and for
 * workflows (#155) PR reviews and comments (Pull requests, Issues: write) and
 * a neutral check run per review (Checks: write). Metadata read also covers
 * the commenter permission lookup for `/office` commands. An App created
 * before #155 has Checks: read; the owner raises it once (README).
 */
export const APP_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
  metadata: "read",
  issues: "write",
  checks: "write",
} as const;

/**
 * Webhook events (#35): the boards (issues, PRs, reviews, checks) plus what
 * #155 workflows trigger on (pushes, comments). Only subscribed when the
 * office has a public webhook URL. `installation` events reach every app
 * without a subscription.
 * https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
 */
export const APP_EVENTS = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "check_suite",
  "check_run",
  "push",
] as const;

/** Hosts GitHub cannot deliver to: loopback, private ranges, `.local` / `.internal` names. */
const LOCAL_HOST_RE =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i;

/** GitHub only delivers webhooks to public https URLs; localhost offices get none. */
export function webhookUrlFor(publicUrl: string): string | null {
  try {
    const url = new URL(publicUrl);
    if (url.protocol !== "https:" || LOCAL_HOST_RE.test(url.hostname)) return null;
    return new URL(GITHUB_WEBHOOK_PATH, url).toString();
  } catch {
    return null;
  }
}

export function buildManifest(publicUrl: string): Record<string, unknown> {
  const base = publicUrl.replace(/\/+$/, "");
  const hook = webhookUrlFor(publicUrl);
  let host = "office";
  try {
    host = new URL(publicUrl).host;
  } catch {
    // keep the default
  }
  return {
    name: `Regulus Office (${host})`.slice(0, 34),
    url: base,
    description:
      "Clones operation repos, pushes henchman branches and opens pull requests for Regulus Office.",
    redirect_url: `${base}${GITHUB_MANIFEST_CALLBACK_PATH}`,
    setup_url: `${base}${GITHUB_APP_SETUP_PATH}`,
    setup_on_update: true,
    public: false,
    default_permissions: APP_PERMISSIONS,
    // Deliveries go to POST /api/github/webhook, signed with the secret the conversion returns.
    ...(hook
      ? { hook_attributes: { url: hook, active: true }, default_events: [...APP_EVENTS] }
      : {}),
  };
}

/** Where the browser posts the manifest: the org's app settings, or the user's own. */
export function manifestAction(webBase: string, state: string, org?: string): string {
  const base = webBase.replace(/\/+$/, "");
  const path = org
    ? `/organizations/${encodeURIComponent(org)}/settings/apps/new`
    : "/settings/apps/new";
  return `${base}${path}?state=${encodeURIComponent(state)}`;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** One-time CSRF states for the manifest callback, in memory, bound to a user. */
export class ManifestStates {
  readonly #pending = new Map<string, { userId: string; expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  issue(userId: string): string {
    this.#sweep();
    while (this.#pending.size >= MAX_PENDING_STATES) {
      const oldest = this.#pending.keys().next().value;
      if (oldest === undefined) break;
      this.#pending.delete(oldest);
    }
    const state = randomBytes(32).toString("base64url");
    // Keyed by a hash so the map never holds the raw value it compares against.
    this.#pending.set(digest(state).toString("hex"), {
      userId,
      expiresAt: this.#now() + MANIFEST_STATE_TTL_MS,
    });
    return state;
  }

  /** Accept `state` once for `userId`; false when unknown, expired, reused or someone else's. */
  consume(state: string, userId: string): boolean {
    this.#sweep();
    const key = digest(state).toString("hex");
    const entry = this.#pending.get(key);
    if (!entry) return false;
    const same =
      entry.userId.length === userId.length &&
      timingSafeEqual(Buffer.from(entry.userId), Buffer.from(userId));
    if (!same) return false;
    this.#pending.delete(key);
    return true;
  }

  #sweep(): void {
    const now = this.#now();
    for (const [key, entry] of this.#pending) {
      if (entry.expiresAt <= now) this.#pending.delete(key);
    }
  }
}

export interface ConvertedApp {
  appId: number;
  clientId: string | null;
  slug: string | null;
  name: string | null;
  htmlUrl: string | null;
  owner: string | null;
  privateKey: string;
  webhookSecret: string | null;
}

/** `POST /app-manifests/{code}/conversions` (no auth; the code is single-use and short-lived). */
export async function convertManifest(api: GitHubCaller, code: string): Promise<ConvertedApp> {
  const raw = await api.json<Record<string, unknown>>({
    method: "POST",
    path: `/app-manifests/${encodeURIComponent(code)}/conversions`,
  });
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  const owner = raw.owner as { login?: unknown } | null | undefined;
  if (typeof raw.id !== "number" || typeof raw.pem !== "string") {
    throw new Error("GitHub returned an unexpected app manifest conversion payload");
  }
  return {
    appId: raw.id,
    clientId: str(raw.client_id),
    slug: str(raw.slug),
    name: str(raw.name),
    htmlUrl: str(raw.html_url),
    owner: str(owner?.login),
    privateKey: raw.pem,
    webhookSecret: str(raw.webhook_secret),
  };
}
