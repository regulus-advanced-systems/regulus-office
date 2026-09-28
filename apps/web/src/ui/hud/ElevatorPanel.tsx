/** Elevator list (SPEC §9.1): floors with name and busy counts; click rides to the floor. */
import { getOfficeClient } from "../../net/index.ts";
import { selectFloors, useBuildingStore } from "../../state/building.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useSessionStore } from "../../state/session.ts";
import { Panel } from "../Panel.tsx";

export function ElevatorPanel() {
  const floors = useBuildingStore(selectFloors);
  const currentFloor = useFloorStore((s) => s.floorId);
  const session = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  return (
    <Panel as="nav" title="Elevator" aria-label="Elevator">
      {floors.length === 0 && <div className="rg-muted">No floors yet</div>}
      <ul className="rg-list">
        {floors.map((floor) => (
          <li key={floor.floorId}>
            <button
              type="button"
              className="rg-list__item"
              aria-current={floor.floorId === currentFloor ? "true" : undefined}
              onClick={() => void getOfficeClient().goToFloor(floor.floorId)}
            >
              <span>
                {floor.index}. {floor.name}
              </span>
              <span className="rg-muted">
                {floor.robotsWorking}/{floor.robotsTotal} busy
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="rg-muted" style={{ fontSize: 12, marginTop: 6 }}>
        {session === "authenticated" && user ? `${user.displayName} (${user.role})` : session}
      </div>
    </Panel>
  );
}
