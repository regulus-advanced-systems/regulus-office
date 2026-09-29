/**
 * Top-centre HUD (research 03 §5): wide white rounded box with the office
 * name in light type, the current floor beneath, and a clock on the right.
 * On a floor the user manages, a "Floor settings" button sits by its name.
 */
import { useEffect, useState } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { GearIcon } from "../components/icons.tsx";
import { canManageFloor, floorSettingsOverlay } from "../floors/floorSettings.ts";
import { Panel } from "../Panel.tsx";
import { currentFloorName } from "./floorName.ts";
import { formatClock, msUntilNextMinute } from "./format.ts";

/** Office name: server-provided later; until then an env override or the default. */
export const OFFICE_NAME: string =
  (import.meta.env.VITE_OFFICE_NAME as string | undefined)?.trim() || "Regulus Office";

/** Re-render on each whole minute so the clock stays right without ticking every second. */
export function useClock(now: () => number = Date.now): Date {
  const [date, setDate] = useState(() => new Date(now()));
  useEffect(() => {
    let handle: ReturnType<typeof setTimeout>;
    const arm = () => {
      handle = setTimeout(() => {
        setDate(new Date(now()));
        arm();
      }, msUntilNextMinute(now()));
    };
    arm();
    return () => clearTimeout(handle);
  }, [now]);
  return date;
}

export function TopBar({
  officeName = OFFICE_NAME,
  floorName,
  date,
}: {
  officeName?: string;
  floorName?: string;
  date?: Date;
}) {
  const floors = useBuildingStore((s) => s.state?.floors ?? null);
  const floorId = useFloorStore((s) => s.floorId);
  const hour12 = useUiStore((s) => s.settings.hour12);
  const clock = useClock();
  const manages = useFloorsStore((s) => canManageFloor(s.floors, floorId));
  const openOverlay = useUiStore((s) => s.openOverlay);
  const shownFloor = floorName ?? currentFloorName(floors, floorId);
  return (
    <Panel as="header" className="rg-topbar" aria-label="Office">
      <div>
        <div className="rg-topbar__office">{officeName}</div>
        <div className="rg-topbar__floorline">
          <div className="rg-topbar__floor">{shownFloor}</div>
          {manages && floorId && (
            <Button
              variant="ghost"
              size="sm"
              aria-haspopup="dialog"
              icon={<GearIcon />}
              onClick={() => openOverlay(floorSettingsOverlay(floorId))}
            >
              Floor settings
            </Button>
          )}
        </div>
      </div>
      <time className="rg-topbar__clock" dateTime={(date ?? clock).toISOString()}>
        {formatClock(date ?? clock, { hour12 })}
      </time>
    </Panel>
  );
}
