/**
 * The watchdog's report as one person may see it (#253): rounds and findings,
 * the push that says a round ended, and what a person decides about a finding.
 * Everything here is filtered per viewer by the server (D26, D27).
 */
import { z } from "zod";
import { GhNumber, Id, TimestampMs } from "./common.ts";
import { OFFICE_AGENT_STATUSES } from "./office-agents.ts";
import {
  WATCHDOG_COMMENT_STATES,
  WATCHDOG_DISPOSITIONS,
  WATCHDOG_FIX_STATES,
  WATCHDOG_ROUND_STATES,
  WATCHDOG_ROUND_TRIGGERS,
  WATCHDOG_SOURCE_KINDS,
} from "./watchdog.ts";

export const WatchdogSourceView = z.object({
  kind: z.enum(WATCHDOG_SOURCE_KINDS),
  /** `WEB-1A2` for Sentry; `api on prod-1` for PM2. */
  label: z.string(),
  /** Sentry only: the issue's page. */
  url: z.string().optional(),
});

export const WatchdogFindingView = z.object({
  id: Id,
  /** The watchdog's words. */
  title: z.string(),
  /** What the office read: lines of the log or the Sentry issue, as the office handed them out. */
  evidence: z.string(),
  disposition: z.enum(WATCHDOG_DISPOSITIONS),
  /** The watchdog's words. */
  reason: z.string(),
  operationId: Id.nullable(),
  sources: z.array(WatchdogSourceView),
  firstSeenAt: TimestampMs,
  lastSeenAt: TimestampMs,
  /** Rounds that met it again without a new verdict. */
  seenCount: z.number().int().nonnegative(),
  regressions: z.number().int().nonnegative(),
  /** A person marked it as known noise: it stays dismissed whatever comes back. */
  noise: z.boolean(),
  /** The viewer may mark it as noise or take that back. */
  canMarkNoise: z.boolean(),
  fix: z.object({
    state: z.enum(WATCHDOG_FIX_STATES),
    summary: z.string(),
    /** Started without a person, by the `auto` setting. */
    auto: z.boolean(),
    prNumber: GhNumber.optional(),
    prUrl: z.string().optional(),
    error: z.string().optional(),
    /** The viewer may say yes or no to the draft PR (they may queue work in that room). */
    canDecide: z.boolean(),
  }),
  sentryComment: z.enum(WATCHDOG_COMMENT_STATES),
});
export type WatchdogFindingView = z.infer<typeof WatchdogFindingView>;

export const WatchdogRoundView = z.object({
  id: Id,
  trigger: z.enum(WATCHDOG_ROUND_TRIGGERS),
  state: z.enum(WATCHDOG_ROUND_STATES),
  startedAt: TimestampMs,
  finishedAt: TimestampMs.optional(),
  /** New or regressed findings of this round that the viewer may see. */
  findingIds: z.array(Id),
  /**
   * The watchdog's own words, one per room the viewer can see now (and the
   * one about targets without a room, for owners and admins).
   */
  summaries: z.array(z.string()),
  /** Why a round failed, in the office's words; names no target. */
  error: z.string().optional(),
});
export type WatchdogRoundView = z.infer<typeof WatchdogRoundView>;

export const WatchdogReport = z.object({
  /** An agent is chosen and at least one target is set. */
  configured: z.boolean(),
  enabled: z.boolean(),
  agent: z
    .object({
      id: Id,
      name: z.string(),
      status: z.enum(OFFICE_AGENT_STATUSES),
      /**
       * A person stopped it (#301): the schedule starts no round until someone
       * starts it again or asks for a round.
       */
      stoppedByPerson: z.boolean(),
    })
    .nullable(),
  running: z.boolean(),
  nextRoundAt: TimestampMs.optional(),
  rounds: z.array(WatchdogRoundView),
  findings: z.array(WatchdogFindingView),
  /** The viewer may start a round with the button (owners and admins). */
  canRunNow: z.boolean(),
  canConfigure: z.boolean(),
});
export type WatchdogReport = z.infer<typeof WatchdogReport>;

export const WatchdogReportPush = z.object({
  roundId: Id,
  /** Findings the recipient may see; always at least one. */
  findings: z.number().int().positive(),
  agentName: z.string().max(40),
});
export type WatchdogReportPush = z.infer<typeof WatchdogReportPush>;

/** What `WATCHDOG_NEWS_API_PATH` answers: how many findings the person had not been told of. */
export const WatchdogNews = z.object({
  findings: z.number().int().min(0),
  agentName: z.string().max(40),
});
export type WatchdogNews = z.infer<typeof WatchdogNews>;

/** To owners and admins: the key of a watched host changed. Names the host, which they set up. */
export const WatchdogAlertPush = z.object({
  kind: z.literal("host_key_changed"),
  hostId: Id,
  hostLabel: z.string().max(60),
});
export type WatchdogAlertPush = z.infer<typeof WatchdogAlertPush>;

export const DecideWatchdogFix = z.object({ decision: z.enum(["open", "decline"]) });
export type DecideWatchdogFix = z.infer<typeof DecideWatchdogFix>;

export const MarkWatchdogNoise = z.object({ noise: z.boolean() });
export type MarkWatchdogNoise = z.infer<typeof MarkWatchdogNoise>;
