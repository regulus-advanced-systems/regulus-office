/**
 * Top-centre HUD (research 03 §5): wide white rounded box with the office
 * name in light type, where the player is beneath (the room, the corridors;
 * #186), and a clock on the right. In a room the user manages, a "Operation
 * settings" button sits by its name; in any project room, "Workflows" opens
 * its GitHub workflows and run history (#155).
 */
import { useEffect, useState } from "react";
import { useOperationStore } from "../../state/operation.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { GearIcon } from "../components/icons.tsx";
import { canManageOperation, operationSettingsOverlay } from "../operations/operationSettings.ts";
import { Panel } from "../Panel.tsx";
import { openWorkflowsPanel } from "../workflows/WorkflowsPanel.tsx";
import { formatClock, msUntilNextMinute } from "./format.ts";
import { useLocationName } from "./operationName.ts";

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
  operationName,
  date,
}: {
  officeName?: string;
  operationName?: string;
  date?: Date;
}) {
  const operationId = useOperationStore((s) => s.operationId);
  const location = useLocationName();
  const hour12 = useUiStore((s) => s.settings.hour12);
  const clock = useClock();
  const manages = useOperationsStore((s) => canManageOperation(s.operations, operationId));
  const openOverlay = useUiStore((s) => s.openOverlay);
  const shownOperation = operationName ?? location;
  return (
    <Panel as="header" className="rg-topbar" aria-label="Office">
      <div>
        <div className="rg-topbar__office">{officeName}</div>
        <div className="rg-topbar__operationline">
          <div className="rg-topbar__operation">{shownOperation}</div>
          {manages && operationId && (
            <Button
              variant="ghost"
              size="sm"
              aria-haspopup="dialog"
              icon={<GearIcon />}
              onClick={() => openOverlay(operationSettingsOverlay(operationId))}
            >
              Operation settings
            </Button>
          )}
          {operationId && (
            <Button
              variant="ghost"
              size="sm"
              aria-haspopup="dialog"
              onClick={() => openWorkflowsPanel(operationId)}
            >
              Workflows
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
