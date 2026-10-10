/**
 * The watchdog's verdict as a comment on the Sentry issue (#253, D30): the
 * disposition, the reason and the pull request, where the people who work in
 * Sentry will see it. A comment is all it leaves there: it never resolves,
 * ignores or assigns an issue.
 *
 * Which issue: only one the office itself read from a watched project
 * (`sources.project` and `sources.ref`, Sentry's own id, both set by check.ts),
 * and only while that project is still watched. Nothing the model wrote names
 * the issue that is commented on.
 *
 * One comment per verdict: a finding is `pending` once when it is recorded
 * and once more each time the office finds the fault is back, and a comment
 * that could not be posted is tried again when the next round ends.
 */
import { WATCHDOG_DISPOSITION_LABELS } from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import { sentryConnection } from "./check.ts";
import type { FindingRow, FindingStore } from "./findings.ts";
import type { SentryApi } from "./sentry-api.ts";
import type { WatchdogStore } from "./store.ts";

/** The comment's text (Sentry renders Markdown). The reason is the model's words, named as such. */
export function verdictComment(finding: FindingRow, agentName: string): string {
  const lines = [
    `**${agentName} (Regulus Office watchdog, automated): ${WATCHDOG_DISPOSITION_LABELS[finding.disposition]}**`,
    finding.reason,
  ];
  if (finding.disposition === "propose_fix") {
    lines.push(
      finding.fixPrUrl
        ? `Draft pull request: ${finding.fixPrUrl}`
        : "A fix is proposed; a draft pull request follows once a person has agreed to it.",
    );
  }
  lines.push(
    "The watchdog does not resolve issues. Resolve this one yourself when it is dealt with.",
  );
  return lines.join("\n\n");
}

export interface SentryNotesDeps {
  store: WatchdogStore;
  findings: FindingStore;
  sentry: SentryApi;
  agentName: () => string;
  logger: Logger;
}

export class SentryNotes {
  #flushing = false;

  constructor(private readonly deps: SentryNotesDeps) {}

  /** Comments that failed before get another try. */
  retryFailed(): void {
    for (const finding of this.deps.findings.withComment("failed")) {
      this.deps.findings.patch(finding.id, { sentryComment: "pending" });
    }
  }

  /** Post every pending verdict. Never throws. */
  async flush(): Promise<void> {
    if (this.#flushing) return;
    this.#flushing = true;
    try {
      const { store, findings, logger } = this.deps;
      const pending = findings.withComment("pending");
      if (pending.length === 0) return;
      const conn = sentryConnection(store);
      const watched = new Set(store.sentryProjects().map((p) => p.slug));
      for (const finding of pending) {
        const issues = findings
          .sources([finding.id])
          .filter((s) => s.kind === "sentry" && s.ref !== null && s.project !== null)
          // Never an issue of a project that is not watched (any more).
          .filter((s) => watched.has(s.project as string));
        if (issues.length === 0) {
          findings.patch(finding.id, { sentryComment: "none" });
          continue;
        }
        if (!conn) {
          findings.patch(finding.id, { sentryComment: "failed" });
          continue;
        }
        let ok = true;
        for (const issue of issues) {
          try {
            await this.deps.sentry.comment(
              conn,
              issue.ref as string,
              verdictComment(finding, this.deps.agentName()),
            );
          } catch (err) {
            ok = false;
            logger.warn(
              {
                findingId: finding.id,
                code: err instanceof Error ? err.message.slice(0, 40) : "error",
              },
              "watchdog verdict not posted to Sentry",
            );
          }
        }
        findings.patch(finding.id, { sentryComment: ok ? "posted" : "failed" });
      }
    } catch (err) {
      this.deps.logger.error({ err: String(err).slice(0, 200) }, "watchdog sentry notes failed");
    } finally {
      this.#flushing = false;
    }
  }
}
