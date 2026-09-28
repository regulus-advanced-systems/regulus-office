import { getOfficeClient } from "../net/index.ts";
import { selectFloors, useBuildingStore } from "../state/building.ts";
import { type ConnectionStatus, useConnectionStore } from "../state/connection.ts";
import { useFloorStore } from "../state/floor.ts";
import { useSessionStore } from "../state/session.ts";
import { Panel } from "./Panel.tsx";
import { colors } from "./theme.ts";

const statusColor: Record<ConnectionStatus, string> = {
  idle: colors.inkMuted,
  connecting: colors.amber,
  connected: colors.cyan,
  reconnecting: colors.amber,
  failed: colors.crimson,
  disconnected: colors.inkMuted,
};

/** Minimal HUD: connection chip, who we are, elevator list. Real panels come with M1+. */
export function Hud() {
  const status = useConnectionStore((s) => s.status);
  const attempt = useConnectionStore((s) => s.attempt);
  const lastError = useConnectionStore((s) => s.lastError);
  const session = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const floors = useBuildingStore(selectFloors);
  const currentFloor = useFloorStore((s) => s.floorId);

  return (
    <div style={{ position: "absolute", top: 12, left: 12, display: "grid", gap: 8, width: 260 }}>
      <Panel style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-label={`connection ${status}`}
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: statusColor[status],
              display: "inline-block",
            }}
          />
          <strong>{status}</strong>
          {attempt > 0 && <span style={{ color: colors.inkMuted }}>retry {attempt}</span>}
          {status === "failed" && (
            <button type="button" onClick={() => void getOfficeClient().connect()}>
              retry
            </button>
          )}
        </div>
        {lastError && <div style={{ color: colors.crimson, fontSize: 12 }}>{lastError}</div>}
        <div style={{ color: colors.inkMuted, fontSize: 12, marginTop: 4 }}>
          {session === "authenticated" && user ? `${user.displayName} (${user.role})` : session}
        </div>
      </Panel>
      <Panel style={{ padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Elevator</div>
        {floors.length === 0 && <div style={{ color: colors.inkMuted }}>No floors yet</div>}
        {floors.map((floor) => (
          <button
            type="button"
            key={floor.floorId}
            onClick={() => void getOfficeClient().goToFloor(floor.floorId)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "6px 8px",
              marginBottom: 4,
              border: `1px solid ${floor.floorId === currentFloor ? colors.blue : colors.panelBorder}`,
              borderRadius: 6,
              background: floor.floorId === currentFloor ? "#EAF2FF" : "#fff",
              cursor: "pointer",
            }}
          >
            {floor.index}. {floor.name}{" "}
            <span style={{ color: colors.inkMuted }}>
              {floor.robotsWorking}/{floor.robotsTotal} busy
            </span>
          </button>
        ))}
      </Panel>
    </div>
  );
}
