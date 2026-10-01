/**
 * One henchman skin rule as a card (#225): its place in the order, a small
 * picture of the skin in the rule's trim, who it applies to in words, and
 * move up / move down / edit / delete. The buttons carry `data-action` so
 * the list can put focus back on them after a move.
 */
import { HENCHMAN_SKIN_LABELS, type SkinRule } from "@regulus/protocol";
import { Button } from "../components/Button.tsx";
import { trimFor } from "./SkinRuleEditor.tsx";
import { SkinThumb } from "./SkinThumb.tsx";
import { describeMatch } from "./skinRuleLabels.ts";

export interface SkinRuleCardProps {
  rule: SkinRule;
  index: number;
  count: number;
  busy: boolean;
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function SkinRuleCard({
  rule,
  index,
  count,
  busy,
  onMove,
  onEdit,
  onDelete,
}: SkinRuleCardProps) {
  const who = describeMatch(rule.match);
  return (
    <div className="rg-skin-rule" data-rule={rule.id}>
      <span className="rg-skin-rule__rank" aria-hidden="true">
        {index + 1}
      </span>
      <SkinThumb skin={rule.skinId} trim={trimFor(rule.match)} size="sm" />
      <div className="rg-skin-rule__text">
        <strong>{who}</strong>
        <span className="rg-muted">wears the {HENCHMAN_SKIN_LABELS[rule.skinId]}</span>
      </div>
      <div className="rg-skin-rule__actions">
        <Button
          data-action="up"
          variant="ghost"
          size="sm"
          className="rg-skin-rule__move"
          disabled={index === 0}
          aria-label={`Move ${who} up`}
          title="Move up"
          onClick={() => onMove(-1)}
        >
          ▲
        </Button>
        <Button
          data-action="down"
          variant="ghost"
          size="sm"
          className="rg-skin-rule__move"
          disabled={index === count - 1}
          aria-label={`Move ${who} down`}
          title="Move down"
          onClick={() => onMove(1)}
        >
          ▼
        </Button>
        <Button
          data-action="edit"
          variant="secondary"
          size="sm"
          disabled={busy}
          aria-label={`Edit rule for ${who}`}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          aria-label={`Delete rule for ${who}`}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
