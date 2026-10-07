/**
 * The lift ride on screen (#269): while a ride is on (state/lift.ts) the
 * lift's two door leaves close over the view, the indicator shows the level
 * the lift left and then the one it reaches, and the doors open on the new
 * level's landing. The low graphics preset gets a plain dip to dark instead,
 * and reduced motion no ride at all (the level simply changes). Plain DOM
 * and CSS above the canvas; it takes no input and never traps focus. A
 * polite live region says where the player arrived, ride or not.
 */
import { type CSSProperties, useMemo } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { levelLabelOf } from "../../state/level.ts";
import { useLiftStore } from "../../state/lift.ts";
import "./lift.css";

export function LiftRide() {
  const ride = useLiftStore((s) => s.ride);
  const arrivedAt = useLiftStore((s) => s.arrivedAt);
  const levels = useBuildingStore((s) => s.state?.levels);
  const state = useMemo(() => ({ levels }), [levels]);
  const shown = ride ? levelLabelOf(state, ride.arrived ? ride.to : ride.from) : null;
  const arrived = arrivedAt ? levelLabelOf(state, arrivedAt) : null;
  return (
    <>
      {ride && (
        <div
          className="rg-lift-ride"
          data-style={ride.style}
          data-testid="lift-ride"
          aria-hidden="true"
          style={{ "--rg-lift-ride-ms": `${ride.durationMs}ms` } as CSSProperties}
        >
          <div className="rg-lift-ride__leaf" data-side="left" />
          <div className="rg-lift-ride__leaf" data-side="right" />
          <div className="rg-lift-ride__indicator">
            <span className="rg-lift-ride__mark">{shown?.mark ?? ""}</span>
            <span className="rg-lift-ride__name">{shown?.title ?? ""}</span>
          </div>
        </div>
      )}
      <p className="rg-sr-only" role="status" aria-live="polite" data-testid="lift-arrived">
        {arrived ? `The lift arrived: ${arrived.title}.` : ""}
      </p>
    </>
  );
}
