/**
 * Adding or editing a henchman skin rule (#225): who it applies to, as radio
 * cards in plain words (then the provider, or the office agent's id), and
 * the skin from a gallery of thumbnails, next to the large turntable
 * preview in the matching provider trim. Native radio groups, so the arrow
 * keys move within a group and Tab between groups.
 */
import {
  HENCHMAN_SKIN_IDS,
  HENCHMAN_SKIN_LABELS,
  type HenchmanSkinId,
  PROVIDER_IDS,
  type ProviderId,
  parseSkinMatch,
  type SkinRule,
  type SkinRuleKind,
} from "@regulus/protocol";
import { type ComponentType, Suspense, useEffect, useId, useRef, useState } from "react";
import { providerLightColor } from "../../scene/avatar/colorSets.ts";
import { Button } from "../components/Button.tsx";
import type { SkinPreviewProps } from "./SkinPreview.tsx";
import { SkinThumb } from "./SkinThumb.tsx";
import { describeMatch, PROVIDER_LABELS } from "./skinRuleLabels.ts";

export interface Draft {
  kind: SkinRuleKind;
  provider: ProviderId;
  agentId: string;
  skinId: HenchmanSkinId;
}

export const EMPTY_DRAFT: Draft = {
  kind: "provider",
  provider: "codex",
  agentId: "",
  skinId: "lab_coat",
};

export function draftFromRule(rule: SkinRule): Draft {
  const parsed = parseSkinMatch(rule.match);
  const d: Draft = { ...EMPTY_DRAFT, skinId: rule.skinId };
  if (parsed?.kind === "provider") return { ...d, provider: parsed.value as ProviderId };
  if (parsed?.kind === "office_agent") return { ...d, kind: "office_agent", agentId: parsed.value };
  if (parsed?.kind === "role") return { ...d, kind: "role" };
  return d;
}

export function draftMatch(d: Draft): string {
  if (d.kind === "role") return "role:pm";
  if (d.kind === "office_agent") return `office_agent:${d.agentId.trim()}`;
  return `provider:${d.provider}`;
}

/** The trim a rule's henchmen wear: its provider's colour, else Claude orange. */
export function trimFor(match: string): string | undefined {
  const parsed = parseSkinMatch(match);
  const provider = parsed?.kind === "provider" ? (parsed.value as ProviderId) : "claude-code";
  return providerLightColor(provider);
}

const WHO: readonly { kind: SkinRuleKind; title: string; hint: string }[] = [
  { kind: "provider", title: "Every henchman of a provider", hint: "All Codex henchmen, say" },
  { kind: "role", title: "The PM", hint: "The project-manager office agent" },
  { kind: "office_agent", title: "One office agent", hint: "By its id, such as hermes" },
];

export function SkinRuleEditor({
  initial,
  editing,
  busy,
  Preview,
  onSave,
  onCancel,
}: {
  initial: Draft;
  /** True when changing an existing rule (the button says Save). */
  editing: boolean;
  busy: boolean;
  Preview: ComponentType<SkinPreviewProps>;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const name = useId();
  const agentInput = useId();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const edit = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const match = draftMatch(d);
  const valid = parseSkinMatch(match) !== null;
  const trim = trimFor(match);
  const provider = parseSkinMatch(match)?.kind === "provider" ? PROVIDER_LABELS[d.provider] : null;

  return (
    <form
      className="rg-skin-editor"
      aria-label={editing ? "Edit skin rule" : "New skin rule"}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) onSave(d);
      }}
    >
      <div className="rg-skin-editor__choices">
        <fieldset className="rg-skin-choice">
          <legend className="rg-field__label">Who wears it</legend>
          <div className="rg-skin-who">
            {WHO.map((w) => (
              <label key={w.kind} className="rg-skin-who__card">
                <input
                  ref={w.kind === d.kind ? first : undefined}
                  type="radio"
                  name={`${name}-who`}
                  value={w.kind}
                  checked={d.kind === w.kind}
                  onChange={() => edit({ kind: w.kind })}
                />
                <span className="rg-skin-who__title">{w.title}</span>
                <span className="rg-skin-who__hint">{w.hint}</span>
              </label>
            ))}
          </div>
          {d.kind === "provider" && (
            <div className="rg-skin-chips" role="radiogroup" aria-label="Provider">
              {PROVIDER_IDS.map((p) => (
                <label key={p} className="rg-skin-chip">
                  <input
                    type="radio"
                    name={`${name}-provider`}
                    value={p}
                    checked={d.provider === p}
                    onChange={() => edit({ provider: p })}
                  />
                  <span>
                    <i style={{ background: providerLightColor(p) }} />
                    {PROVIDER_LABELS[p]}
                  </span>
                </label>
              ))}
            </div>
          )}
          {d.kind === "office_agent" && (
            <div className="rg-field">
              <label className="rg-field__label" htmlFor={agentInput}>
                Office agent id
              </label>
              <input
                id={agentInput}
                className="rg-input"
                placeholder="e.g. hermes"
                autoComplete="off"
                value={d.agentId}
                onChange={(e) => edit({ agentId: e.currentTarget.value })}
              />
            </div>
          )}
          <p className="rg-skin-editor__summary" aria-live="polite">
            {valid ? (
              <>
                <strong>{describeMatch(match)}</strong> wears the{" "}
                <strong>{HENCHMAN_SKIN_LABELS[d.skinId]}</strong>.
              </>
            ) : (
              "Type the office agent's id: letters, digits, dot, dash or underscore."
            )}
          </p>
        </fieldset>
        <fieldset className="rg-skin-choice">
          <legend className="rg-field__label">Skin</legend>
          <div className="rg-skin-gallery">
            {HENCHMAN_SKIN_IDS.map((id) => (
              <label key={id} className="rg-skin-gallery__item">
                <input
                  type="radio"
                  name={`${name}-skin`}
                  value={id}
                  checked={d.skinId === id}
                  onChange={() => edit({ skinId: id })}
                />
                <SkinThumb skin={id} trim={trim} />
                <span className="rg-skin-gallery__label">{HENCHMAN_SKIN_LABELS[id]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <figure className="rg-skin-editor__preview" data-testid="skin-preview">
        <Suspense fallback={<div className="rg-skin-editor__stage" />}>
          <Preview skin={d.skinId} trim={trim} />
        </Suspense>
        <figcaption className="rg-field__hint">
          {HENCHMAN_SKIN_LABELS[d.skinId]}
          {provider ? `, ${provider} trim` : ""}
        </figcaption>
      </figure>
      <div className="rg-skin-editor__actions">
        <Button type="submit" variant="primary" size="sm" disabled={busy || !valid}>
          {editing ? "Save rule" : "Add rule"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
