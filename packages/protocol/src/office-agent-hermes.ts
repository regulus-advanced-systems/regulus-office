/**
 * Connecting a person's own, already running Hermes Agent to the office
 * (SPEC §10 M5, D3, D20, D28; #58): the `hermes-external` engine.
 *
 * The office talks to the Hermes gateway's API server (`hermes gateway` with
 * `API_SERVER_ENABLED=true`) over HTTP with its `API_SERVER_KEY`, and so
 * becomes one more channel to the same agent, next to Telegram and the rest.
 *
 * The address and the access token are a credential of the person the agent
 * belongs to (SPEC §8): the office stores them encrypted, uses them only for
 * that person's agent, and never sends them back, not even to that person.
 */
import { z } from "zod";
import type { OfficeAgentEngineKind } from "./office-agents.ts";

/** `POST`: try an address and token, or an agent's stored connection. */
export const OFFICE_AGENT_HERMES_TEST_API_PATH = "/api/office-agents/hermes/test";
/** `PUT /api/office-agents/:id/hermes`: replace an agent's connection. */
export const officeAgentHermesPath = (agentId: string) =>
  `/api/office-agents/${encodeURIComponent(agentId)}/hermes`;

/**
 * Engines that bring their own provider and model: the form asks for neither.
 * A Hermes the office runs itself (`hermes-managed`, #57) is not one of them:
 * it runs on a key picked in the form, as the session engine does.
 */
export const ENGINES_WITH_OWN_MODEL: readonly OfficeAgentEngineKind[] = [
  "hermes-external",
  "openclaw",
];
export const engineBringsOwnModel = (kind: OfficeAgentEngineKind) =>
  ENGINES_WITH_OWN_MODEL.includes(kind);
/** Engines only a person can own: the connection is that person's credential. */
export const engineIsPersonalOnly = (kind: OfficeAgentEngineKind) => kind === "hermes-external";
/** What is stored as the model of an agent whose engine brings its own. */
export const OWN_MODEL_PLACEHOLDER = "hermes";

export const HERMES_LIMITS = {
  urlMax: 300,
  tokenMin: 8,
  tokenMax: 512,
  /** Hermes's own cap on a session id. */
  sessionIdMax: 256,
} as const;

/**
 * Why an address is not usable, or null. `http` and `https` only, no user
 * name or password in it, no query and no fragment. A path is allowed (a
 * Hermes profile is served under `/p/<profile>`).
 */
export function hermesUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "That is not an address. It looks like http://my-server:8642";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "The address must start with http:// or https://";
  }
  if (url.username || url.password) return "Leave user names and passwords out of the address.";
  if (url.search || url.hash) return "Leave everything after ? or # out of the address.";
  // Link-local: cloud metadata services live there, a Hermes gateway never does.
  if (/^169\.254\./.test(url.hostname) || /^\[?fe80:/i.test(url.hostname)) {
    return "That address is not allowed.";
  }
  return null;
}

/** The address as stored and used: no trailing slash. */
export function normalizeHermesUrl(value: string): string {
  const url = new URL(value.trim());
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const HermesUrl = z
  .string()
  .trim()
  .min(1)
  .max(HERMES_LIMITS.urlMax)
  .superRefine((value, ctx) => {
    const problem = hermesUrlProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const HermesToken = z
  .string()
  .trim()
  .min(HERMES_LIMITS.tokenMin)
  .max(HERMES_LIMITS.tokenMax)
  // A header value: nothing that could break out of it.
  .regex(/^[\x21-\x7e]+$/);

/** Path-safe, as Hermes requires of a session id. */
const HermesSessionId = z
  .string()
  .trim()
  .min(1)
  .max(HERMES_LIMITS.sessionIdMax)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

/** What a person enters to connect their Hermes. */
export const HermesConnectionInput = z.object({
  /** Where the Hermes API server listens, e.g. `http://my-server:8642`. */
  url: HermesUrl,
  /** Hermes's `API_SERVER_KEY`. */
  token: HermesToken,
  /**
   * Optional: an existing Hermes session to continue (for example the one a
   * Telegram chat uses) instead of a new one for the office.
   */
  sessionId: HermesSessionId.optional(),
});
export type HermesConnectionInput = z.infer<typeof HermesConnectionInput>;

/** Try a connection before saving it, or the one an agent already has. */
export const HermesConnectionTest = z.union([
  HermesConnectionInput.pick({ url: true, token: true }),
  z.object({ agentId: z.string().min(1).max(64) }),
]);
export type HermesConnectionTest = z.infer<typeof HermesConnectionTest>;

export const HERMES_TEST_CODES = [
  "connected",
  /** Nothing answered at that address. */
  "unreachable",
  /** Something answered, and it refused the access token. */
  "bad_token",
  /** Something answered that is not a Hermes API server. */
  "not_hermes",
  /** A Hermes that lacks the session chat the office needs. */
  "too_old",
] as const;
export type HermesTestCode = (typeof HERMES_TEST_CODES)[number];

export const HermesConnectionTestResult = z.object({
  ok: z.boolean(),
  code: z.enum(HERMES_TEST_CODES),
  /** One plain sentence, safe to show. */
  detail: z.string().max(300),
  /** The Hermes version that answered. */
  version: z.string().max(40).optional(),
});
export type HermesConnectionTestResult = z.infer<typeof HermesConnectionTestResult>;

/** What the owner sees of a stored connection: that it is there. Never the address or the token. */
export const HermesConnectionView = z.object({
  connected: z.boolean(),
  /** It continues a session the owner named instead of one of its own. */
  continuesSession: z.boolean(),
  updatedAt: z.number().int().nonnegative().optional(),
});
export type HermesConnectionView = z.infer<typeof HermesConnectionView>;
