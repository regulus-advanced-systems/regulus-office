/**
 * Top-right status box (research 03 §5): connection status from the
 * connection store, a usage summary (office totals from BuildingState;
 * placeholders until the server publishes them, SPEC §9.4) and the
 * first-person view toggle (SPEC §9.2).
 */
import type { UsageSummary } from "@regulus/protocol";
import { getOfficeClient } from "../../net/index.ts";
import { useBuildingStore } from "../../state/building.ts";
import { type ConnectionStatus, useConnectionStore } from "../../state/connection.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../Panel.tsx";
import { colors } from "../theme.ts";
import { formatCompact, formatUsd } from "./format.ts";
import { ViewToggle } from "./ViewToggle.tsx";

export const STATUS_COLOR: Readonly<Record<ConnectionStatus, string>> = {
  idle: colors.inkMuted,
  connecting: colors.amber,
  connected: colors.green,
  reconnecting: colors.amber,
  failed: colors.crimson,
  disconnected: colors.inkMuted,
};

export const STATUS_LABEL: Readonly<Record<ConnectionStatus, string>> = {
  idle: "Offline",
  connecting: "Connecting…",
  connected: "Online",
  reconnecting: "Reconnecting…",
  failed: "Connection failed",
  disconnected: "Disconnected",
};

export function ConnectionChip({
  status,
  attempt,
}: {
  status: ConnectionStatus;
  attempt?: number;
}) {
  return (
    <span className="rg-chip" aria-label={`connection ${status}`}>
      <span className="rg-chip__dot" style={{ background: STATUS_COLOR[status] }} />
      {STATUS_LABEL[status]}
      {attempt !== undefined && attempt > 0 && <span className="rg-muted">#{attempt}</span>}
    </span>
  );
}

export function UsageRows({ usage }: { usage: UsageSummary | null }) {
  const tokens = usage ? usage.todayInputTokens + usage.todayOutputTokens : null;
  return (
    <>
      <div className="rg-statusbox__row">
        <span className="rg-muted">Tokens today</span>
        <strong>{tokens === null ? "—" : formatCompact(tokens)}</strong>
      </div>
      <div className="rg-statusbox__row">
        <span className="rg-muted">Spend est.</span>
        <span className="rg-statusbox__cash">
          {usage ? formatUsd(usage.todayCostUsdEstimate) : "—"}
        </span>
      </div>
    </>
  );
}

export function StatusBox({
  status: statusProp,
  usage: usageProp,
}: {
  status?: ConnectionStatus;
  usage?: UsageSummary | null;
}) {
  const storeStatus = useConnectionStore((s) => s.status);
  const attempt = useConnectionStore((s) => s.attempt);
  const lastError = useConnectionStore((s) => s.lastError);
  const storeUsage = useBuildingStore((s) => s.state?.usage ?? null);
  const status = statusProp ?? storeStatus;
  const usage = usageProp === undefined ? storeUsage : usageProp;
  return (
    <Panel as="section" className="rg-statusbox" aria-label="Status">
      <div className="rg-statusbox__row">
        <ConnectionChip status={status} attempt={attempt} />
        {status === "failed" && (
          <Button size="sm" variant="secondary" onClick={() => void getOfficeClient().connect()}>
            Retry
          </Button>
        )}
      </div>
      {lastError && status === "failed" && (
        <div style={{ color: colors.crimson, fontSize: 12 }}>{lastError}</div>
      )}
      <UsageRows usage={usage} />
      <ViewToggle />
    </Panel>
  );
}
