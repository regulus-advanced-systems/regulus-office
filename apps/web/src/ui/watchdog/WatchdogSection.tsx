/**
 * "Watchdog" in Settings (#253, D30), for everyone: what the watchdog henchman
 * found on its rounds, to each person within the rooms they may see. Owners
 * and admins also get "Do a round now" and, below, what it watches
 * (WatchdogSetup.tsx).
 *
 * The list reloads when the office says a round ended with findings for this
 * person (`watchdog.report`), and every half minute while a round is under way.
 */
import {
  WATCHDOG_REPORT_MESSAGE,
  type WatchdogFindingView,
  type WatchdogReport,
} from "@regulus/protocol";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getOfficeClient } from "../../net/index.ts";
import { selectOperations, useBuildingStore } from "../../state/building.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { createWatchdogApi, describeWatchdogError, type WatchdogApi } from "./api.ts";
import { FindingCard, RoundList, when } from "./WatchdogFindings.tsx";
import { WatchdogSetup } from "./WatchdogSetup.tsx";
import "./watchdog.css";

const defaultApi = createWatchdogApi();
const POLL_MS = 30_000;

type Nudges = (type: string, listener: () => void) => () => void;
const liveNudges: Nudges = (type, listener) => {
  try {
    return getOfficeClient().onBuildingMessage(type, listener);
  } catch {
    // No connection to the office (yet): the list still loads, it just is not nudged.
    return () => {};
  }
};

function statusLine(report: WatchdogReport): string {
  if (!report.agent) return "No watchdog is on duty.";
  if (!report.configured) return `${report.agent.name} has nothing to watch yet.`;
  if (report.running) return `${report.agent.name} is on its round now.`;
  if (report.agent.stoppedByPerson) {
    return `${report.agent.name} was stopped by a person: no rounds on the schedule until it is started again or a round is asked for.`;
  }
  if (!report.enabled) return `${report.agent.name} is off duty: rounds only when asked.`;
  const next = report.nextRoundAt;
  if (next === undefined) return `${report.agent.name} is on duty.`;
  const minutes = Math.max(0, Math.round((next - Date.now()) / 60_000));
  return `${report.agent.name} is on duty. Next round ${minutes <= 1 ? "any moment" : `in about ${minutes} min`}.`;
}

export interface WatchdogSectionProps {
  api?: WatchdogApi;
  onNudge?: Nudges;
}

export function WatchdogSection({ api = defaultApi, onNudge = liveNudges }: WatchdogSectionProps) {
  const operations = useBuildingStore(useShallow(selectOperations));
  const [report, setReport] = useState<WatchdogReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const load = useCallback(async () => {
    const res = await api.report();
    if (!res.ok) return setError(describeWatchdogError(res));
    setReport(res.data);
  }, [api]);

  useEffect(() => {
    void load();
    return onNudge(WATCHDOG_REPORT_MESSAGE, () => void load());
  }, [load, onNudge]);

  const running = report?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const roomName = (operationId: string | null) =>
    operationId === null
      ? "No room"
      : (operations.find((o) => o.operationId === operationId)?.name ?? "A room");

  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const failed = await fn();
    setBusy(false);
    if (failed) setError(failed);
    await load();
  };
  const runNow = () =>
    act(async () => {
      const res = await api.runNow();
      return res.ok ? null : describeWatchdogError(res);
    });
  const decide = (finding: WatchdogFindingView, decision: "open" | "decline") =>
    act(async () => {
      const res = await api.decideFix(finding.id, decision);
      return res.ok ? null : describeWatchdogError(res);
    });

  const noise = (finding: WatchdogFindingView, on: boolean) =>
    act(async () => {
      const res = await api.markNoise(finding.id, on);
      return res.ok ? null : describeWatchdogError(res);
    });

  const findings = report?.findings ?? [];
  const loud = findings.filter((f) => f.disposition !== "dismiss");
  const dismissed = findings.filter((f) => f.disposition === "dismiss");

  return (
    <div className="rg-settings__stack">
      <section className="rg-settings__group" aria-label="Watchdog report">
        <h3 className="rg-settings__heading">Watchdog</h3>
        <div className="rg-field__hint">
          A henchman that watches production: new and regressed Sentry issues, and PM2 restarts and
          error logs on the hosts. The office reads them; the watchdog judges what it is given and
          reports. People resolve issues and merge fixes.
        </div>
        {report === null ? (
          !error && <p className="rg-muted">Loading…</p>
        ) : (
          <>
            <div className="rg-settings__row">
              <span className="rg-settings__grow" role="status" aria-live="polite">
                {statusLine(report)}
              </span>
              {report.canRunNow && (
                <Button
                  size="sm"
                  disabled={busy || report.running || !report.configured}
                  onClick={() => void runNow()}
                >
                  Do a round now
                </Button>
              )}
            </div>
            <h4 className="rg-watchdog__sub">Findings</h4>
            {loud.length === 0 ? (
              <p className="rg-muted">
                Nothing that needs you
                {report.rounds[0] ? `, as of ${when(report.rounds[0].startedAt)}` : ""}.
              </p>
            ) : (
              <ul className="rg-list" aria-label="Findings">
                {loud.map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    roomName={roomName}
                    busy={busy}
                    onDecide={decide}
                    onNoise={noise}
                  />
                ))}
              </ul>
            )}
            {dismissed.length > 0 && (
              <>
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-expanded={showDismissed}
                    onClick={() => setShowDismissed((v) => !v)}
                  >
                    {showDismissed ? "Hide" : "Show"} {dismissed.length} dismissed
                  </Button>
                </div>
                {showDismissed && (
                  <ul className="rg-list" aria-label="Dismissed findings">
                    {dismissed.map((f) => (
                      <FindingCard
                        key={f.id}
                        finding={f}
                        roomName={roomName}
                        busy={busy}
                        onDecide={decide}
                        onNoise={noise}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
            <h4 className="rg-watchdog__sub">Rounds</h4>
            <RoundList rounds={report.rounds.slice(0, 8)} />
          </>
        )}
        {error && <FormAlert>{error}</FormAlert>}
      </section>
      {report?.canConfigure && <WatchdogSetup api={api} onChanged={load} />}
    </div>
  );
}
