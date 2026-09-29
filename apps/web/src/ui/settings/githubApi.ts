/**
 * Browser client for the office GitHub connection (#141; SPEC §8, D14):
 * status, the repo list for "Add floor", connect with an org PAT, start the
 * GitHub App manifest flow, disconnect. Owners and admins only. A PAT goes
 * out in one request body and nothing here keeps it; responses never carry
 * a token, the app's private key or its webhook secret.
 */
import {
  GITHUB_CONNECTION_API_PATH,
  GITHUB_MANIFEST_API_PATH,
  GITHUB_PAT_API_PATH,
  GITHUB_REPOS_API_PATH,
  GitHubConnectionStatus,
  GitHubReposResponse,
  StartManifestResponse,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

const NO_CONTENT: Parser<void> = { safeParse: () => ({ success: true, data: undefined }) };

export interface GitHubApiOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

export function createGitHubApi(options: GitHubApiOptions = {}) {
  const base = options.baseUrl ?? "";

  async function call<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const doFetch = options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: "network_error" };
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      const b = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      const out: ApiFailure = {
        ok: false,
        status: res.status,
        code: typeof b.error === "string" ? b.error.toLowerCase() : `http_${res.status}`,
      };
      if (typeof b.detail === "string") out.reason = b.detail;
      return out;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }

  return {
    status: () =>
      call<GitHubConnectionStatus>("GET", GITHUB_CONNECTION_API_PATH, GitHubConnectionStatus),
    repos: () => call<GitHubReposResponse>("GET", GITHUB_REPOS_API_PATH, GitHubReposResponse),
    connectPat: (token: string) =>
      call<GitHubConnectionStatus>("PUT", GITHUB_PAT_API_PATH, GitHubConnectionStatus, { token }),
    startManifest: (org?: string) =>
      call<StartManifestResponse>(
        "POST",
        GITHUB_MANIFEST_API_PATH,
        StartManifestResponse,
        org ? { org } : {},
      ),
    disconnect: () => call<void>("DELETE", GITHUB_CONNECTION_API_PATH, NO_CONTENT),
  };
}

export type GitHubApi = ReturnType<typeof createGitHubApi>;

/** Human wording for a failed GitHub connection call. */
export function describeGitHubError(err: ApiFailure): string {
  switch (err.code) {
    case "network_error":
      return "Could not reach the office server. Check your connection and try again.";
    case "owner_or_admin_required":
      return "Only owners and admins can connect GitHub.";
    case "master_key_required":
      return "Nothing can be stored: the server has no OFFICE_MASTER_KEY. Ask the operator to set one.";
    case "managed_by_env":
      return "The GitHub App is set by the server environment (GITHUB_APP_ID), so it cannot be changed here.";
    case "github_rejected":
      return `GitHub did not accept that token${err.reason ? ` (${err.reason})` : ""}.`;
    case "github_unavailable":
      return `GitHub could not be asked for the repo list${err.reason ? ` (${err.reason})` : ""}.`;
    case "invalid_body":
      return "That does not look like a GitHub token or organization name.";
    case "unauthorized":
      return "Your session has ended. Sign in again.";
    case "origin_mismatch":
      return "The request came from an unexpected origin; reload the page from the office URL.";
    default:
      return `Something went wrong (${err.code}).`;
  }
}

/** What the office page's `?github=` result after the manifest flow means. */
export function describeManifestResult(result: string): { ok: boolean; text: string } {
  switch (result) {
    case "installed":
      return { ok: true, text: "GitHub App installed. Its repos are listed in Add floor." };
    case "connected":
      return { ok: true, text: "GitHub App created. Install it on your organization next." };
    case "invalid_state":
      return {
        ok: false,
        text: "GitHub sent back a request this office did not start (or it expired). Try again.",
      };
    case "signed_out":
      return {
        ok: false,
        text: "You were signed out while creating the app. Sign in and try again.",
      };
    case "conversion_failed":
      return {
        ok: false,
        text: "GitHub did not hand over the new app's credentials. Try again within the hour.",
      };
    default:
      return { ok: false, text: `Connecting GitHub did not finish (${result}).` };
  }
}
