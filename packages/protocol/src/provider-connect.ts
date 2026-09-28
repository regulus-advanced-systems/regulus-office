/**
 * "Connect providers" REST shapes (SPEC §5 `credential_profiles`, §7 login
 * column, §8 credential rules, D2).
 *
 * Two kinds of connection:
 *
 * - **CLI logins** (Claude subscription, ChatGPT for Codex): run by the
 *   unmodified CLI inside the human's own runner. The office starts the flow
 *   and shows the device code or the login terminal; it never sees a token.
 *   Whether a human is connected comes from the CLI's own status.
 * - **Key profiles** (API keys and plan keys, e.g. DeepSeek, Z.AI, Kimi):
 *   pasted once, stored encrypted, never returned. Requests may carry a key;
 *   responses never do.
 *
 * Office-wide keys (`owner: "office"`) are admin-only and limited to metered
 * providers: Anthropic API, OpenAI API, Gemini API, DeepSeek (SPEC §8 rule 3).
 * Subscription plans (Z.AI Coding Plan, Kimi Code plan) and CLI logins are
 * always personal.
 */
import { z } from "zod";
import { TimestampMs } from "./common.ts";
import { CREDENTIAL_PROFILE_OWNERS, CREDENTIAL_PROFILES_API_PATH } from "./credentials-api.ts";
import { CREDENTIAL_AUTH_KINDS, PROVIDER_IDS, type ProviderId } from "./enums.ts";

/** Base path of the credential profile REST resource (the spawn dialog's list is GET on it). */
export const CREDENTIAL_PROFILE_WRITE_PATH = CREDENTIAL_PROFILES_API_PATH;
/** CLI login status and flows. */
export const PROVIDER_LOGINS_API_PATH = "/api/provider-logins";
/** Terminal ids (`/ws/term/<id>`) of login sessions start with this; agent ids never do. */
export const LOGIN_TERMINAL_PREFIX = "login-";

// ---- Key presets -------------------------------------------------------------

export const KEY_PRESET_IDS = [
  "anthropic",
  "openai",
  "gemini",
  "deepseek",
  "zai",
  "kimi",
  "custom-claude",
  "custom-codex",
] as const;
export type KeyPresetId = (typeof KEY_PRESET_IDS)[number];

export interface KeyPreset {
  id: KeyPresetId;
  label: string;
  /** Agent the key is used with at spawn. */
  provider: ProviderId;
  authKind: "api_key" | "base_url_key";
  /** Fixed endpoint for base-URL presets; custom presets take one from the request. */
  baseUrl?: string;
  /** Model aliases applied at spawn (Claude Code `ANTHROPIC_*_MODEL`). */
  modelOverrides?: Readonly<Record<string, string>>;
  /** Pay-per-token provider: may be added as an office-wide key by an admin (D2). */
  metered: boolean;
  /** Short help shown next to the key field. */
  hint: string;
}

/**
 * Endpoints and model names from research 04 (DeepSeek, Kimi, Z.AI sections).
 * Codex has no base-URL preset: the Codex adapter speaks the Responses wire
 * API, which none of these plans document; `custom-codex` covers gateways.
 */
export const KEY_PRESETS: Readonly<Record<KeyPresetId, KeyPreset>> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic API key",
    provider: "claude-code",
    authKind: "api_key",
    metered: true,
    hint: "Claude Code billed per token to your Anthropic Console account (sk-ant-…).",
  },
  openai: {
    id: "openai",
    label: "OpenAI API key",
    provider: "codex",
    authKind: "api_key",
    metered: true,
    hint: "Codex billed per token to your OpenAI platform account (sk-…).",
  },
  gemini: {
    id: "gemini",
    label: "Gemini API key",
    provider: "gemini-cli",
    authKind: "api_key",
    metered: true,
    hint: "Gemini CLI with a Google AI Studio key.",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    provider: "claude-code",
    authKind: "base_url_key",
    baseUrl: "https://api.deepseek.com/anthropic",
    modelOverrides: {
      default: "deepseek-flash",
      opus: "deepseek-v4-pro",
      sonnet: "deepseek-flash",
      haiku: "deepseek-flash",
    },
    metered: true,
    hint: "Claude Code against DeepSeek's Anthropic-compatible API (pay per token).",
  },
  zai: {
    id: "zai",
    label: "Z.AI GLM Coding Plan",
    provider: "claude-code",
    authKind: "base_url_key",
    baseUrl: "https://api.z.ai/api/anthropic",
    metered: false,
    hint: "Claude Code on your Z.AI GLM Coding Plan key. Personal only.",
  },
  kimi: {
    id: "kimi",
    label: "Kimi Code plan",
    provider: "claude-code",
    authKind: "base_url_key",
    baseUrl: "https://api.kimi.com/coding/",
    modelOverrides: { default: "k3-256k" },
    metered: false,
    hint: "Claude Code on your Kimi Code plan key. Personal only.",
  },
  "custom-claude": {
    id: "custom-claude",
    label: "Other Anthropic-compatible endpoint",
    provider: "claude-code",
    authKind: "base_url_key",
    metered: false,
    hint: "Any https endpoint Claude Code can use as ANTHROPIC_BASE_URL. Not verified.",
  },
  "custom-codex": {
    id: "custom-codex",
    label: "Other Responses-API endpoint (Codex)",
    provider: "codex",
    authKind: "base_url_key",
    metered: false,
    hint: "Any https endpoint Codex can use as a custom model provider. Not verified.",
  },
};

export const isOfficeKeyPreset = (id: KeyPresetId): boolean => KEY_PRESETS[id].metered;

/** The preset a stored profile corresponds to (by provider, kind and base URL). */
export function presetForProfile(profile: {
  provider: ProviderId;
  authKind: string;
  baseUrl: string | null;
}): KeyPresetId | null {
  for (const preset of Object.values(KEY_PRESETS)) {
    if (preset.provider !== profile.provider || preset.authKind !== profile.authKind) continue;
    if (preset.authKind === "api_key") return preset.id;
    if (preset.baseUrl && preset.baseUrl === profile.baseUrl) return preset.id;
  }
  if (profile.authKind !== "base_url_key") return null;
  if (profile.provider === "claude-code") return "custom-claude";
  if (profile.provider === "codex") return "custom-codex";
  return null;
}

// ---- Key profile requests ------------------------------------------------------

/** An API or plan key as pasted: printable ASCII without spaces. */
export const ProviderApiKey = z
  .string()
  .trim()
  .min(8)
  .max(1024)
  .regex(/^[\x21-\x7e]+$/, "must be printable ASCII without spaces");

/** A custom base URL: https, no credentials, no query or fragment. */
export const ProviderBaseUrl = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.hostname.length > 0
      );
    } catch {
      return false;
    }
  }, "must be an https URL without credentials, query or fragment");

export const CreateKeyProfileRequest = z
  .object({
    preset: z.enum(KEY_PRESET_IDS),
    label: z.string().trim().min(1).max(80),
    apiKey: ProviderApiKey,
    /** Only for the `custom-*` presets. */
    baseUrl: ProviderBaseUrl.optional(),
    /** `office`: an office-wide key (owner/admin only, metered presets only). */
    owner: z.enum(CREDENTIAL_PROFILE_OWNERS).default("me"),
  })
  .strict();
export type CreateKeyProfileRequest = z.input<typeof CreateKeyProfileRequest>;

/**
 * Re-verify a stored profile. The key is entered again: SPEC §8 rule 2 lets
 * the office decrypt a stored key only at spawn time, so verification uses
 * the key as typed and, on success, replaces the stored one.
 */
export const VerifyKeyProfileRequest = z.object({ apiKey: ProviderApiKey }).strict();
export type VerifyKeyProfileRequest = z.input<typeof VerifyKeyProfileRequest>;

/**
 * Result of a verify call: `ok` (2xx), `rejected` (401/403: the key is wrong),
 * `unreachable` (timeout, network, other status) or `unsupported` (no known
 * verify endpoint, e.g. a custom base URL).
 */
export const KEY_VERIFY_OUTCOMES = ["ok", "rejected", "unreachable", "unsupported"] as const;
export type KeyVerifyOutcome = (typeof KEY_VERIFY_OUTCOMES)[number];

/** A key profile as the panel shows it. Never carries the key or its envelope. */
export const KeyProfileInfo = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().max(200),
    provider: z.enum(PROVIDER_IDS),
    authKind: z.enum(CREDENTIAL_AUTH_KINDS),
    preset: z.enum(KEY_PRESET_IDS).nullable(),
    owner: z.enum(CREDENTIAL_PROFILE_OWNERS),
    /** Host of the base URL (base-URL profiles), for telling custom endpoints apart. */
    baseUrlHost: z.string().max(300).nullable(),
    verifiedAt: TimestampMs.nullable(),
    createdAt: TimestampMs,
  })
  .strict();
export type KeyProfileInfo = z.infer<typeof KeyProfileInfo>;

export const KeyProfileWriteResponse = z.object({
  profile: KeyProfileInfo,
  verification: z.enum(KEY_VERIFY_OUTCOMES),
});
export type KeyProfileWriteResponse = z.infer<typeof KeyProfileWriteResponse>;

export const KeyProfileListResponse = z.object({ profiles: z.array(KeyProfileInfo) });
export type KeyProfileListResponse = z.infer<typeof KeyProfileListResponse>;

// ---- CLI logins ------------------------------------------------------------------

/** Providers whose subscription login the office can drive (SPEC §7 login column). */
export const CLI_LOGIN_PROVIDERS = ["claude-code", "codex"] as const;
export type CliLoginProvider = (typeof CLI_LOGIN_PROVIDERS)[number];
export const isCliLoginProvider = (value: string): value is CliLoginProvider =>
  (CLI_LOGIN_PROVIDERS as readonly string[]).includes(value);

export const ProviderLoginStatus = z.object({
  provider: z.enum(CLI_LOGIN_PROVIDERS),
  /** From the CLI's own status in the runner; null when it could not be checked. */
  connected: z.boolean().nullable(),
  checkedAt: TimestampMs,
});
export type ProviderLoginStatus = z.infer<typeof ProviderLoginStatus>;

export const ProviderLoginStatusResponse = z.object({ providers: z.array(ProviderLoginStatus) });
export type ProviderLoginStatusResponse = z.infer<typeof ProviderLoginStatusResponse>;

export const LOGIN_FLOW_STATES = [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
] as const;
export type LoginFlowState = (typeof LOGIN_FLOW_STATES)[number];

/** A running (or finished) CLI login flow, visible only to the human who started it. */
export const LoginFlowInfo = z.object({
  loginId: z.string().min(1).max(64),
  provider: z.enum(CLI_LOGIN_PROVIDERS),
  kind: z.enum(["device_code", "pty_paste_code"]),
  state: z.enum(LOGIN_FLOW_STATES),
  /** Device code flow: where to approve, and the code to enter there. */
  verificationUrl: z.string().max(500).optional(),
  userCode: z.string().max(64).optional(),
  /** Terminal flow: open `/ws/term/<terminalId>` in control mode. */
  terminalId: z.string().max(80).optional(),
  instructions: z.string().max(1000).optional(),
  /** Short, token-free reason when the flow failed. */
  reason: z.string().max(300).optional(),
  expiresAt: TimestampMs,
});
export type LoginFlowInfo = z.infer<typeof LoginFlowInfo>;
