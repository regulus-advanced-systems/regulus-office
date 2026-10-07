/**
 * Browser client for office agents (#271): the list, creating and
 * configuring them, tokens (shown once), conversations and the questions
 * agents ask. Errors come back as short codes.
 */
import {
  CREDENTIAL_PROFILES_API_PATH,
  type CreateOfficeAgent,
  CredentialProfileListResponse,
  HumanRequest,
  HumanRequestsResponse,
  OFFICE_AGENT_REQUESTS_API_PATH,
  OFFICE_AGENT_SETTINGS_API_PATH,
  OFFICE_AGENTS_API_PATH,
  OfficeAgentConversation,
  type OfficeAgentGrant,
  OfficeAgentMessage,
  OfficeAgentSettings,
  OfficeAgentsResponse,
  OfficeAgentTokenCreated,
  OfficeAgentView,
  type ProviderId,
  type UpdateOfficeAgent,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}
const NO_CONTENT: Parser<void> = { safeParse: () => ({ success: true, data: undefined }) };

export function createOfficeAgentsApi(options: { fetch?: typeof fetch } = {}) {
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
      const failure: ApiFailure = { ok: false, status: res.status, code };
      if (typeof b.message === "string") failure.reason = b.message;
      return failure;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }

  const agent = (id: string) => `${OFFICE_AGENTS_API_PATH}/${encodeURIComponent(id)}`;
  return {
    list: () => call("GET", OFFICE_AGENTS_API_PATH, OfficeAgentsResponse),
    create: (input: CreateOfficeAgent) =>
      call("POST", OFFICE_AGENTS_API_PATH, OfficeAgentView, input),
    update: (id: string, patch: UpdateOfficeAgent) =>
      call("PATCH", agent(id), OfficeAgentView, patch),
    remove: (id: string) => call("DELETE", agent(id), NO_CONTENT),
    setGrants: (id: string, grants: OfficeAgentGrant[]) =>
      call("PUT", `${agent(id)}/grants`, OfficeAgentView, { grants }),
    mintToken: (id: string, label: string) =>
      call("POST", `${agent(id)}/tokens`, OfficeAgentTokenCreated, { label }),
    revokeToken: (id: string, tokenId: string) =>
      call("DELETE", `${agent(id)}/tokens/${encodeURIComponent(tokenId)}`, NO_CONTENT),
    start: (id: string) => call("POST", `${agent(id)}/start`, OfficeAgentView),
    stop: (id: string) => call("POST", `${agent(id)}/stop`, OfficeAgentView),
    conversation: (id: string) => call("GET", `${agent(id)}/conversation`, OfficeAgentConversation),
    send: (id: string, text: string) =>
      call("POST", `${agent(id)}/messages`, OfficeAgentMessage, { text }),
    requests: () => call("GET", OFFICE_AGENT_REQUESTS_API_PATH, HumanRequestsResponse),
    answer: (requestId: string, body: { answer: string }) =>
      call(
        "POST",
        `${OFFICE_AGENT_REQUESTS_API_PATH}/${encodeURIComponent(requestId)}/answer`,
        HumanRequest,
        body,
      ),
    saveSettings: (settings: OfficeAgentSettings) =>
      call("PUT", OFFICE_AGENT_SETTINGS_API_PATH, OfficeAgentSettings, settings),
    /** Ids and labels only: the caller's own key profiles and the office keys of a provider. */
    profiles: (provider: ProviderId) =>
      call(
        "GET",
        `${CREDENTIAL_PROFILES_API_PATH}?provider=${encodeURIComponent(provider)}`,
        CredentialProfileListResponse,
      ),
  };
}

export type OfficeAgentsApi = ReturnType<typeof createOfficeAgentsApi>;

const ERRORS: Record<string, string> = {
  network_error: "The office server cannot be reached.",
  unauthorized: "Your session has ended. Sign in again.",
  not_found: "That agent is gone; the list was refreshed.",
  not_your_agent: "Only the person an agent belongs to can do that.",
  owner_or_admin_required: "Only office owners and admins can do that.",
  viewers_cannot: "Viewers cannot create agents.",
  name_taken: "Another agent already has that name. Names are permanent and unique.",
  pm_exists: "There is already a PM here: the office has one, and so can each person.",
  personal_agent_cap: "You have as many personal agents as the office allows.",
  engine_unavailable: "That engine is not available in this office yet.",
  provider_not_supported: "The CLI session engine runs Claude Code only for now.",
  office_key_required:
    "A shared agent runs on an office-wide key only. An admin adds one under Connect providers.",
  too_many_tokens: "This agent has the most tokens it can have. Revoke one first.",
  already_answered: "That question was already answered.",
  invalid_body: "Check the form: a name (letters, digits, spaces), a model and a role.",
};

export function describeOfficeAgentsError(failure: ApiFailure): string {
  return ERRORS[failure.code] ?? failure.reason ?? `Something went wrong (${failure.code}).`;
}
