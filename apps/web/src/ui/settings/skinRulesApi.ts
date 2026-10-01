/**
 * Browser client for the henchman skin rules (#184), owners and admins:
 * list, add, change and delete. Errors come back as short codes.
 */
import {
  type CreateSkinRule,
  SKIN_RULES_API_PATH,
  SkinRule,
  SkinRulesResponse,
  type UpdateSkinRule,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

const NO_CONTENT: Parser<void> = { safeParse: () => ({ success: true, data: undefined }) };

export function createSkinRulesApi(options: { fetch?: typeof fetch } = {}) {
  async function call<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await (options.fetch ?? fetch)(path, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: "network_error" };
    }
    const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const b = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      const code = typeof b.error === "string" ? b.error.toLowerCase() : `http_${res.status}`;
      return { ok: false, status: res.status, code };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }

  const rulePath = (id: string) => `${SKIN_RULES_API_PATH}/${encodeURIComponent(id)}`;
  return {
    list: () => call("GET", SKIN_RULES_API_PATH, SkinRulesResponse),
    create: (input: CreateSkinRule) => call("POST", SKIN_RULES_API_PATH, SkinRule, input),
    update: (id: string, patch: UpdateSkinRule) => call("PATCH", rulePath(id), SkinRule, patch),
    remove: (id: string) => call("DELETE", rulePath(id), NO_CONTENT),
  };
}

export type SkinRulesApi = ReturnType<typeof createSkinRulesApi>;

const ERRORS: Record<string, string> = {
  network_error: "The office server cannot be reached.",
  unauthorized: "Your session has ended. Sign in again.",
  forbidden: "Only office owners and admins can change henchman skins.",
  owner_or_admin_required: "Only office owners and admins can change henchman skins.",
  not_found: "That rule is gone; the list was refreshed.",
  too_many_rules: "That is the most rules an office can have. Delete one first.",
  invalid_body: "Check the rule: who it matches, the skin and a whole-number priority.",
};

export function describeSkinRulesError(failure: ApiFailure): string {
  return ERRORS[failure.code] ?? `Something went wrong (${failure.code}).`;
}
