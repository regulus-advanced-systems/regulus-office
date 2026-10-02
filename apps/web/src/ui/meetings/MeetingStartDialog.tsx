/**
 * "Call a meeting" (#50): pattern, task, 2-5 henchmen (any providers the
 * starter can use), rounds, token budget and output, with the agenda the
 * pattern gives. Every member runs as the starter, with their own login or a
 * key profile of theirs or the office's (by id only, SPEC §8).
 */
import {
  MEETING_MEMBERS_MAX,
  MEETING_MEMBERS_MIN,
  MEETING_PATTERN_BLURBS,
  MEETING_PATTERN_LABELS,
  MEETING_PATTERNS,
  MEETING_ROUNDS_MAX,
  type ProviderId,
} from "@regulus/protocol";
import { useEffect, useMemo, useState } from "react";
import { useOperationStore } from "../../state/operation.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { type CredentialProfilesApi, createCredentialProfilesApi } from "../spawn/api.ts";
import { RepoPicker } from "../spawn/choices.tsx";
import { defaultCredential, providerUsable } from "../spawn/credentials.ts";
import { PROVIDER_PRESETS } from "../spawn/models.ts";
import { spawnRepoOptions } from "../spawn/SpawnDialog.tsx";
import { useProviderAccess } from "../spawn/useProviderAccess.ts";
import { createMeetingsApi, describeMeetingError, type MeetingsApi } from "./api.ts";
import {
  agendaLines,
  defaultDraft,
  defaultMember,
  draftErrors,
  draftRequest,
  type MeetingDraft,
  memberLabels,
  needsPull,
  OUTPUT_LABELS,
  outputsFor,
  TOKEN_BUDGETS,
  tokens,
  usableMembers,
  withPattern,
} from "./meetingForm.ts";
import { useMeetingStore } from "./meetingStore.ts";

const defaultApi = createMeetingsApi();
const defaultProfiles = createCredentialProfilesApi();

export function MeetingStartDialog({
  api = defaultApi,
  profiles = defaultProfiles,
}: {
  api?: MeetingsApi;
  profiles?: CredentialProfilesApi;
}) {
  const close = useMeetingStore((s) => s.closeStart);
  const operationId = useOperationStore((s) => s.operationId);
  const state = useOperationStore((s) => s.state);
  const info = useOperationsStore((s) => s.operations?.find((o) => o.operationId === operationId));
  const repos = useMemo(() => spawnRepoOptions(info, state), [info, state]);
  const freeDesks = Object.values(state?.desks ?? {}).filter((d) => !d.agentId).length;
  const { access, loaded } = useProviderAccess(profiles);
  const [draft, setDraft] = useState<MeetingDraft>(() =>
    defaultDraft((repos.find((r) => r.isPrimary && r.ready) ?? repos[0])?.repoId ?? ""),
  );
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = touched ? draftErrors(draft) : {};
  const names = memberLabels(draft.pattern, draft.members.length);
  const patch = (p: Partial<MeetingDraft>) => setDraft((d) => ({ ...d, ...p }));
  // Once logins are known, default members on a provider the caller cannot use move to one they can.
  useEffect(() => {
    if (!loaded) return;
    setDraft((d) => ({ ...d, members: usableMembers(d.members, access) }));
  }, [loaded, access]);
  if (!operationId) return null;

  const submit = async () => {
    setTouched(true);
    if (Object.keys(draftErrors(draft)).length > 0) return;
    const withCredentials: MeetingDraft = {
      ...draft,
      members: draft.members.map((m) => ({
        ...m,
        profileId: m.profileId || defaultCredential(access[m.provider]),
      })),
    };
    setPending(true);
    setError(null);
    const res = await api.start(draftRequest(operationId, withCredentials));
    setPending(false);
    if (!res.ok) {
      setError(describeMeetingError(res));
      return;
    }
    useMeetingStore.getState().applyChanged(res.data);
    useMeetingStore.getState().openPanel(res.data.id);
  };

  return (
    <Modal
      open
      onClose={close}
      title="Call a meeting"
      width={720}
      dismissOnBackdrop={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={pending}>
            {pending ? "Calling the meeting…" : "Start meeting"}
          </Button>
        </>
      }
    >
      <div className="rg-meeting-form">
        <p className="rg-meeting__intro">
          The henchmen run as you, share one worktree on a meeting branch and take turns at a desk
          pod of this room ({freeDesks} free {freeDesks === 1 ? "desk" : "desks"}).
        </p>
        <fieldset className="rg-meeting-form__patterns" disabled={pending}>
          <legend className="rg-field__label">Pattern</legend>
          {MEETING_PATTERNS.map((p) => (
            <label
              key={p}
              className="rg-meeting-form__pattern"
              data-checked={draft.pattern === p || undefined}
            >
              <input
                type="radio"
                name="meeting-pattern"
                value={p}
                checked={draft.pattern === p}
                onChange={() => setDraft((d) => withPattern(d, p))}
              />
              <span className="rg-meeting-form__pattern-name">{MEETING_PATTERN_LABELS[p]}</span>
              <span className="rg-meeting-form__pattern-blurb">{MEETING_PATTERN_BLURBS[p]}</span>
            </label>
          ))}
        </fieldset>
        <label className="rg-field">
          <span className="rg-field__label">Task</span>
          <textarea
            className="rg-input rg-meeting-form__topic"
            rows={3}
            value={draft.topic}
            disabled={pending}
            placeholder="What should they decide, build or review?"
            onChange={(e) => patch({ topic: e.target.value })}
          />
          {errors.topic && <span className="rg-field__error">{errors.topic}</span>}
        </label>
        {repos.length > 1 && (
          <RepoPicker
            idBase="meeting-repo"
            repos={repos}
            repoId={draft.repoId}
            onChange={(repoId) => patch({ repoId })}
            error={errors.repoId}
          />
        )}
        <fieldset className="rg-meeting-form__members" disabled={pending}>
          <legend className="rg-field__label">Henchmen</legend>
          {draft.members.map((m, i) => (
            <div className="rg-meeting-form__member" key={`${i}-${names[i]}`}>
              <span className="rg-meeting-form__role">{names[i]}</span>
              <select
                className="rg-input"
                aria-label={`${names[i]}'s model`}
                value={`${m.provider}|${m.model}`}
                onChange={(e) => {
                  const [provider, model] = e.target.value.split("|") as [ProviderId, string];
                  setDraft((d) => ({
                    ...d,
                    members: d.members.map((x, j) =>
                      j === i ? { provider, model, profileId: "" } : x,
                    ),
                  }));
                }}
              >
                {PROVIDER_PRESETS.map((p) => (
                  <optgroup
                    key={p.id}
                    label={providerUsable(access[p.id]) ? p.label : `${p.label} (not connected)`}
                  >
                    {p.models.map((model) => (
                      <option
                        key={model.id}
                        value={`${p.id}|${model.id}`}
                        disabled={!providerUsable(access[p.id])}
                      >
                        {p.label} · {model.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${names[i]}`}
                disabled={draft.members.length <= MEETING_MEMBERS_MIN}
                onClick={() =>
                  setDraft((d) => ({ ...d, members: d.members.filter((_, j) => j !== i) }))
                }
              >
                Remove
              </Button>
            </div>
          ))}
          {draft.members.length < MEETING_MEMBERS_MAX && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  members: [...d.members, defaultMember(d.members.at(-1)?.provider)],
                }))
              }
            >
              Add a henchman
            </Button>
          )}
          {errors.members && <span className="rg-field__error">{errors.members}</span>}
        </fieldset>
        <div className="rg-meeting-form__row">
          <label className="rg-field">
            <span className="rg-field__label">Rounds</span>
            <input
              className="rg-input"
              type="number"
              min={1}
              max={MEETING_ROUNDS_MAX}
              value={draft.rounds}
              disabled={pending}
              onChange={(e) =>
                patch({
                  rounds: Math.min(MEETING_ROUNDS_MAX, Math.max(1, Number(e.target.value) || 1)),
                })
              }
            />
          </label>
          <label className="rg-field">
            <span className="rg-field__label">Token budget</span>
            <select
              className="rg-input"
              value={draft.tokenBudget}
              disabled={pending}
              onChange={(e) => patch({ tokenBudget: Number(e.target.value) })}
            >
              {TOKEN_BUDGETS.map((n) => (
                <option key={n} value={n}>
                  {tokens(n)} tokens
                </option>
              ))}
            </select>
          </label>
          <label className="rg-field">
            <span className="rg-field__label">Output</span>
            <select
              className="rg-input"
              value={draft.output}
              disabled={pending || draft.pattern === "review_panel"}
              onChange={(e) => patch({ output: e.target.value as MeetingDraft["output"] })}
            >
              {outputsFor(draft.pattern).map((o) => (
                <option key={o} value={o}>
                  {OUTPUT_LABELS[o]}
                </option>
              ))}
            </select>
          </label>
          {needsPull(draft) && (
            <label className="rg-field">
              <span className="rg-field__label">Pull request #</span>
              <input
                className="rg-input"
                inputMode="numeric"
                value={draft.prNumber}
                disabled={pending}
                onChange={(e) => patch({ prNumber: e.target.value })}
              />
              {errors.prNumber && <span className="rg-field__error">{errors.prNumber}</span>}
            </label>
          )}
        </div>
        <section className="rg-meeting-form__agenda" aria-label="Agenda">
          <h3 className="rg-meeting__heading">Agenda</h3>
          <ol>
            {agendaLines(draft.pattern, draft.members.length, draft.rounds).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <p className="rg-field__hint">
            The meeting stops when its {tokens(draft.tokenBudget)} tokens are used up; each turn may
            take up to {draft.turnTimeoutMinutes} minutes.
          </p>
        </section>
        {error && <FormAlert>{error}</FormAlert>}
      </div>
    </Modal>
  );
}
