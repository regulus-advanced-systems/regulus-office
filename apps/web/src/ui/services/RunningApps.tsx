/**
 * "Running apps" (SPEC §9.4, #39): the dev servers robots on this floor run,
 * with an Open button that goes through the office's authenticated proxy
 * (`/p/<floor>/a/<agent>/port/<n>/`, a new tab). Hidden while there are none.
 */
import { useMemo } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { useSessionStore } from "../../state/session.ts";
import { buttonClassName } from "../components/Button.tsx";
import { Panel } from "../Panel.tsx";
import { type AppRow, appRows, LOCALHOST_HINT } from "./runningApps.ts";
import "./services.css";

function OpenCell({ row }: { row: AppRow }) {
  if (row.open === "control" || row.open === "watch") {
    return (
      <a
        className={buttonClassName({ variant: "primary", size: "sm" })}
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${row.title}`}
      >
        Open
      </a>
    );
  }
  const why =
    row.open === "localhost"
      ? LOCALHOST_HINT
      : "Only the henchman's owner can open it here. Shared previews need the office's app domain (OFFICE_SERVICES_DOMAIN).";
  return (
    <button
      type="button"
      className={buttonClassName({ variant: "secondary", size: "sm" })}
      disabled
      title={why}
      aria-label={`Open ${row.title} (unavailable)`}
    >
      Open
    </button>
  );
}

export function RunningAppsList({ rows }: { rows: AppRow[] }) {
  return (
    <ul className="rg-list rg-apps">
      {rows.map((row) => (
        <li key={row.id} className="rg-apps__row">
          <div className="rg-apps__text">
            <strong className="rg-apps__title">{row.title}</strong>
            <span className="rg-muted">
              {row.robot} · :{row.port}
            </span>
            {row.open === "localhost" && (
              <span className="rg-apps__note" data-kind="localhost">
                localhost only: bind 0.0.0.0 (<code>--host</code>)
              </span>
            )}
            {row.open === "watch" && (
              <span className="rg-apps__note" data-kind="watch">
                read-only
              </span>
            )}
            {row.open === "owner_only" && (
              <span className="rg-apps__note" data-kind="owner">
                owner only
              </span>
            )}
          </div>
          <OpenCell row={row} />
        </li>
      ))}
    </ul>
  );
}

export function RunningApps() {
  const state = useFloorStore((s) => s.state);
  const user = useSessionStore((s) => s.user);
  const rows = useMemo(() => appRows(state, user), [state, user]);
  if (rows.length === 0) return null;
  return (
    <Panel as="section" title="Running apps" aria-label="Running apps">
      <RunningAppsList rows={rows} />
    </Panel>
  );
}
