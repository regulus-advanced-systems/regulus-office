/**
 * GitHub App authentication (SPEC §4.2, D14; #141).
 *
 * - The app JWT: RS256, `iat` 60 s in the past for clock drift, `exp` under
 *   GitHub's 10-minute cap, `iss` the client id (or the app id when only that
 *   is known). https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 * - Installation tokens: `POST /app/installations/{id}/access_tokens`, valid
 *   for one hour, optionally narrowed to one repo. They are cached in memory
 *   only and minted again five minutes before they expire.
 *   https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
 */
import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import type { GitHubCaller } from "./api.ts";

const JWT_LIFETIME_S = 9 * 60;
const CLOCK_DRIFT_S = 60;
/** Mint a fresh installation token when the cached one has less than this left. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

export interface AppCredentials {
  appId: number;
  /** Preferred JWT issuer (GitHub's recommendation); falls back to the app id. */
  clientId: string | null;
  /** PEM, PKCS#1 or PKCS#8. */
  privateKey: string;
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** Parse a PEM once; throws a message without key material when it is not an RSA private key. */
export function parseAppKey(pem: string): KeyObject {
  try {
    const key = createPrivateKey({ key: pem.replace(/\\n/g, "\n"), format: "pem" });
    if (key.asymmetricKeyType !== "rsa") throw new Error("not rsa");
    return key;
  } catch {
    throw new Error("the GitHub App private key is not a valid RSA PEM key");
  }
}

export function appJwt(app: AppCredentials, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iat: now - CLOCK_DRIFT_S,
      exp: now + JWT_LIFETIME_S,
      iss: app.clientId ?? String(app.appId),
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(parseAppKey(app.privateKey)).toString("base64url")}`;
}

export interface Installation {
  id: number;
  /** The account (org or user) login the app is installed on. */
  account: string;
  repositorySelection: string;
}

interface RawInstallation {
  id?: unknown;
  account?: { login?: unknown } | null;
  repository_selection?: unknown;
}

export async function listInstallations(api: GitHubCaller, jwt: string): Promise<Installation[]> {
  const out: Installation[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const list = await api.json<RawInstallation[]>({
      path: `/app/installations?per_page=100&page=${page}`,
      bearer: jwt,
    });
    for (const raw of Array.isArray(list) ? list : []) {
      if (typeof raw.id !== "number" || typeof raw.account?.login !== "string") continue;
      out.push({
        id: raw.id,
        account: raw.account.login,
        repositorySelection: String(raw.repository_selection ?? "selected"),
      });
    }
    if (!Array.isArray(list) || list.length < 100) break;
  }
  return out;
}

export interface MintedToken {
  token: string;
  expiresAt: number;
}

/**
 * In-memory installation token cache keyed by installation and repo scope.
 * `mint` does the network call; concurrent callers for one key share it.
 */
export class InstallationTokenCache {
  readonly #entries = new Map<string, MintedToken>();
  readonly #pending = new Map<string, Promise<MintedToken>>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async get(key: string, mint: () => Promise<MintedToken>): Promise<string> {
    const hit = this.#entries.get(key);
    if (hit && hit.expiresAt - this.#now() > TOKEN_REFRESH_MARGIN_MS) return hit.token;
    this.#entries.delete(key);
    let pending = this.#pending.get(key);
    if (!pending) {
      pending = mint().finally(() => this.#pending.delete(key));
      this.#pending.set(key, pending);
    }
    const minted = await pending;
    this.#entries.set(key, minted);
    return minted.token;
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}

/** `POST /app/installations/{id}/access_tokens`, narrowed to `repo` when given. */
export async function mintInstallationToken(
  api: GitHubCaller,
  jwt: string,
  installationId: number,
  repo?: string,
): Promise<MintedToken> {
  const raw = await api.json<{ token?: unknown; expires_at?: unknown }>({
    method: "POST",
    path: `/app/installations/${installationId}/access_tokens`,
    bearer: jwt,
    body: repo ? { repositories: [repo] } : {},
  });
  const expiresAt = typeof raw.expires_at === "string" ? Date.parse(raw.expires_at) : Number.NaN;
  if (typeof raw.token !== "string" || !/^[\x21-\x7e]{8,512}$/.test(raw.token)) {
    throw new Error("GitHub returned an unexpected installation token payload");
  }
  // Without a parseable expiry, assume GitHub's documented one hour.
  return {
    token: raw.token,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 3_600_000,
  };
}
