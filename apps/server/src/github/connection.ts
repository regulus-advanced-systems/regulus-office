/**
 * The office's GitHub connection (SPEC §4.2 GitHub, §8, D14; #141).
 *
 * One connection per office: a GitHub App (recommended; from the manifest
 * flow and stored encrypted, or from GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY,
 * which win) or an org fine-grained PAT. It lists the repos it can see and
 * hands out a token for server-side git and REST on a repo it covers:
 * a one-hour installation token narrowed to that repo, or the PAT.
 *
 * Tokens, the private key and the webhook secret are never returned to a
 * client, never logged and never put into an agent's environment.
 */
import type { GitHubConnectionStatus, GitHubRepoInfo } from "@regulus/protocol";
import type { Logger } from "../logging.ts";
import { createGitHubCaller, type FetchFn, type GitHubCaller, redactGitHubText } from "./api.ts";
import {
  type AppCredentials,
  appJwt,
  type Installation,
  InstallationTokenCache,
  listInstallations,
  mintInstallationToken,
} from "./app-auth.ts";
import { ConnectionStore, type StoredApp, type StoredPat } from "./connection-store.ts";
import { GitHubApiError } from "./pulls.ts";
import { listInstallationRepos, listTokenRepos, type RepoList, sortRepos } from "./repo-list.ts";

/** Installations and repo lists are re-read after this long. */
export const LIST_CACHE_MS = 60_000;

export interface EnvApp {
  appId: number;
  clientId: string | null;
  privateKey: string;
  webhookSecret: string | null;
}

export interface GitHubConnectionDeps {
  store: ConnectionStore;
  apiBase: string;
  logger: Logger;
  /** GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (+ GITHUB_WEBHOOK_SECRET): overrides the stored one. */
  envApp?: EnvApp;
  fetch?: FetchFn;
  now?: () => number;
}

type Resolved =
  | { kind: "none" }
  | { kind: "app"; source: "db" | "env"; app: AppCredentials; meta: StoredApp | null }
  | { kind: "pat"; source: "db"; pat: StoredPat };

interface Cached<T> {
  value: T;
  at: number;
}

export class GitHubConnection {
  readonly #deps: GitHubConnectionDeps;
  readonly #api: GitHubCaller;
  readonly #now: () => number;
  readonly #tokens: InstallationTokenCache;
  #installations: Cached<Installation[]> | null = null;
  #repos: Cached<RepoList> | null = null;

  constructor(deps: GitHubConnectionDeps) {
    this.#deps = deps;
    this.#api = createGitHubCaller({ apiBase: deps.apiBase, fetch: deps.fetch });
    this.#now = deps.now ?? Date.now;
    this.#tokens = new InstallationTokenCache(this.#now);
  }

  get api(): GitHubCaller {
    return this.#api;
  }

  get store(): ConnectionStore {
    return this.#deps.store;
  }

  /** Drop every cached token and list (after connect, disconnect). */
  reset(): void {
    this.#tokens.clear();
    this.#installations = null;
    this.#repos = null;
  }

  #resolve(): Resolved {
    const env = this.#deps.envApp;
    if (env) {
      return {
        kind: "app",
        source: "env",
        app: { appId: env.appId, clientId: env.clientId, privateKey: env.privateKey },
        meta: null,
      };
    }
    const stored = this.#deps.store.load();
    if (!stored) return { kind: "none" };
    if (stored.kind === "pat") return { kind: "pat", source: "db", pat: stored };
    return {
      kind: "app",
      source: "db",
      app: { appId: stored.appId, clientId: stored.clientId, privateKey: stored.privateKey },
      meta: stored,
    };
  }

  /** True when an env app is configured (the UI cannot replace or remove it). */
  get managedByEnv(): boolean {
    return this.#deps.envApp !== undefined;
  }

  #fresh<T>(cached: Cached<T> | null): cached is Cached<T> {
    return cached !== null && this.#now() - cached.at < LIST_CACHE_MS;
  }

  async #installationsFor(app: AppCredentials): Promise<Installation[]> {
    if (this.#fresh(this.#installations)) return this.#installations.value;
    const value = await listInstallations(this.#api, appJwt(app, this.#now()));
    this.#installations = { value, at: this.#now() };
    return value;
  }

  #installationToken(app: AppCredentials, installationId: number, repo?: string) {
    const key = `${installationId}:${repo?.toLowerCase() ?? "*"}`;
    return this.#tokens.get(key, () =>
      mintInstallationToken(this.#api, appJwt(app, this.#now()), installationId, repo),
    );
  }

  async status(): Promise<GitHubConnectionStatus> {
    const canStore = this.#deps.store.canStore;
    let resolved: Resolved;
    try {
      resolved = this.#resolve();
    } catch {
      // A stored secret that no longer decrypts (master key changed): report, don't throw.
      return { kind: "none", source: null, canStore, app: null, pat: null, connectedAt: null };
    }
    if (resolved.kind === "none") {
      return { kind: "none", source: null, canStore, app: null, pat: null, connectedAt: null };
    }
    if (resolved.kind === "pat") {
      return {
        kind: "pat",
        source: "db",
        canStore,
        app: null,
        pat: { login: resolved.pat.login },
        connectedAt: resolved.pat.connectedAt,
      };
    }
    let installations: Installation[] = [];
    let error: string | null = null;
    try {
      installations = await this.#installationsFor(resolved.app);
    } catch (err) {
      error = this.#describe(err);
    }
    const meta = resolved.meta;
    return {
      kind: "app",
      source: resolved.source,
      canStore,
      app: {
        appId: resolved.app.appId,
        slug: meta?.slug ?? null,
        name: meta?.name ?? null,
        htmlUrl: meta?.htmlUrl ?? null,
        installUrl: meta?.htmlUrl ? `${meta.htmlUrl}/installations/new` : null,
        owner: meta?.owner ?? null,
        installations: installations.map((i) => ({
          installationId: i.id,
          account: i.account,
          repositorySelection: i.repositorySelection,
        })),
        error,
      },
      pat: null,
      connectedAt: meta?.connectedAt ?? null,
    };
  }

  /** Every repo the connection can see, sorted; an empty list without a connection. */
  async listRepos(): Promise<RepoList> {
    if (this.#fresh(this.#repos)) return this.#repos.value;
    const resolved = this.#resolve();
    let list: RepoList;
    if (resolved.kind === "none") return { repos: [], truncated: false };
    if (resolved.kind === "pat") {
      list = await listTokenRepos(this.#api, resolved.pat.token);
    } else {
      const repos: GitHubRepoInfo[] = [];
      let truncated = false;
      for (const inst of await this.#installationsFor(resolved.app)) {
        const token = await this.#installationToken(resolved.app, inst.id);
        const part = await listInstallationRepos(this.#api, token);
        repos.push(...part.repos);
        truncated ||= part.truncated;
      }
      list = { repos, truncated };
    }
    const value = { repos: sortRepos(list.repos), truncated: list.truncated };
    this.#repos = { value, at: this.#now() };
    return value;
  }

  /**
   * A token for server-side git and REST on `owner/name`, or null when the
   * connection does not cover that repo (or there is no connection). Throws
   * {@link GitHubApiError} when GitHub cannot be asked.
   */
  async tokenFor(owner: string, name: string): Promise<string | null> {
    const resolved = this.#resolve();
    if (resolved.kind === "none") return null;
    if (resolved.kind === "pat") {
      const { repos } = await this.listRepos();
      const key = `${owner}/${name}`.toLowerCase();
      return repos.some((r) => r.fullName.toLowerCase() === key) ? resolved.pat.token : null;
    }
    const inst = (await this.#installationsFor(resolved.app)).find(
      (i) => i.account.toLowerCase() === owner.toLowerCase(),
    );
    if (!inst) return null;
    try {
      // Narrowed to this one repo: a leaked token reaches nothing else.
      return await this.#installationToken(resolved.app, inst.id, name);
    } catch (err) {
      // 422: the repo is not in the installation's selection (or does not exist).
      if (err instanceof GitHubApiError && (err.status === 422 || err.status === 404)) return null;
      throw err;
    }
  }

  /**
   * The app's webhook secret (GITHUB_WEBHOOK_SECRET for an env app, else the
   * stored one), decrypted for one verification; null without an app or secret.
   */
  webhookSecret(): string | null {
    try {
      const resolved = this.#resolve();
      if (resolved.kind !== "app") return null;
      if (resolved.source === "env") return this.#deps.envApp?.webhookSecret ?? null;
      return resolved.meta?.webhookSecret ?? null;
    } catch {
      return null;
    }
  }

  /** The app's credentials and stored metadata (webhook setup, loop protection); null without an app. */
  app(): { credentials: AppCredentials; source: "db" | "env"; slug: string | null } | null {
    try {
      const resolved = this.#resolve();
      if (resolved.kind !== "app") return null;
      return {
        credentials: resolved.app,
        source: resolved.source,
        slug: resolved.meta?.slug ?? null,
      };
    } catch {
      return null;
    }
  }

  /** A fresh app JWT (for `/app` endpoints). */
  appJwt(credentials: AppCredentials): string {
    return appJwt(credentials, this.#now());
  }

  /** Check an org PAT against GitHub; returns the account login when GitHub reports it. */
  async verifyPat(token: string): Promise<{ login: string | null; repoCount: number }> {
    const user = await this.#api.json<{ login?: unknown }>({ path: "/user", bearer: token });
    const list = await listTokenRepos(this.#api, token, 100);
    return {
      login: typeof user.login === "string" ? user.login.slice(0, 100) : null,
      repoCount: list.repos.length,
    };
  }

  #describe(err: unknown): string {
    if (err instanceof GitHubApiError) return `GitHub: ${err.detail} (${err.status})`.slice(0, 300);
    const reason = err instanceof Error ? err.message : String(err);
    return redactGitHubText(reason).slice(0, 300);
  }

  describeError(err: unknown): string {
    const text = this.#describe(err);
    this.#deps.logger.warn({ reason: text }, "github connection call failed");
    return text;
  }
}
