/**
 * Settings → Henchmen (#184, #225; SPEC §5 `skin_rules`, §9.3 D22), for
 * office owners and admins. Every henchman wears the yellow jumpsuit with
 * its provider's trim; a rule gives the henchmen it matches (`role:pm`,
 * `office_agent:<id>`, `provider:<id>`) a special skin from the built-in set.
 *
 * The rules are an ordered list of cards and the top matching rule wins:
 * move up / move down rewrite the server's integer priorities from the
 * order (skinRuleOrder.ts). A new rule goes to the top. Adding or editing
 * opens SkinRuleEditor, with the turntable preview.
 */
import type { SkinRule } from "@regulus/protocol";
import {
  type ComponentType,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import type { SkinPreviewProps } from "./SkinPreview.tsx";
import { SkinRuleCard } from "./SkinRuleCard.tsx";
import {
  type Draft,
  draftFromRule,
  draftMatch,
  EMPTY_DRAFT,
  SkinRuleEditor,
} from "./SkinRuleEditor.tsx";
import { describeMatch } from "./skinRuleLabels.ts";
import { moveRule, orderedRules, priorityPatches } from "./skinRuleOrder.ts";
import { createSkinRulesApi, describeSkinRulesError, type SkinRulesApi } from "./skinRulesApi.ts";
import "./skinRules.css";

const defaultApi = createSkinRulesApi();
const LazyPreview = lazy(() => import("./SkinPreview.tsx"));

type Editor = null | { mode: "new" } | { mode: "edit"; rule: SkinRule };
type Failure = Parameters<typeof describeSkinRulesError>[0];
/** Where focus goes after the list re-renders: a card's button, or "Add a rule". */
type FocusTarget = { id: string; action: "up" | "down" | "edit" } | "add" | null;

export function SkinRulesSection({
  api = defaultApi,
  Preview = LazyPreview,
}: {
  api?: SkinRulesApi;
  Preview?: ComponentType<SkinPreviewProps>;
}) {
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  const [rules, setRules] = useState<SkinRule[] | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const root = useRef<HTMLElement>(null);
  const focusNext = useRef<FocusTarget>(null);

  const load = useCallback(async () => {
    const res = await api.list();
    if (res.ok) setRules(orderedRules(res.data.rules));
    else setError(describeSkinRulesError(res));
  }, [api]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  // Put focus back where the user was once the list has re-rendered.
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target || !root.current) return;
    const selector =
      target === "add"
        ? '[data-action="add"]'
        : `[data-rule=${JSON.stringify(target.id)}] [data-action="${target.action}"]`;
    const el = root.current.querySelector<HTMLButtonElement>(selector);
    if (el && !el.disabled) {
      el.focus();
      focusNext.current = null;
    }
  });

  if (!allowed) return null;

  const run = async (fn: () => Promise<Failure | null>) => {
    setBusy(true);
    setError(null);
    const failure = await fn();
    if (failure) setError(describeSkinRulesError(failure));
    await load();
    setBusy(false);
  };

  /** Make `order` the ranking: write the priorities that changed, top first. */
  const applyOrder = async (order: SkinRule[]): Promise<Failure | null> => {
    for (const patch of priorityPatches(order)) {
      const res = await api.update(patch.id, { priority: patch.priority });
      if (!res.ok) return res;
    }
    return null;
  };

  const move = (index: number, delta: -1 | 1) => {
    if (busy || editor !== null || !rules) return;
    const rule = rules[index];
    if (!rule) return;
    const order = moveRule(rules, index, delta);
    const to = order.indexOf(rule);
    const edge = to === 0 || to === order.length - 1;
    focusNext.current = {
      id: rule.id,
      action: edge ? (to === 0 ? "down" : "up") : delta < 0 ? "up" : "down",
    };
    setRules(order);
    setStatus(`${describeMatch(rule.match)} is now rule ${to + 1} of ${order.length}.`);
    void run(() => applyOrder(order));
  };

  const save = (draft: Draft) => {
    const current = editor;
    void run(async () => {
      const match = draftMatch(draft);
      if (current?.mode === "edit") {
        const { rule } = current;
        const patch = {
          ...(match !== rule.match ? { match } : {}),
          ...(draft.skinId !== rule.skinId ? { skinId: draft.skinId } : {}),
        };
        if (Object.keys(patch).length > 0) {
          const res = await api.update(rule.id, patch);
          if (!res.ok) return res;
        }
        focusNext.current = { id: rule.id, action: "edit" };
      } else {
        const list = rules ?? [];
        const res = await api.create({ match, skinId: draft.skinId, priority: list.length });
        if (!res.ok) return res;
        focusNext.current = "add";
        setStatus(`Added: ${describeMatch(match)} is rule 1.`);
        const failure = await applyOrder([res.data, ...list]);
        if (failure) return failure;
      }
      setEditor(null);
      return null;
    });
  };

  const remove = (rule: SkinRule) => {
    focusNext.current = "add";
    setStatus(`Deleted the rule for ${describeMatch(rule.match)}.`);
    void run(async () => {
      const res = await api.remove(rule.id);
      return res.ok ? null : res;
    });
  };

  const cancel = () => {
    focusNext.current = editor?.mode === "edit" ? { id: editor.rule.id, action: "edit" } : "add";
    setEditor(null);
  };

  const editorFor = (rule: SkinRule | null) => (
    <SkinRuleEditor
      initial={rule ? draftFromRule(rule) : EMPTY_DRAFT}
      editing={rule !== null}
      busy={busy}
      Preview={Preview}
      onSave={save}
      onCancel={cancel}
    />
  );

  return (
    <section ref={root} className="rg-settings__group" aria-label="Henchman skins">
      <h3 className="rg-settings__heading">Henchman skins</h3>
      <p className="rg-field__hint">
        Henchmen wear the yellow jumpsuit with their provider's trim. A rule dresses the henchmen it
        matches in a special skin. When several rules match a henchman, the highest one in the list
        wins.
      </p>
      {editor?.mode === "new" ? (
        editorFor(null)
      ) : (
        <div>
          <Button
            variant="primary"
            size="sm"
            data-action="add"
            disabled={busy || editor !== null}
            onClick={() => setEditor({ mode: "new" })}
          >
            Add a rule…
          </Button>
        </div>
      )}
      {rules?.length === 0 && editor === null && (
        <p className="rg-muted">No rules yet: every henchman wears the standard jumpsuit.</p>
      )}
      {rules && rules.length > 0 && (
        <ol className="rg-skin-rules" aria-label="Skin rules">
          {rules.map((rule, i) => (
            <li key={rule.id}>
              {editor?.mode === "edit" && editor.rule.id === rule.id ? (
                editorFor(rule)
              ) : (
                <SkinRuleCard
                  rule={rule}
                  index={i}
                  count={rules.length}
                  busy={busy || editor !== null}
                  onMove={(delta) => move(i, delta)}
                  onEdit={() => setEditor({ mode: "edit", rule })}
                  onDelete={() => remove(rule)}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <div role="status" aria-live="polite" className="rg-sr-only">
        {status}
      </div>
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}
