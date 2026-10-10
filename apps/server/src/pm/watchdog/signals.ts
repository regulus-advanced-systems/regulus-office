/**
 * A signal (#253): one thing the office read that the watchdog may judge, with
 * a key the office made, a summary in the office's words and numbered lines of
 * what it read. Signals are data handed to the model; everything that decides
 * what a finding *is* comes from here, not from what the model writes:
 *
 * - which fault it is: the key (`sentry:<org>/<SHORT-ID>`, `pm2:<appId>:...`);
 * - where it belongs: the room of the part the signal was handed out in;
 * - whether it is back: `regressed`, set by the office from Sentry's own
 *   record of the issue or from its own record of the error line;
 * - the evidence: the signal's lines, which a finding cites by number.
 */
import { WATCHDOG_LIMITS, type WatchdogFindingInput } from "@regulus/protocol";
import { ToolError } from "../tools/context.ts";
import type { NewSource } from "./findings.ts";

export interface Signal {
  key: string;
  kind: "sentry" | "pm2";
  /** `WEB-1A2`, or `api on prod-1`. */
  label: string;
  summary: string;
  lines: string[];
  /** Sentry only: the issue's page, the watched project it was read from, Sentry's id of it. */
  url?: string;
  project?: string;
  ref?: string;
  /** The office determined that a fault it knows is back: it gets a new verdict. */
  regressed: boolean;
}

/** The key a signal is stored under: with the room, so a target moved to another room starts anew there. */
export const storedKey = (key: string, operationId: string | null): string =>
  `${key}@${operationId ?? "office"}`;

/** A signal as the model is given it. */
export function signalView(signal: Signal, known?: { title: string; disposition: string }) {
  return {
    key: signal.key,
    from: signal.kind === "sentry" ? "Sentry" : "PM2",
    summary: signal.summary,
    lines: signal.lines.map((text, i) => ({ n: i + 1, text })),
    ...(signal.regressed
      ? { back: "judged before and back since; it needs a new verdict" }
      : known
        ? { known: known }
        : {}),
  };
}

export interface Cited {
  sources: NewSource[];
  /** The office's own text for the finding: each signal's summary and the lines that were cited. */
  evidence: string;
  /** At least one is a Sentry issue. */
  sentry: boolean;
}

const DEFAULT_LINES = 6;

/**
 * What a finding cites, checked against what this part was given. Throws a
 * {@link ToolError} for a key the office did not hand out in this part: the
 * model cannot make a key up, cite another room's signal or name a Sentry
 * issue the office did not read from a watched project.
 */
export function cite(
  handedOut: Readonly<Record<string, Signal>>,
  operationId: string | null,
  refs: WatchdogFindingInput["sources"],
): Cited {
  const sources: NewSource[] = [];
  const blocks: string[] = [];
  const seen = new Set<string>();
  // A Map: a key like `__proto__` or `constructor` names nothing the office handed out.
  const byKey = new Map(Object.entries(handedOut));
  for (const ref of refs) {
    const signal = byKey.get(ref.key);
    if (!signal) {
      throw new ToolError(
        "invalid_input",
        "that is not a signal key watchdog_check returned in this turn",
      );
    }
    if (seen.has(signal.key)) continue;
    seen.add(signal.key);
    const wanted = ref.lines?.length
      ? ref.lines
      : signal.lines.slice(0, DEFAULT_LINES).map((_, i) => i + 1);
    const lines = [...new Set(wanted)]
      .filter((n) => n >= 1 && n <= signal.lines.length)
      .slice(0, WATCHDOG_LIMITS.evidenceLinesMax)
      .map((n) => signal.lines[n - 1] ?? "");
    blocks.push([`${signal.label}: ${signal.summary}`, ...lines].join("\n"));
    sources.push({
      kind: signal.kind,
      key: storedKey(signal.key, operationId),
      label: signal.label,
      url: signal.url,
      project: signal.project,
      ref: signal.ref,
      regressed: signal.regressed,
    });
  }
  return {
    sources,
    evidence: blocks.join("\n\n"),
    sentry: sources.some((s) => s.kind === "sentry"),
  };
}
