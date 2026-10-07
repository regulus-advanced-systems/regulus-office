/**
 * Browser client for the viewer's own GitHub link (#267; SPEC D27): status,
 * start linking, check now, unlink. The token stays on the server: nothing
 * here sends or receives one.
 */
import {
  GITHUB_LINK_API_PATH,
  GITHUB_LINK_CHECK_API_PATH,
  GITHUB_LINK_START_API_PATH,
  GitHubLinkStatus,
  StartGitHubLinkResponse,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export function createGitHubLinkApi(options: { fetch?: typeof fetch; baseUrl?: string } = {}) {
  const base = options.baseUrl ?? "";

  async function call<T>(method: string, path: string, schema: Parser<T>): Promise<ApiResult<T>> {
    const doFetch = options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json" },
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
      return {
        ok: false,
        status: res.status,
        code: typeof b.error === "string" ? b.error.toLowerCase() : `http_${res.status}`,
      };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }

  return {
    status: () => call<GitHubLinkStatus>("GET", GITHUB_LINK_API_PATH, GitHubLinkStatus),
    start: () =>
      call<StartGitHubLinkResponse>("POST", GITHUB_LINK_START_API_PATH, StartGitHubLinkResponse),
    check: () => call<GitHubLinkStatus>("POST", GITHUB_LINK_CHECK_API_PATH, GitHubLinkStatus),
    unlink: () => call<GitHubLinkStatus>("DELETE", GITHUB_LINK_API_PATH, GitHubLinkStatus),
  };
}

export type GitHubLinkApi = ReturnType<typeof createGitHubLinkApi>;

/** Human wording for a failed link call. */
export function describeGitHubLinkError(err: ApiFailure): string {
  switch (err.code) {
    case "network_error":
      return "Could not reach the office server. Check your connection and try again.";
    case "oauth_not_configured":
      return "This office has no GitHub sign-in set up yet. Ask the operator to set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.";
    case "master_key_required":
      return "Nothing can be stored: the server has no OFFICE_MASTER_KEY. Ask the operator to set one.";
    case "too_many_requests":
      return "GitHub was asked a moment ago. Try again in a few seconds.";
    case "unauthorized":
      return "Your session has ended. Sign in again.";
    case "origin_mismatch":
      return "The request came from an unexpected origin; reload the page from the office URL.";
    default:
      return `Something went wrong (${err.code}).`;
  }
}

/** What the office page's `?github_link=` result after the OAuth round trip means. */
export function describeLinkResult(result: string): { ok: boolean; text: string } {
  switch (result) {
    case "linked":
      return { ok: true, text: "GitHub account linked." };
    case "denied":
      return { ok: false, text: "Linking was cancelled on GitHub." };
    case "invalid_state":
      return {
        ok: false,
        text: "GitHub sent back a request this office did not start (or it expired). Try again.",
      };
    case "signed_out":
      return { ok: false, text: "You were signed out while linking. Sign in and try again." };
    case "account_in_use":
      return {
        ok: false,
        text: "That GitHub account is already linked to someone else in this office.",
      };
    case "github_rejected":
      return { ok: false, text: "GitHub did not accept the link. Try again." };
    case "github_unavailable":
      return { ok: false, text: "GitHub could not be reached. Try again in a moment." };
    default:
      return { ok: false, text: `Linking GitHub did not finish (${result}).` };
  }
}
