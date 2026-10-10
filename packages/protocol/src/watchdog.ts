/**
 * The watchdog henchman (SPEC §10 M5, D30; #253): a shared office agent that
 * does a round every 60 minutes, and on request. For a round **the office**
 * reads
 *
 * - new and regressed **Sentry** issues of the watched projects, over
 *   Sentry's REST API;
 * - **PM2** state and error logs on the configured hosts, over SSH with a
 *   read-only user and two fixed commands;
 *
 * and hands what it read to the watchdog as *signals*: data with keys the
 * office made. The watchdog judges: every fault gets exactly one disposition,
 * `dismiss`, `notify` or `propose_fix`. It never resolves a Sentry issue and
 * never changes anything on a host. A proposed fix becomes a **draft** pull
 * request only: by default after a person says yes (`ask`), or unasked when
 * an admin switched that on (`auto`).
 *
 * Who sees what (D26, D27): a finding belongs to the room its Sentry project
 * or PM2 app is mapped to, and only people whose own GitHub access opens that
 * room see it. A finding of an unmapped target is for office owners and
 * admins, who configured the target. A round is done one room at a time: no
 * turn of the watchdog ever holds two rooms' data. Targets and keys are for
 * office owners and admins; an SSH key and the Sentry token go in and never
 * come out. Report shapes are in watchdog-report.ts.
 */
import { z } from "zod";
import { Id, ModelName, TimestampMs } from "./common.ts";
import { PROVIDER_IDS } from "./enums.ts";

export const WATCHDOG_API_PATH = "/api/watchdog";
/** Owners and admins: targets, keys, the fix rule. */
export const WATCHDOG_SETTINGS_API_PATH = `${WATCHDOG_API_PATH}/settings`;
export const WATCHDOG_HOSTS_API_PATH = `${WATCHDOG_API_PATH}/hosts`;
export const WATCHDOG_SENTRY_PROJECTS_API_PATH = `${WATCHDOG_API_PATH}/sentry-projects`;
export const WATCHDOG_ROUNDS_API_PATH = `${WATCHDOG_API_PATH}/rounds`;
export const watchdogHostPath = (id: string) =>
  `${WATCHDOG_HOSTS_API_PATH}/${encodeURIComponent(id)}`;
/** POST: an admin accepts the key a host now shows in place of the pinned one. */
export const watchdogHostKeyPath = (id: string) => `${watchdogHostPath(id)}/accept-key`;
/** POST `{ decision }`: open the draft PR for a proposed fix, or not. */
export const watchdogFixPath = (findingId: string) =>
  `${WATCHDOG_API_PATH}/findings/${encodeURIComponent(findingId)}/fix`;
/** POST `{ noise }`: a person marks a fault as known noise (always dismissed), or takes that back. */
export const watchdogNoisePath = (findingId: string) =>
  `${WATCHDOG_API_PATH}/findings/${encodeURIComponent(findingId)}/noise`;

/**
 * POST: the findings this person was not told of yet, as a count, and they
 * count as told from then on. A client asks when it connects, so a finding
 * made while a person was away is told when they are back.
 */
export const WATCHDOG_NEWS_API_PATH = `${WATCHDOG_API_PATH}/news`;

/** BuildingRoom server→client, to one person: a round ended with findings they may see. */
export const WATCHDOG_REPORT_MESSAGE = "watchdog.report";
/** BuildingRoom server→client, to owners and admins: a watched host needs them. */
export const WATCHDOG_ALERT_MESSAGE = "watchdog.alert";

export const WATCHDOG_DISPOSITIONS = ["dismiss", "notify", "propose_fix"] as const;
export type WatchdogDisposition = (typeof WATCHDOG_DISPOSITIONS)[number];
export const WATCHDOG_DISPOSITION_LABELS: Readonly<Record<WatchdogDisposition, string>> = {
  dismiss: "Dismissed",
  notify: "Needs a look",
  propose_fix: "Fix proposed",
};

export const WATCHDOG_ROUND_TRIGGERS = ["schedule", "manual", "chat"] as const;
export type WatchdogRoundTrigger = (typeof WATCHDOG_ROUND_TRIGGERS)[number];
export const WATCHDOG_ROUND_STATES = ["pending", "running", "done", "failed"] as const;
export type WatchdogRoundState = (typeof WATCHDOG_ROUND_STATES)[number];
/** Whose targets one part of a round reads: one room's, or those without a room. */
export const WATCHDOG_SCOPES = ["room", "office"] as const;
export type WatchdogScope = (typeof WATCHDOG_SCOPES)[number];

/** D30: `ask` (default) waits for a person; `auto` opens the draft PR unasked. */
export const WATCHDOG_FIX_MODES = ["ask", "auto"] as const;
export type WatchdogFixMode = (typeof WATCHDOG_FIX_MODES)[number];

export const WATCHDOG_FIX_STATES = [
  /** Not a `propose_fix` finding. */
  "none",
  /** No room is mapped to the target, so there is no repo to fix. */
  "unavailable",
  "awaiting_approval",
  "declined",
  /** A henchman has the task. */
  "queued",
  /** The draft pull request is open. */
  "pr_open",
  "failed",
] as const;
export type WatchdogFixState = (typeof WATCHDOG_FIX_STATES)[number];

export const WATCHDOG_SOURCE_KINDS = ["sentry", "pm2"] as const;
export type WatchdogSourceKind = (typeof WATCHDOG_SOURCE_KINDS)[number];

/** The verdict as a comment on the Sentry issue (the owner resolves; the watchdog never does). */
export const WATCHDOG_COMMENT_STATES = ["none", "pending", "posted", "failed"] as const;
export type WatchdogCommentState = (typeof WATCHDOG_COMMENT_STATES)[number];

export const WATCHDOG_LIMITS = {
  /** D30: every 60 minutes. */
  defaultIntervalMinutes: 60,
  minIntervalMinutes: 15,
  maxIntervalMinutes: 24 * 60,
  hostsMax: 20,
  appsPerHostMax: 30,
  sentryProjectsMax: 50,
  titleMax: 160,
  reasonMax: 1000,
  summaryMax: 2000,
  sourcesMax: 8,
  /** Lines of one signal a finding may cite. */
  evidenceLinesMax: 12,
  /** An OpenSSH private key is a few kB; a certificate chain is not expected. */
  privateKeyMax: 16_384,
  hostKeyMax: 2000,
  tokenMax: 400,
  /** Fixes `auto` may start without a person: per round and per 24 hours. */
  autoFixPerRoundDefault: 1,
  autoFixPerDayDefault: 3,
  autoFixCapMax: 20,
  /** Rounds and findings one report returns. */
  roundsPage: 20,
  findingsPage: 100,
} as const;

// ---- Values people type ------------------------------------------------------

/** A host name or an IP address; never an option (`-oProxyCommand=...`). */
export const WatchdogHostName = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9]([A-Za-z0-9.:-]*[A-Za-z0-9])?$/, "a host name or IP address");
export const WatchdogSshUser = z
  .string()
  .trim()
  .regex(/^[a-z_][a-z0-9_-]{0,31}$/, "a Linux user name");
/** A PM2 process name as it is passed to `pm2 logs`: no spaces, no shell characters. */
export const WatchdogAppName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/, "a PM2 app name");
export const SentrySlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,99}$/, "a Sentry slug");
/** `sentry.io`, `de.sentry.io` or a self-hosted host. */
export const SentryHost = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/, "a host name");
/** One `known_hosts` line or several: `host keytype base64`. Public, not a secret. */
export const WatchdogHostKey = z
  .string()
  .trim()
  .max(WATCHDOG_LIMITS.hostKeyMax)
  .refine(
    (v) =>
      v === "" ||
      v
        .split("\n")
        .every((line) =>
          /^\S+ (ssh-|ecdsa-|sk-)[A-Za-z0-9@.-]+ [A-Za-z0-9+/=]+( .*)?$/.test(line.trim()),
        ),
    { message: "known_hosts lines, as ssh-keyscan prints them" },
  );
const PrivateKey = z
  .string()
  .max(WATCHDOG_LIMITS.privateKeyMax)
  .refine(
    (v) =>
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(v) && /-----END [A-Z ]*PRIVATE KEY-----/.test(v),
    { message: "a private key in PEM or OpenSSH format" },
  );

// ---- Settings (owners and admins) --------------------------------------------

/** `operationId`: the room this target belongs to (who may see its findings, where a fix goes). */
const Mapping = Id.nullable().optional();

export const WatchdogAppInput = z.object({
  name: WatchdogAppName,
  /** Left out: keep the room it has; null: no room. */
  operationId: Mapping,
});
export const SaveWatchdogHost = z.object({
  label: z.string().trim().min(1).max(60),
  host: WatchdogHostName,
  port: z.number().int().min(1).max(65535).default(22),
  username: WatchdogSshUser,
  /**
   * For a new host, and for one whose address or port changes (another
   * machine). Empty: the key the host shows on first contact is stored as its
   * pin. On any other change this field is not read: a pin is replaced only
   * by "accept new key".
   */
  hostKey: WatchdogHostKey.default(""),
  /**
   * Write-only. Required for a new host; left out on a change keeps the stored
   * key. An admin who is not the office owner gives it again to add an app to
   * the host or to change its address: the stored copy is not theirs to point
   * at something new.
   */
  privateKey: PrivateKey.optional(),
  apps: z.array(WatchdogAppInput).max(WATCHDOG_LIMITS.appsPerHostMax),
});
export type SaveWatchdogHost = z.input<typeof SaveWatchdogHost>;

const SentryToken = z.string().trim().min(8).max(WATCHDOG_LIMITS.tokenMax);

export const SetWatchdogSentryProjects = z.object({
  projects: z
    .array(z.object({ slug: SentrySlug, operationId: Mapping }))
    .max(WATCHDOG_LIMITS.sentryProjectsMax),
  /**
   * Write-only; replaces the stored token. An admin who is not the office
   * owner gives it to add a project while a token is stored.
   */
  sentryToken: SentryToken.optional(),
});
export type SetWatchdogSentryProjects = z.input<typeof SetWatchdogSentryProjects>;

const AutoFixCap = z.number().int().min(0).max(WATCHDOG_LIMITS.autoFixCapMax);

export const UpdateWatchdogSettings = z
  .object({
    enabled: z.boolean(),
    /** The shared office agent with the `watchdog` job that does the rounds; null: nobody. */
    agentId: Id.nullable(),
    intervalMinutes: z
      .number()
      .int()
      .min(WATCHDOG_LIMITS.minIntervalMinutes)
      .max(WATCHDOG_LIMITS.maxIntervalMinutes),
    fixMode: z.enum(WATCHDOG_FIX_MODES),
    /** What the henchman that writes a fix runs on (a stronger model than the rounds'). */
    fixProvider: z.enum(PROVIDER_IDS),
    fixModel: ModelName,
    autoFixPerRound: AutoFixCap,
    autoFixPerDay: AutoFixCap,
    /** Changing it removes the stored token, unless a token comes with it. */
    sentryHost: SentryHost,
    sentryOrganization: SentrySlug.or(z.literal("")),
    /** Write-only. null removes the stored token. */
    sentryToken: SentryToken.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to change" });
export type UpdateWatchdogSettings = z.input<typeof UpdateWatchdogSettings>;

const MappingView = {
  /** Null when no room is mapped, and when the mapped room is not one the viewer can see. */
  operationId: Id.nullable(),
  /** A room is mapped that the viewer cannot see: nothing about it is told, and it cannot be changed. */
  operationHidden: z.boolean(),
  /**
   * False: nobody watches it. It is kept because whoever stopped watching it
   * could not see its room; only someone who can see that room watches it again.
   */
  watched: z.boolean(),
};

export const WatchdogHostView = z.object({
  id: Id,
  label: z.string(),
  host: z.string(),
  port: z.number().int(),
  username: z.string(),
  /** Whether a private key is stored. Never the key. */
  hasKey: z.boolean(),
  /** The host's pinned public key, as fingerprints (`SHA256:...`); empty until first contact. */
  pinned: z.array(z.string()),
  /** How the pin came to be. `none`: not yet verified, the first contact will be trusted. */
  pinnedBy: z.enum(["given", "learned", "accepted", "none"]),
  /** The host now shows another key: its fingerprints. Checks fail until an admin accepts it. */
  offered: z.array(z.string()),
  offeredAt: TimestampMs.optional(),
  apps: z.array(z.object({ id: Id, name: z.string(), ...MappingView })),
});
export type WatchdogHostView = z.infer<typeof WatchdogHostView>;

export const WatchdogSettingsView = z.object({
  enabled: z.boolean(),
  agentId: Id.nullable(),
  /** The shared agents with the `watchdog` job that can do rounds, to pick from. */
  agents: z.array(z.object({ id: Id, name: z.string() })),
  intervalMinutes: z.number().int(),
  fixMode: z.enum(WATCHDOG_FIX_MODES),
  fixProvider: z.enum(PROVIDER_IDS),
  fixModel: z.string(),
  autoFixPerRound: z.number().int(),
  autoFixPerDay: z.number().int(),
  /** `auto` runs fixes in the name of the admin who switched it on. */
  autoFixBy: z.object({ userId: Id, displayName: z.string() }).nullable(),
  sentry: z.object({
    host: z.string(),
    organization: z.string(),
    /** Whether a token is stored. Never the token. */
    hasToken: z.boolean(),
    projects: z.array(z.object({ id: Id, slug: z.string(), ...MappingView })),
  }),
  hosts: z.array(WatchdogHostView),
  /** False without OFFICE_MASTER_KEY: keys and tokens cannot be stored. */
  canStore: z.boolean(),
});
export type WatchdogSettingsView = z.infer<typeof WatchdogSettingsView>;

// ---- Pure rules shared by the server and the UI --------------------------------

/** The key that makes a Sentry issue one signal across rounds, deliveries and restarts. */
export function sentrySourceKey(organization: string, issue: string): string {
  return `sentry:${organization.toLowerCase()}/${issue.toUpperCase()}`;
}

export function watchdogIntervalLabel(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? "every hour" : `every ${minutes / 60} hours`;
  return `every ${minutes} minutes`;
}
