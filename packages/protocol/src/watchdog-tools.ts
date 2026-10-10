/**
 * The office tools of the watchdog (#253, D30). They are part of the one tool
 * list in office-agent-tools.ts (same transports, same audit) and exist only
 * for an agent whose job is `watchdog`.
 *
 * Two kinds, told apart by the server from the token the call comes with:
 *
 * - **round tools** (`roundTurn`): `watchdog_check`, `watchdog_record_finding`,
 *   `watchdog_finish_round`. They work only in a turn the office gave the
 *   watchdog for one part of a round (one room's targets), which has a token
 *   of its own. In such a turn the watchdog has these three tools and no
 *   other: no memory, no note, no chat, no question to a person.
 * - **conversation tools**: `watchdog_request_round`, `watchdog_read_report`,
 *   for the person whose message it is answering (the office knows who from
 *   the turn's token; the tools take no person).
 *
 * In a round the watchdog writes a title, a reason, a proposed change and a
 * summary. Everything else in a finding is the office's: which fault it is
 * (signal keys the office handed out), where it belongs, whether it is back,
 * and the evidence (lines of those signals, by number).
 */
import { z } from "zod";
import { WATCHDOG_DISPOSITIONS, WATCHDOG_LIMITS } from "./watchdog.ts";

const SignalRef = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .describe("A signal's key, exactly as watchdog_check returned it in this turn."),
  lines: z
    .array(z.number().int().min(1).max(500))
    .max(WATCHDOG_LIMITS.evidenceLinesMax)
    .optional()
    .describe(
      "The numbers of that signal's lines that show the fault best. The office keeps these lines as the evidence; you do not write evidence yourself.",
    ),
});

export const WatchdogFindingInput = z.object({
  title: z.string().trim().min(1).max(WATCHDOG_LIMITS.titleMax).describe("The fault in one line."),
  sources: z
    .array(SignalRef)
    .min(1)
    .max(WATCHDOG_LIMITS.sourcesMax)
    .describe(
      "The signals that are this fault. A Sentry issue and a PM2 signal that are the same fault go into one finding.",
    ),
  disposition: z
    .enum(WATCHDOG_DISPOSITIONS)
    .describe(
      "dismiss: noise or a known third-party failure. notify: a person should look. propose_fix: you can say what change in the code fixes it.",
    ),
  reason: z.string().trim().min(1).max(WATCHDOG_LIMITS.reasonMax).describe("Why that disposition."),
  fix: z
    .string()
    .trim()
    .max(WATCHDOG_LIMITS.reasonMax)
    .optional()
    .describe("For propose_fix: the change you propose, for the henchman that will write it."),
});
export type WatchdogFindingInput = z.infer<typeof WatchdogFindingInput>;

export const WatchdogFinishInput = z.object({
  summary: z
    .string()
    .trim()
    .min(1)
    .max(WATCHDOG_LIMITS.summaryMax)
    .describe("This part of the round in a few lines: what you found, or that nothing is new."),
});
export type WatchdogFinishInput = z.infer<typeof WatchdogFinishInput>;

/** Input schemas by tool name, spread into `OFFICE_TOOL_INPUTS`. */
export const WATCHDOG_TOOL_INPUTS = {
  watchdog_check: z.object({}),
  watchdog_record_finding: WatchdogFindingInput,
  watchdog_finish_round: WatchdogFinishInput,
  // For the person whose message is being answered: the office knows who from the turn.
  watchdog_request_round: z.object({}),
  watchdog_read_report: z.object({}),
} as const;

/** The round tools: only in a turn the office gave the watchdog for a round. */
export const WATCHDOG_ROUND_TOOLS = [
  "watchdog_check",
  "watchdog_record_finding",
  "watchdog_finish_round",
] as const;
export type WatchdogRoundTool = (typeof WATCHDOG_ROUND_TOOLS)[number];
export const isWatchdogRoundTool = (name: string): name is WatchdogRoundTool =>
  (WATCHDOG_ROUND_TOOLS as readonly string[]).includes(name);

/** Their entries in `OFFICE_TOOLS`. */
export const WATCHDOG_TOOL_SPECS = [
  {
    name: "watchdog_check",
    title: "Read what there is to judge",
    description:
      "The office reads this turn's targets (one room's Sentry projects and PM2 apps, read-only) and returns what is new since the last round as signals: each with a key, a summary and numbered lines. Call it first.",
    preset: "observer",
    readOnly: true,
    role: "watchdog",
    roundTurn: true,
  },
  {
    name: "watchdog_record_finding",
    title: "Record a finding",
    description:
      "Record one fault: the signals that are it, exactly one disposition (dismiss, notify or propose_fix) and why. A fault already recorded is not recorded twice.",
    preset: "observer",
    readOnly: false,
    role: "watchdog",
    roundTurn: true,
  },
  {
    name: "watchdog_finish_round",
    title: "Finish",
    description:
      "End this part of the round with a short summary. The office then tells the people concerned.",
    preset: "observer",
    readOnly: false,
    role: "watchdog",
    roundTurn: true,
  },
  {
    name: "watchdog_request_round",
    title: "Ask for a round",
    description:
      "A person asks you to do a round now: the office starts one in turns of its own (not in this conversation), if that person may ask for one.",
    preset: "observer",
    readOnly: false,
    role: "watchdog",
    roundTurn: false,
  },
  {
    name: "watchdog_read_report",
    title: "Read a person their report",
    description:
      "The last rounds and the findings as the person who asked may see them. Use it to answer a person who asks how production is doing.",
    preset: "observer",
    readOnly: true,
    role: "watchdog",
    roundTurn: false,
  },
] as const;
