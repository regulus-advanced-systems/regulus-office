/**
 * "Henchman skins" in Settings, for office owners and admins (#184, SPEC §5
 * `skin_rules`, §9.3 D22): every henchman is a henchman in the yellow jumpsuit
 * with its provider's trim; a rule gives the henchmen it matches (`role:pm`,
 * `office_agent:<id>`, `provider:<id>`) a special skin from the built-in set.
 * The highest priority wins. A turntable previews the skin being chosen.
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
import { type ComponentType, lazy, Suspense, useCallback, useEffect, useState } from "react";
import { providerLightColor } from "../../scene/avatar/colorSets.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import type { SkinPreviewProps } from "./SkinPreview.tsx";
import { describeMatch, PROVIDER_LABELS } from "./skinRuleLabels.ts";
import { createSkinRulesApi, describeSkinRulesError, type SkinRulesApi } from "./skinRulesApi.ts";

const defaultApi = createSkinRulesApi();
const LazyPreview = lazy(() => import("./SkinPreview.tsx"));

const KIND_LABELS: Record<SkinRuleKind, string> = {
  provider: "Every henchman of a provider",
  role: "An office-agent role",
  office_agent: "One office agent",
};

interface Draft {
  kind: SkinRuleKind;
  provider: ProviderId;
  agentId: string;
  skinId: HenchmanSkinId;
  priority: string;
}

const EMPTY: Draft = {
  kind: "provider",
  provider: "codex",
  agentId: "",
  skinId: "lab_coat",
  priority: "0",
};

function draftMatch(d: Draft): string {
  if (d.kind === "role") return "role:pm";
  if (d.kind === "office_agent") return `office_agent:${d.agentId.trim()}`;
  return `provider:${d.provider}`;
}

/** The trim colour a preview shows: the rule's provider, else Claude orange. */
function trimFor(match: string): string | undefined {
  const parsed = parseSkinMatch(match);
  const provider = parsed?.kind === "provider" ? (parsed.value as ProviderId) : "claude-code";
  return providerLightColor(provider);
}

export function SkinRulesSection({
  api = defaultApi,
  Preview = LazyPreview,
}: {
  api?: SkinRulesApi;
  Preview?: ComponentType<SkinPreviewProps>;
}) {
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  const [rules, setRules] = useState<SkinRule[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [preview, setPreview] = useState<{ skin: HenchmanSkinId; match: string }>({
    skin: EMPTY.skinId,
    match: draftMatch(EMPTY),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.list();
    if (res.ok) setRules(res.data.rules);
    else setError(describeSkinRulesError(res));
  }, [api]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);
  if (!allowed) return null;

  const run = async (fn: () => Promise<{ ok: boolean } & object>) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    if (!res.ok)
      setError(describeSkinRulesError(res as Parameters<typeof describeSkinRulesError>[0]));
    await load();
    setBusy(false);
  };
  const edit = (next: Partial<Draft>) => {
    const d = { ...draft, ...next };
    setDraft(d);
    setPreview({ skin: d.skinId, match: draftMatch(d) });
  };
  const priority = Number(draft.priority);
  const valid =
    Number.isInteger(priority) &&
    Math.abs(priority) <= 1000 &&
    parseSkinMatch(draftMatch(draft)) !== null;

  return (
    <section className="rg-field" aria-label="Henchman skins">
      <div className="rg-field__label">Henchman skins</div>
      <div className="rg-field__hint">
        Henchmen wear the yellow jumpsuit with their provider's trim. A rule gives the henchmen it
        matches a special skin; the highest priority wins.
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", display: "grid", gap: 8 }}>
          {rules?.length === 0 && (
            <div className="rg-muted">No rules yet: everyone is standard.</div>
          )}
          <ul aria-label="Skin rules" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rules?.map((rule) => (
              <li
                key={rule.id}
                style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
              >
                <span style={{ flex: "1 1 120px" }}>{describeMatch(rule.match)}</span>
                <select
                  className="rg-input"
                  aria-label={`Skin for ${describeMatch(rule.match)}`}
                  value={rule.skinId}
                  disabled={busy}
                  onFocus={() => setPreview({ skin: rule.skinId, match: rule.match })}
                  onChange={(e) => {
                    const skinId = e.currentTarget.value as HenchmanSkinId;
                    setPreview({ skin: skinId, match: rule.match });
                    void run(() => api.update(rule.id, { skinId }));
                  }}
                  style={{ width: 170 }}
                >
                  {HENCHMAN_SKIN_IDS.map((id) => (
                    <option key={id} value={id}>
                      {HENCHMAN_SKIN_LABELS[id]}
                    </option>
                  ))}
                </select>
                <span className="rg-muted">priority {rule.priority}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`Delete rule for ${describeMatch(rule.match)}`}
                  onClick={() => void run(() => api.remove(rule.id))}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
            <legend className="rg-field__hint">Add a rule</legend>
            <select
              className="rg-input"
              aria-label="Who the rule matches"
              value={draft.kind}
              onChange={(e) => edit({ kind: e.currentTarget.value as SkinRuleKind })}
            >
              {(Object.keys(KIND_LABELS) as SkinRuleKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            {draft.kind === "provider" && (
              <select
                className="rg-input"
                aria-label="Provider"
                value={draft.provider}
                onChange={(e) => edit({ provider: e.currentTarget.value as ProviderId })}
              >
                {PROVIDER_IDS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>
            )}
            {draft.kind === "role" && <div className="rg-muted">The project manager (PM)</div>}
            {draft.kind === "office_agent" && (
              <input
                className="rg-input"
                aria-label="Office agent id"
                placeholder="e.g. hermes"
                value={draft.agentId}
                onChange={(e) => edit({ agentId: e.currentTarget.value })}
              />
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <select
                className="rg-input"
                aria-label="Skin"
                value={draft.skinId}
                onChange={(e) => edit({ skinId: e.currentTarget.value as HenchmanSkinId })}
              >
                {HENCHMAN_SKIN_IDS.map((id) => (
                  <option key={id} value={id}>
                    {HENCHMAN_SKIN_LABELS[id]}
                  </option>
                ))}
              </select>
              <input
                className="rg-input"
                aria-label="Priority"
                type="number"
                step={1}
                value={draft.priority}
                onChange={(e) => edit({ priority: e.currentTarget.value })}
                style={{ width: 80 }}
              />
            </div>
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !valid}
                onClick={() =>
                  void run(async () => {
                    const res = await api.create({
                      match: draftMatch(draft),
                      skinId: draft.skinId,
                      priority,
                    });
                    if (res.ok) setDraft({ ...EMPTY, kind: draft.kind });
                    return res;
                  })
                }
              >
                Add rule
              </Button>
            </div>
          </fieldset>
        </div>
        <figure style={{ margin: 0, textAlign: "center" }} data-testid="skin-preview">
          <Suspense fallback={<div style={{ width: 180, height: 220 }} />}>
            <Preview skin={preview.skin} trim={trimFor(preview.match)} />
          </Suspense>
          <figcaption className="rg-field__hint">{HENCHMAN_SKIN_LABELS[preview.skin]}</figcaption>
        </figure>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}
