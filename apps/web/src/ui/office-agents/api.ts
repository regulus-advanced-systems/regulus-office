/**
 * Browser client for office agents (#271): the list, creating and
 * configuring them, tokens (shown once), conversations and the questions
 * agents ask. Errors come back as short codes.
 */
import {
  type CreateMindEntry,
  type CreateOfficeAgent,
  type HermesConnectionInput,
  type HermesConnectionTest,
  HermesConnectionTestResult,
  HumanRequest,
  HumanRequestsResponse,
  MindEntriesResponse,
  MindEntry,
  type MindEntryKind,
  OFFICE_AGENT_ATTENTION_API_PATH,
  OFFICE_AGENT_HERMES_TEST_API_PATH,
  OFFICE_AGENT_REQUESTS_API_PATH,
  OFFICE_AGENT_RUNS_ON_API_PATH,
  OFFICE_AGENT_SETTINGS_API_PATH,
  OFFICE_AGENTS_API_PATH,
  OfficeAgentAttention,
  OfficeAgentConversation,
  type OfficeAgentGrant,
  OfficeAgentMessage,
  OfficeAgentRunsOnResponse,
  OfficeAgentSettings,
  OfficeAgentSoul,
  OfficeAgentsResponse,
  OfficeAgentTokenCreated,
  OfficeAgentView,
  officeAgentDismissPath,
  officeAgentHermesPath,
  officeAgentMindPaths,
  officeAgentRecallPath,
  officeAgentSeenPath,
  PROVIDER_LOGINS_API_PATH,
  ProviderLoginStatusResponse,
  SoulVersion,
  SoulVersionsResponse,
  type UpdateMindEntry,
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
      if (typeof b.retryAfterSeconds === "number") failure.retryAfterSeconds = b.retryAfterSeconds;
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
    /** A personal agent's owner sends it off to wander, or calls it back to their side (#252). */
    dismiss: (id: string) => call("POST", officeAgentDismissPath(id), OfficeAgentView),
    recall: (id: string) => call("POST", officeAgentRecallPath(id), OfficeAgentView),
    /** The caller has read their conversation with it: its "answer ready" bubble clears. */
    seen: (id: string) => call("POST", officeAgentSeenPath(id), NO_CONTENT),
    /** What the caller's agents want from them: questions, unread replies, answers owed. */
    attention: () => call("GET", OFFICE_AGENT_ATTENTION_API_PATH, OfficeAgentAttention),
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
    /** Try an address and token, or an agent's stored connection to its owner's Hermes (#58). */
    testHermes: (input: HermesConnectionTest) =>
      call("POST", OFFICE_AGENT_HERMES_TEST_API_PATH, HermesConnectionTestResult, input),
    /** Replace an agent's connection. The office never sends a stored one back. */
    setHermes: (id: string, input: HermesConnectionInput) =>
      call("PUT", officeAgentHermesPath(id), OfficeAgentView, input),
    // Its soul, memories and notes (#136): only for those who may read them.
    soul: (id: string) => call("GET", officeAgentMindPaths(id).soul, OfficeAgentSoul),
    saveSoul: (id: string, content: string, baseVersion: number) =>
      call("PUT", officeAgentMindPaths(id).soul, OfficeAgentSoul, { content, baseVersion }),
    soulVersions: (id: string) =>
      call("GET", officeAgentMindPaths(id).soulVersions, SoulVersionsResponse),
    soulVersion: (id: string, version: number) =>
      call("GET", officeAgentMindPaths(id).soulVersion(version), SoulVersion),
    revertSoul: (id: string, version: number) =>
      call("POST", officeAgentMindPaths(id).soulRevert, OfficeAgentSoul, { version }),
    entries: (id: string, kind: MindEntryKind, query = "") =>
      call(
        "GET",
        `${officeAgentMindPaths(id).entries}?kind=${kind}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
        MindEntriesResponse,
      ),
    addEntry: (id: string, entry: CreateMindEntry) =>
      call("POST", officeAgentMindPaths(id).entries, MindEntry, entry),
    updateEntry: (id: string, entryId: string, patch: UpdateMindEntry) =>
      call("PATCH", officeAgentMindPaths(id).entry(entryId), MindEntry, patch),
    removeEntry: (id: string, entryId: string) =>
      call("DELETE", officeAgentMindPaths(id).entry(entryId), NO_CONTENT),
    /** What the caller can run an agent on: names and kinds of logins and keys, never a key. */
    runsOn: () => call("GET", OFFICE_AGENT_RUNS_ON_API_PATH, OfficeAgentRunsOnResponse),
    /** Whether the caller's own Claude login is connected: true, false, or null when unknown. */
    claudeLogin: async (): Promise<boolean | null> => {
      const res = await call("GET", PROVIDER_LOGINS_API_PATH, ProviderLoginStatusResponse);
      if (!res.ok) return null;
      return res.data.providers.find((p) => p.provider === "claude-code")?.connected ?? null;
    },
  };
}

export type OfficeAgentsApi = ReturnType<typeof createOfficeAgentsApi>;

const ERRORS: Record<string, string> = {
  network_error: "The office server cannot be reached.",
  unauthorized: "Your session has ended. Sign in again.",
  not_found: "That agent is gone; the list was refreshed.",
  not_your_agent: "Only the person an agent belongs to can do that.",
  owner_or_admin_required: "Only office owners and admins can do that.",
  viewers_cannot: "Viewers cannot create agents or talk to shared ones.",
  name_taken: "Another agent already has that name. Names are permanent and unique.",
  pm_exists: "There is already a project manager here: the office has one, and so can each person.",
  personal_agent_cap: "You have as many personal agents as the office allows.",
  engine_unavailable: "This office cannot run an agent that way yet. Pick another under Runs as.",
  provider_not_supported: "A Claude Code session cannot run on that provider yet.",
  office_key_required:
    "A shared agent runs on one of the office's own keys only. An owner or admin adds one under Connect providers.",
  too_many_tokens: "This agent has as many access codes as it can have. Remove one first.",
  shared_agents_wander:
    "A shared agent roams the lair on its own; only a personal agent can be dismissed.",
  already_answered: "That question was already answered.",
  personal_only: "Your own Hermes can only be a personal agent: choose Me under Belongs to.",
  hermes_connection_required: "Enter the address and the access token of your Hermes.",
  hermes_not_connected:
    "This agent has no connection to a Hermes yet. Enter its address and access token on its card.",
  hermes_connection_unreadable:
    "The stored connection cannot be read any more. Enter the address and the access token again.",
  hermes_unreachable:
    "Your Hermes cannot be reached. Check that its gateway is running and that the office's server can reach its address.",
  hermes_bad_token:
    "Your Hermes refused the access token. Enter the current one (its API_SERVER_KEY) on the agent's card.",
  master_key_missing:
    "This office cannot keep a connection safely yet: its OFFICE_MASTER_KEY is not set. Ask whoever runs the office.",
  too_many_tests: "That was a lot of tries. Wait a minute and test again.",
  soul_changed:
    "Someone saved a newer version while you were writing. Copy your text, reload, and add it again.",
  title_taken: "Another note already has that title.",
  cap_reached: "It holds as many of these as it can. Delete some first.",
  too_large: "That text is too long.",
  invalid_body: "Check the form: a name (letters, digits, spaces), a model and a job.",
};

export function describeOfficeAgentsError(failure: ApiFailure): string {
  if (failure.code === "message_rate_limited") {
    const minutes = Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 60) / 60));
    return `You have reached the hourly limit of messages to this shared agent. Try again in about ${minutes} min.`;
  }
  // The office says which line looks like a key; it never repeats the text.
  if (failure.code === "secret_rejected" && failure.reason) return failure.reason;
  return ERRORS[failure.code] ?? failure.reason ?? `Something went wrong (${failure.code}).`;
}
