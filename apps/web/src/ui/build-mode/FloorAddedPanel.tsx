/**
 * The new room's status after it is placed (#187): a docked, non-modal
 * panel so the build stays in view. It counts down the build phase, lists
 * the repos' clone status (Go to room once built), and offers Add people…
 * straight away, as the Add floor dialog did before build mode.
 */
import { useEffect, useId, useState } from "react";
import { useCompoundStore } from "../../state/compound.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { createFloorsApi, type FloorsApi } from "../floors/api.ts";
import { CloneStatusList } from "../floors/CloneStatus.tsx";
import { floorSettingsOverlay } from "../floors/floorSettings.ts";
import { Panel } from "../Panel.tsx";
import { buildProgress, formatRemaining } from "./progress.ts";
import { useBuildModeStore } from "./store.ts";
import "./build-mode.css";

const defaultApi = createFloorsApi();

/** Re-render once a second while `on`. */
function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

export function FloorAddedPanel({
  floorId,
  api = defaultApi,
}: {
  floorId: string;
  api?: FloorsApi;
}) {
  const room = useCompoundStore((s) => s.world?.rooms.find((r) => r.id === floorId));
  const openOverlay = useUiStore((s) => s.openOverlay);
  const close = useBuildModeStore((s) => s.closeAdded);
  const building = room?.buildState === "building";
  const now = useTick(building);
  const title = useId();
  const progress = room ? buildProgress(room.id, room.buildEndsAt, now, building) : null;
  return (
    <div role="dialog" aria-modal="false" aria-labelledby={title} className="rg-dock">
      <Panel title={<span id={title}>Operation set up</span>}>
        {/* Announced when the state changes, not every second. */}
        <div role="status" aria-live="polite" className="rg-muted" style={{ fontSize: 13 }}>
          {!room
            ? "Laying the foundations…"
            : building
              ? `Henchmen are building ${room.name}.`
              : `${room.name} is built.`}
        </div>
        {building && (
          <div className="rg-muted" style={{ fontSize: 13 }} data-testid="build-remaining">
            {(progress?.remainingMs ?? 0) > 0
              ? `${formatRemaining(progress?.remainingMs ?? 0)} left`
              : "Almost done"}
          </div>
        )}
        {room && (
          <div
            className="rg-build__progress"
            role="progressbar"
            aria-label="Build progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((building ? (progress?.fraction ?? 0) : 1) * 100)}
          >
            <span style={{ width: `${(building ? (progress?.fraction ?? 0) : 1) * 100}%` }} />
          </div>
        )}
        <CloneStatusList floorId={floorId} api={api} onRide={close} />
        <div className="rg-dock__actions">
          <Button
            variant="secondary"
            aria-haspopup="dialog"
            onClick={() => {
              close();
              openOverlay(floorSettingsOverlay(floorId));
            }}
          >
            Add people…
          </Button>
          <Button variant="secondary" onClick={close}>
            Done
          </Button>
        </div>
      </Panel>
    </div>
  );
}
