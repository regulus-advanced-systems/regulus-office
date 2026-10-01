/**
 * Skin rules as an ordered list (#225): the top rule wins. The server keeps
 * integer priorities (highest wins, SPEC §5 `skin_rules`); the client shows
 * the rules in the server's own ranking (`rankSkinRules`) and, after a move
 * or an add, writes priorities `n-1 … 0` from the top down so the order
 * alone decides. Only rules whose priority changes are sent.
 */
import { rankSkinRules, type SkinRule } from "@regulus/protocol";

export function orderedRules(rules: readonly SkinRule[]): SkinRule[] {
  return rankSkinRules(rules);
}

/** The rule at `index` moved by `delta` places (clamped); a new array. */
export function moveRule<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, index + delta));
  const next = [...list];
  const [item] = next.splice(index, 1);
  if (item === undefined) return next;
  next.splice(to, 0, item);
  return next;
}

export interface PriorityPatch {
  id: string;
  priority: number;
}

/** Priorities that make `ordered` the ranking: top `n-1`, bottom `0`; only the changed ones. */
export function priorityPatches(ordered: readonly Pick<SkinRule, "id" | "priority">[]) {
  const patches: PriorityPatch[] = [];
  ordered.forEach((rule, i) => {
    const priority = ordered.length - 1 - i;
    if (rule.priority !== priority) patches.push({ id: rule.id, priority });
  });
  return patches;
}
