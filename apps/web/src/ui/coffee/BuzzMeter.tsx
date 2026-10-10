/**
 * The buzz meter (#63): while the player has a coffee buzz, a small readout
 * at the bottom of the HUD with the cups taken, how much faster they move,
 * the seconds left and a bar that runs down; from the third cup it says
 * "Jitters". Nothing is drawn without a buzz. The bar is redrawn four times
 * a second in steps, with no transition and no pulsing, so it is the same
 * for people who asked for less motion.
 */
import { MAX_CUPS } from "@regulus/protocol";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { serverNow } from "../../audio/jukebox/useJukeboxPlayback.ts";
import { type BuzzMeterView, buzzMeter, selectSelfBuzz } from "../../scene/coffee/buzz.ts";
import { useBuildingStore } from "../../state/building.ts";
import { Panel } from "../Panel.tsx";
import "./coffee.css";

const TICK_MS = 250;

export function BuzzReadout({ view }: { view: BuzzMeterView }) {
  const cups = Array.from({ length: MAX_CUPS }, (_, i) => i < view.cups);
  const label = `Coffee buzz: ${view.cups} ${view.cups === 1 ? "cup" : "cups"}, ${view.boostPercent}% faster, ${view.seconds} seconds left${view.jitters ? ", jitters" : ""}`;
  return (
    <Panel as="section" className="rg-buzz" aria-label="Coffee buzz">
      <div className="rg-buzz__row">
        <span className="rg-buzz__cups" aria-hidden="true">
          {cups.map((full, i) => (
            <span key={i} className={full ? "rg-buzz__cup rg-buzz__cup--full" : "rg-buzz__cup"}>
              ☕
            </span>
          ))}
        </span>
        <span className="rg-buzz__text">
          +{view.boostPercent}% speed
          {view.jitters && <strong className="rg-buzz__jitters"> · Jitters</strong>}
        </span>
        <span className="rg-buzz__time">{view.seconds} s</span>
      </div>
      <div
        className="rg-buzz__bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(view.fraction * 100)}
      >
        <div className="rg-buzz__fill" style={{ width: `${(view.fraction * 100).toFixed(1)}%` }} />
      </div>
    </Panel>
  );
}

export function BuzzMeter({ now = serverNow }: { now?: () => number }) {
  const buzz = useBuildingStore(useShallow(selectSelfBuzz));
  const buzzed = (buzz?.cups ?? 0) > 0;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!buzzed) return;
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [buzzed]);
  const view = buzzMeter(buzz, now());
  return view ? <BuzzReadout view={view} /> : null;
}
