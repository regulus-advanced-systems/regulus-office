/**
 * Key verification (SPEC §8 rule 2): one minimal authenticated request from
 * the office to the provider (list models), with a short timeout.
 *
 * - Only the status class is used: 2xx `ok`, 401/403 `rejected`, anything
 *   else `unreachable`. The response body is cancelled unread and never logged.
 * - Only the fixed hosts below are called; custom base URLs are `unsupported`,
 *   so a member cannot make the office send a key (or any request) to an
 *   arbitrary address.
 * - Redirects are not followed, so the key header never leaves the preset host.
 */
import type { Secret } from "@regulus/agent-adapters";
import type { KeyPresetId, KeyVerifyOutcome } from "@regulus/protocol";

type AuthStyle = "bearer" | "x-api-key" | "x-goog-api-key";

interface VerifyEndpoint {
  url: string;
  auth: AuthStyle;
  headers?: Record<string, string>;
}

/** List-models endpoints per preset (provider API docs; research 04). */
export const VERIFY_ENDPOINTS: Readonly<Partial<Record<KeyPresetId, VerifyEndpoint>>> = {
  anthropic: {
    url: "https://api.anthropic.com/v1/models?limit=1",
    auth: "x-api-key",
    headers: { "anthropic-version": "2023-06-01" },
  },
  openai: { url: "https://api.openai.com/v1/models", auth: "bearer" },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    auth: "x-goog-api-key",
  },
  deepseek: { url: "https://api.deepseek.com/models", auth: "bearer" },
  zai: { url: "https://api.z.ai/api/coding/paas/v4/models", auth: "bearer" },
  kimi: { url: "https://api.kimi.com/coding/v1/models", auth: "bearer" },
};

export const DEFAULT_VERIFY_TIMEOUT_MS = 5_000;

export interface KeyVerifierOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Replace endpoint URLs (tests point them at a local fake provider). */
  urls?: Partial<Record<KeyPresetId, string>>;
}

export type KeyVerifier = (preset: KeyPresetId, key: Secret) => Promise<KeyVerifyOutcome>;

function authHeaders(style: AuthStyle, key: string): Record<string, string> {
  switch (style) {
    case "bearer":
      return { authorization: `Bearer ${key}` };
    case "x-api-key":
      return { "x-api-key": key };
    case "x-goog-api-key":
      return { "x-goog-api-key": key };
  }
}

export function createKeyVerifier(options: KeyVerifierOptions = {}): KeyVerifier {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  return async (preset, key) => {
    const endpoint = VERIFY_ENDPOINTS[preset];
    if (!endpoint) return "unsupported";
    const url = options.urls?.[preset] ?? endpoint.url;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "application/json",
          ...endpoint.headers,
          ...authHeaders(endpoint.auth, key.reveal()),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return "unreachable";
    }
    try {
      await res.body?.cancel();
    } catch {
      // body already gone
    }
    if (res.status >= 200 && res.status < 300) return "ok";
    if (res.status === 401 || res.status === 403) return "rejected";
    return "unreachable";
  };
}
