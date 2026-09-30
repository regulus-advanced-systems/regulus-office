/**
 * Point the office App's webhook at this office (#35).
 *
 * When OFFICE_PUBLIC_URL is a public https URL, the office checks the App's
 * webhook configuration with the app JWT and, if the URL or content type is
 * not this office's, sets URL, `json`, TLS verification and the secret the
 * office holds (generating and storing one when a stored app has none).
 * https://docs.github.com/en/rest/apps/webhooks#get-a-webhook-configuration-for-an-app
 * https://docs.github.com/en/rest/apps/webhooks#update-a-webhook-configuration-for-an-app
 *
 * The API cannot tick the webhook's "Active" box or subscribe to events; for
 * an app created before #35 the owner does that once on GitHub (README
 * "Connect GitHub" → Webhooks).
 */
import { randomBytes } from "node:crypto";
import type { GitHubHookConfigState } from "@regulus/protocol";
import type { GitHubCaller } from "./api.ts";
import type { GitHubConnection } from "./connection.ts";
import { GitHubApiError } from "./pulls.ts";

export interface HookConfigResult {
  state: GitHubHookConfigState;
  detail: string | null;
  /** The app's slug as GitHub reports it (loop protection for env apps). */
  slug: string | null;
}

export async function ensureHookConfig(deps: {
  connection: GitHubConnection;
  api: GitHubCaller;
  webhookUrl: string | null;
}): Promise<HookConfigResult> {
  const { connection, api, webhookUrl } = deps;
  const app = connection.app();
  if (!app) return { state: "not_applicable", detail: "no GitHub App connected", slug: null };
  let slug = app.slug;
  try {
    const me = await api.json<{ slug?: unknown }>({
      path: "/app",
      bearer: connection.appJwt(app.credentials),
    });
    if (typeof me.slug === "string") slug = me.slug.slice(0, 100);
  } catch {
    // The slug is only for loop protection; the stored one (if any) stands.
  }
  if (!webhookUrl) {
    return {
      state: "not_applicable",
      detail: "OFFICE_PUBLIC_URL is not a public https URL; boards use polling",
      slug,
    };
  }
  let secret = connection.webhookSecret();
  let generated = false;
  if (!secret) {
    if (app.source === "env") {
      return { state: "error", detail: "set GITHUB_WEBHOOK_SECRET to receive webhooks", slug };
    }
    if (!connection.store.canStore) {
      return {
        state: "error",
        detail: "OFFICE_MASTER_KEY is needed to store a webhook secret",
        slug,
      };
    }
    secret = randomBytes(32).toString("base64url");
    generated = true;
  }
  const bearer = connection.appJwt(app.credentials);
  try {
    let current: { url?: unknown; content_type?: unknown; insecure_ssl?: unknown } = {};
    try {
      current = await api.json({ path: "/app/hook/config", bearer });
    } catch (err) {
      if (!(err instanceof GitHubApiError && err.status === 404)) throw err;
    }
    const matches =
      current.url === webhookUrl &&
      current.content_type === "json" &&
      String(current.insecure_ssl ?? "0") === "0";
    if (matches && !generated) return { state: "ok", detail: null, slug };
    await api.json({
      method: "PATCH",
      path: "/app/hook/config",
      bearer,
      body: { url: webhookUrl, content_type: "json", insecure_ssl: "0", secret },
    });
    // Stored only once GitHub has it, so the two never disagree.
    if (generated) connection.store.setWebhookSecret(secret);
    return {
      state: "updated",
      detail:
        "webhook URL and secret set; make sure the webhook is Active and events are subscribed",
      slug,
    };
  } catch (err) {
    const detail =
      err instanceof GitHubApiError
        ? `GitHub: ${err.detail} (${err.status})`
        : "GitHub unreachable";
    return { state: "error", detail: detail.slice(0, 300), slug };
  }
}
