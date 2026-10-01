/**
 * Henchman skins and the admin rules that assign them (SPEC §5 `skin_rules`,
 * §9.3, D22; #184).
 *
 * Every henchman is a henchman in the standard yellow jumpsuit with its
 * provider's trim. A rule gives the henchmen it matches a special skin from the
 * built-in set: `role:pm` (the project-manager office agent),
 * `office_agent:<id>` (one office agent) or `provider:<id>` (every henchman of a
 * provider). Rules are kept by the office server; the OperationRoom publishes
 * each henchman's resolved skin (`HenchmanState.skin`), so clients never see them.
 */
import { z } from "zod";
import { Id, TimestampMs } from "./common.ts";
import { PROVIDER_IDS, type ProviderId } from "./enums.ts";

export const HENCHMAN_SKIN_IDS = [
  "standard",
  "lab_coat",
  "black_ops",
  "chef",
  "number_two",
] as const;
export type HenchmanSkinId = (typeof HENCHMAN_SKIN_IDS)[number];
export const DEFAULT_SKIN_ID: HenchmanSkinId = "standard";

export const HENCHMAN_SKIN_LABELS: Readonly<Record<HenchmanSkinId, string>> = {
  standard: "Standard jumpsuit",
  lab_coat: "Lab coat",
  black_ops: "Black ops",
  chef: "Chef",
  number_two: "Number two (PM suit)",
};

export function isHenchmanSkinId(value: unknown): value is HenchmanSkinId {
  return typeof value === "string" && (HENCHMAN_SKIN_IDS as readonly string[]).includes(value);
}

/** A skin id from the wire; anything unknown is the standard jumpsuit. */
export function skinIdFor(value: string | undefined): HenchmanSkinId {
  return isHenchmanSkinId(value) ? value : DEFAULT_SKIN_ID;
}

/** Office-agent roles a rule can match (`role:<role>`). */
export const SKIN_RULE_ROLES = ["pm"] as const;
export type SkinRuleRole = (typeof SKIN_RULE_ROLES)[number];

export const SKIN_RULE_KINDS = ["role", "office_agent", "provider"] as const;
export type SkinRuleKind = (typeof SKIN_RULE_KINDS)[number];

/** How specific a match kind is: on equal priority the more specific rule wins. */
const SPECIFICITY: Readonly<Record<SkinRuleKind, number>> = {
  office_agent: 3,
  role: 2,
  provider: 1,
};

const OFFICE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface ParsedSkinMatch {
  kind: SkinRuleKind;
  value: string;
}

/** Parse `role:pm`, `office_agent:<id>` or `provider:<id>`; null when invalid. */
export function parseSkinMatch(match: string): ParsedSkinMatch | null {
  const colon = match.indexOf(":");
  if (colon < 0) return null;
  const kind = match.slice(0, colon);
  const value = match.slice(colon + 1);
  if (kind === "role")
    return (SKIN_RULE_ROLES as readonly string[]).includes(value) ? { kind, value } : null;
  if (kind === "provider")
    return (PROVIDER_IDS as readonly string[]).includes(value) ? { kind, value } : null;
  if (kind === "office_agent") return OFFICE_AGENT_ID.test(value) ? { kind, value } : null;
  return null;
}

export const SkinMatch = z
  .string()
  .max(80)
  .refine((m) => parseSkinMatch(m) !== null, {
    message: "expected role:pm, office_agent:<id> or provider:<id>",
  });

export const SKIN_RULE_PRIORITY_LIMIT = 1000;
export const SkinPriority = z
  .number()
  .int()
  .min(-SKIN_RULE_PRIORITY_LIMIT)
  .max(SKIN_RULE_PRIORITY_LIMIT);

export const SkinRule = z.object({
  id: Id,
  match: SkinMatch,
  skinId: z.enum(HENCHMAN_SKIN_IDS),
  priority: SkinPriority,
  createdAt: TimestampMs,
});
export type SkinRule = z.infer<typeof SkinRule>;

export const CreateSkinRule = z.object({
  match: SkinMatch,
  skinId: z.enum(HENCHMAN_SKIN_IDS),
  priority: SkinPriority.default(0),
});
export type CreateSkinRule = z.infer<typeof CreateSkinRule>;

export const UpdateSkinRule = z
  .object({
    match: SkinMatch,
    skinId: z.enum(HENCHMAN_SKIN_IDS),
    priority: SkinPriority,
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: "nothing to change" });
export type UpdateSkinRule = z.infer<typeof UpdateSkinRule>;

export const SkinRulesResponse = z.object({ rules: z.array(SkinRule) });
export type SkinRulesResponse = z.infer<typeof SkinRulesResponse>;

/** Owners and admins: list, add, change and delete rules. */
export const SKIN_RULES_API_PATH = "/api/skin-rules";

/** What a rule can match a henchman by. Coding henchmen have a provider; office agents an id and role. */
export interface SkinSubject {
  provider?: ProviderId;
  officeAgentId?: string;
  role?: SkinRuleRole;
}

export function skinRuleMatches(match: string, subject: SkinSubject): boolean {
  const parsed = parseSkinMatch(match);
  if (!parsed) return false;
  if (parsed.kind === "provider") return subject.provider === parsed.value;
  if (parsed.kind === "role") return subject.role === parsed.value;
  return subject.officeAgentId === parsed.value;
}

type RankedRule = Pick<SkinRule, "id" | "match" | "skinId" | "priority" | "createdAt">;

/** Rules best first: priority, then specificity, then the older rule, then id (stable). */
export function rankSkinRules<T extends RankedRule>(rules: readonly T[]): T[] {
  const spec = (r: T) => {
    const kind = parseSkinMatch(r.match)?.kind;
    return kind ? SPECIFICITY[kind] : 0;
  };
  return [...rules].sort(
    (a, b) =>
      b.priority - a.priority ||
      spec(b) - spec(a) ||
      a.createdAt - b.createdAt ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The skin a henchman wears: the best matching rule's, else the standard jumpsuit. */
export function resolveSkin(rules: readonly RankedRule[], subject: SkinSubject): HenchmanSkinId {
  for (const rule of rankSkinRules(rules))
    if (skinRuleMatches(rule.match, subject)) return rule.skinId;
  return DEFAULT_SKIN_ID;
}
