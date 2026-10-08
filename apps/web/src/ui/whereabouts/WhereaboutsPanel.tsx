/**
 * Who's where (#49): a HUD panel listing every human in the office with
 * the room or zone they are in (lobby, a room's name, a corridor, the
 * beach) and what they are doing. Clicking a name walks there through the
 * compound (state/walkToTeammate.ts), stopping at the door of a room the
 * viewer may not enter. The list re-renders only when someone changes
 * place or status, not on every step (rowsKey).
 */
import { useCallback, useId, useMemo, useState } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { walkToTeammate } from "../../state/walkToTeammate.ts";
import { Panel } from "../Panel.tsx";
import {
  BEHIND_CLOSED_DOOR,
  rowsKey,
  type WhereaboutsRow,
  whereaboutsRows,
} from "./whereabouts.ts";
import "./whereabouts.css";

/** What the status line says after a click. */
function walkNotice(row: WhereaboutsRow, result: ReturnType<typeof walkToTeammate>): string {
  switch (result) {
    case "walking":
      return `Walking to ${row.name}.`;
    case "door":
      return row.place.label === BEHIND_CLOSED_DOOR
        ? `${row.name} is behind a closed door: walking to it.`
        : `${row.name} is in ${row.place.label}, which you may not enter: walking to its door.`;
    case "here":
      return `You are already next to ${row.name}.`;
    case "unreachable":
      return `No way to ${row.name} from here.`;
    default:
      return "Not in the office yet.";
  }
}

export function WhereaboutsPanel() {
  const world = useCompoundStore((s) => s.world);
  const key = useBuildingStore((s) => rowsKey(whereaboutsRows(s.state, world, s.sessionId)));
  // Rebuilt only when the key changes (someone moved place or changed status).
  const rows = useMemo(() => {
    const s = useBuildingStore.getState();
    return whereaboutsRows(s.state, world, s.sessionId);
  }, [key, world]);
  const [collapsed, setCollapsed] = useState(false);
  const [notice, setNotice] = useState("");
  const ids = { heading: useId(), body: useId() };

  const walk = useCallback((row: WhereaboutsRow) => {
    setNotice(walkNotice(row, walkToTeammate(row.sessionId)));
  }, []);

  return (
    <Panel as="section" flush className="rg-where" aria-labelledby={ids.heading}>
      <div className="rg-where__header">
        <h2 id={ids.heading} className="rg-where__title">
          Who's where
        </h2>
        <span className="rg-where__count" title="Humans in the office">
          {rows.length}
        </span>
        <button
          type="button"
          className="rg-where__toggle"
          aria-expanded={!collapsed}
          aria-controls={ids.body}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? "Show" : "Hide"}
          <span className="rg-sr-only"> who's where</span>
        </button>
      </div>
      <div id={ids.body} hidden={collapsed}>
        <ul className="rg-where__list" data-testid="whereabouts">
          {rows.map((row) => (
            <li key={row.sessionId} className="rg-where__row" data-session={row.sessionId}>
              {row.self ? (
                <span className="rg-where__name">
                  {row.name} <span className="rg-muted">(you)</span>
                </span>
              ) : (
                <button
                  type="button"
                  className="rg-where__name rg-where__walk"
                  title={`Walk to ${row.name}`}
                  onClick={() => walk(row)}
                >
                  {row.name}
                  <span className="rg-sr-only">: walk there</span>
                </button>
              )}
              <span className="rg-where__place" data-zone={row.place.zone}>
                {row.place.label}
                {row.doing && <span className="rg-where__doing"> · {row.doing}</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="rg-where__notice" role="status" aria-live="polite">
          {notice}
        </p>
      </div>
    </Panel>
  );
}
