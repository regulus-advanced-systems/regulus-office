/**
 * Per-floor work counters (SPEC §9.3, research 03 §5): GDT's coloured circles
 * with a 2 px outline and the count inside, each with a small label tab.
 * Totals are the floor's robots' `bubbleEmits`; bubbles still in the air are
 * held back so each counter ticks up when its bubble lands.
 */
import { useShallow } from "zustand/react/shallow";
import {
  BUBBLE_COLORS,
  BUBBLE_KINDS,
  BUBBLE_LABELS,
  type BubbleDelta,
  sumBubbleEmits,
  zeroDelta,
} from "../../scene/robots/bubbles/bubbleEmits.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useWorkBubbles } from "../../state/workBubbles.ts";
import { formatCompact } from "./format.ts";
import { registerCounterAnchor } from "./workCounterAnchors.ts";

export function shownCounts(totals: BubbleDelta, inFlight: BubbleDelta): BubbleDelta {
  const out = zeroDelta();
  for (const kind of BUBBLE_KINDS) out[kind] = Math.max(0, totals[kind] - inFlight[kind]);
  return out;
}

export function WorkCounters() {
  const totals = useFloorStore(
    useShallow((s) => (s.state ? sumBubbleEmits(Object.values(s.state.robots)) : null)),
  );
  const inFlight = useWorkBubbles((s) => s.inFlight);
  if (!totals) return null;
  const shown = shownCounts(totals, inFlight);
  return (
    <ul className="rg-workcounters" aria-label="Work in this operation">
      {BUBBLE_KINDS.map((kind) => (
        <li key={kind} className="rg-workcounter">
          <span
            ref={(el) => registerCounterAnchor(kind, el)}
            className="rg-workcounter__bubble"
            style={{ background: BUBBLE_COLORS[kind] }}
          >
            {formatCompact(shown[kind])}
          </span>
          <span className="rg-workcounter__tab">{BUBBLE_LABELS[kind]}</span>
        </li>
      ))}
    </ul>
  );
}
