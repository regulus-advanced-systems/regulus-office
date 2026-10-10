/**
 * The watchdog's report as one person may see it (#253): its last rounds and
 * its findings, each with the evidence, the verdict and why. A proposed fix
 * waits here for a yes or a no from someone who may queue work in that room.
 * Nothing here resolves a Sentry issue: the link opens it, and people do.
 */
import {
  WATCHDOG_DISPOSITION_LABELS,
  type WatchdogFindingView,
  type WatchdogFixState,
  type WatchdogReport,
  type WatchdogRoundView,
} from "@regulus/protocol";
import { Button } from "../components/Button.tsx";

const TRIGGERS: Readonly<Record<WatchdogRoundView["trigger"], string>> = {
  schedule: "on schedule",
  manual: "asked for here",
  chat: "asked for in chat",
};

const FIX_LINES: Readonly<Record<WatchdogFixState, string>> = {
  none: "",
  unavailable: "A fix was proposed, but this target has no room, so there is no repo to put it in.",
  awaiting_approval: "A fix is proposed. It becomes a draft pull request once someone agrees.",
  declined: "The proposed fix was declined.",
  queued: "A henchman is writing the fix. The draft pull request opens when it is done.",
  pr_open: "The fix is a draft pull request.",
  failed: "The fix did not get to a pull request.",
};

const COMMENT_LINES: Readonly<Record<WatchdogFindingView["sentryComment"], string>> = {
  none: "",
  pending: "Its verdict will be posted on the Sentry issue.",
  posted:
    "Its verdict is a comment on the Sentry issue. Resolve the issue there when it is dealt with.",
  failed:
    "Its verdict could not be posted on the Sentry issue; it is tried again after the next round.",
};

export function when(ts: number, now = Date.now()): string {
  const minutes = Math.round((now - ts) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(ts).toLocaleDateString();
}

function roundLine(round: WatchdogRoundView): string {
  if (round.state === "pending" || round.state === "running") return "On its round now…";
  if (round.state === "failed") return `Did not finish: ${round.error ?? "no reason given"}.`;
  const n = round.findingIds.length;
  return n === 0 ? "Nothing new." : `${n} finding${n === 1 ? "" : "s"}.`;
}

export interface FindingProps {
  finding: WatchdogFindingView;
  roomName: (operationId: string | null) => string;
  busy: boolean;
  onDecide: (finding: WatchdogFindingView, decision: "open" | "decline") => void;
  onNoise: (finding: WatchdogFindingView, noise: boolean) => void;
}

export function FindingCard({ finding, roomName, busy, onDecide, onNoise }: FindingProps) {
  const { fix } = finding;
  return (
    <li className={`rg-watchdog-finding rg-watchdog-finding--${finding.disposition}`}>
      <div className="rg-watchdog-finding__head">
        <span className="rg-chip">{WATCHDOG_DISPOSITION_LABELS[finding.disposition]}</span>
        <strong className="rg-settings__grow">{finding.title}</strong>
        <span className="rg-muted">
          {roomName(finding.operationId)} · {when(finding.lastSeenAt)}
        </span>
      </div>
      <p>{finding.reason}</p>
      <details>
        <summary>Evidence</summary>
        <pre className="rg-watchdog-finding__evidence">{finding.evidence}</pre>
      </details>
      <div className="rg-field__hint">
        Seen in{" "}
        {finding.sources.map((source, i) => (
          <span key={`${source.kind}:${source.label}`}>
            {i > 0 && ", "}
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer noopener">
                Sentry {source.label}
              </a>
            ) : (
              `PM2 ${source.label}`
            )}
          </span>
        ))}
        {finding.seenCount > 0 &&
          ` · met again ${finding.seenCount} time${finding.seenCount === 1 ? "" : "s"}`}
        {finding.regressions > 0 &&
          ` · came back ${finding.regressions} time${finding.regressions === 1 ? "" : "s"}`}
      </div>
      {COMMENT_LINES[finding.sentryComment] && (
        <div className="rg-field__hint">{COMMENT_LINES[finding.sentryComment]}</div>
      )}
      {fix.state !== "none" && (
        <div className="rg-watchdog-finding__fix">
          <div>
            {FIX_LINES[fix.state]}{" "}
            {fix.prUrl && (
              <a href={fix.prUrl} target="_blank" rel="noreferrer noopener">
                Draft pull request #{fix.prNumber}
              </a>
            )}
          </div>
          {fix.auto && (
            <div className="rg-field__hint">
              Started automatically: nobody read this finding before a henchman began.
            </div>
          )}
          {fix.summary && <div className="rg-field__hint">Proposed: {fix.summary}</div>}
          {fix.error && <div className="rg-field__hint">Note: {fix.error}.</div>}
          {fix.canDecide && (
            <div className="rg-settings__row">
              <Button
                size="sm"
                disabled={busy}
                aria-label={`Open a draft pull request for ${finding.title}`}
                onClick={() => onDecide(finding, "open")}
              >
                Open a draft pull request
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                aria-label={`Decline the fix for ${finding.title}`}
                onClick={() => onDecide(finding, "decline")}
              >
                No fix
              </Button>
              <span className="rg-field__hint">
                A henchman writes it in your name, on your own credentials.
              </span>
            </div>
          )}
        </div>
      )}
      {finding.noise && (
        <div className="rg-field__hint">
          Marked as known noise by a person: it stays dismissed, and nobody is told when it comes
          back.
        </div>
      )}
      {finding.canMarkNoise && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-label={`${finding.noise ? "Stop dismissing" : "Always dismiss"} ${finding.title}`}
            onClick={() => onNoise(finding, !finding.noise)}
          >
            {finding.noise ? "Stop dismissing this" : "Known noise: always dismiss"}
          </Button>
        </div>
      )}
    </li>
  );
}

export function RoundList({ rounds }: { rounds: WatchdogReport["rounds"] }) {
  if (rounds.length === 0) return <p className="rg-muted">No rounds yet.</p>;
  return (
    <ul className="rg-list rg-watchdog-rounds" aria-label="Rounds">
      {rounds.map((round) => (
        <li key={round.id} className={`rg-watchdog-round rg-watchdog-round--${round.state}`}>
          <span className="rg-muted">
            {when(round.startedAt)}, {TRIGGERS[round.trigger]}
          </span>{" "}
          <span>{roundLine(round)}</span>
          {round.summaries.map((summary) => (
            <div key={summary} className="rg-field__hint">
              {summary}
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}
