/**
 * HUD usage panel (#40, SPEC §9.4): the viewer's own plan windows and spend,
 * plus the office totals and today's top robots (name and owner only).
 * Unfolds inside the status box; opened from its "Usage" button or by
 * clicking a usage screen in the world.
 * Shows usage only; nothing is capped (D13).
 */
import { useEffect, useState } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { buildUsageModel, type LimitRow } from "./model.ts";
import { useMyUsageStore } from "./usageStore.ts";
import "./usage.css";

function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function LimitBar({ row }: { row: LimitRow }) {
  return (
    <li className="rg-usage__limit">
      <div className="rg-usage__limit-head">
        <span>{row.label}</span>
        <strong>{Math.round(row.pct)}%</strong>
      </div>
      <div
        className="rg-usage__bar"
        role="meter"
        aria-label={row.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(row.pct)}
      >
        <span
          className={`rg-usage__fill rg-usage__fill--${row.tone}`}
          style={{ width: `${row.pct}%` }}
        />
      </div>
      {row.detail && <div className="rg-muted rg-usage__detail">{row.detail}</div>}
    </li>
  );
}

export function UsagePanel() {
  const open = useMyUsageStore((s) => s.panelOpen);
  const mine = useMyUsageStore((s) => s.mine);
  const office = useBuildingStore((s) => s.state?.usage ?? null);
  const now = useMinuteClock();
  if (!open) return null;
  const m = buildUsageModel(mine, office, now);
  return (
    <section className="rg-usage" aria-label="Usage">
      <h2 className="rg-usage__title">Usage</h2>
      <h3 className="rg-usage__h">Your plan windows</h3>
      {m.limits.length > 0 ? (
        <ul className="rg-usage__limits">
          {m.limits.map((row) => (
            <LimitBar key={row.key} row={row} />
          ))}
        </ul>
      ) : (
        <p className="rg-muted rg-usage__empty">
          {m.mineLoaded ? "No plan windows reported yet." : "Loading…"}
        </p>
      )}
      <h3 className="rg-usage__h">Your spend (estimate)</h3>
      <div className="rg-statusbox__row">
        <span className="rg-muted">Today</span>
        <span className="rg-statusbox__cash">{m.myTodayUsd}</span>
      </div>
      <div className="rg-statusbox__row">
        <span className="rg-muted">Tokens today</span>
        <strong>{m.myTodayTokens}</strong>
      </div>
      <div className="rg-statusbox__row">
        <span className="rg-muted">Last 7 days</span>
        <span>{m.my7dUsd}</span>
      </div>
      {m.byProvider.map((p) => (
        <div key={p.label} className="rg-statusbox__row rg-usage__sub">
          <span className="rg-muted">{p.label}</span>
          <span>
            {p.usd} · {p.tokens}
          </span>
        </div>
      ))}
      <h3 className="rg-usage__h">Office today</h3>
      <div className="rg-statusbox__row">
        <span className="rg-muted">Spend est.</span>
        <span className="rg-statusbox__cash">{m.officeTodayUsd}</span>
      </div>
      <div className="rg-statusbox__row">
        <span className="rg-muted">Office keys</span>
        <span>{m.officeKeysUsd}</span>
      </div>
      <div className="rg-statusbox__row">
        <span className="rg-muted">Tokens · humans</span>
        <span>
          {m.officeTodayTokens} · {m.activeHumans}
        </span>
      </div>
      {m.top.length > 0 && (
        <>
          <h3 className="rg-usage__h">Top henchmen</h3>
          <ol className="rg-usage__top">
            {m.top.map((r) => (
              <li key={r.key}>
                <span>{r.name}</span>
                <strong>{r.tokens}</strong>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="rg-muted rg-usage__note">
        Estimates at API prices{m.pricesAsOf ? ` (checked ${m.pricesAsOf})` : ""}. Shown only, never
        capped.
      </p>
    </section>
  );
}
