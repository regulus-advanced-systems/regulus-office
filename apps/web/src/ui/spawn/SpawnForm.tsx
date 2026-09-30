/**
 * The spawn form (SPEC §6 `agent.spawn`, §9.2, #142). The main form asks for
 * the repo (only when the floor has several), the model (grouped by provider,
 * unconnected providers disabled with a "Connect" link) and the effort; then
 * Spawn. Everything else has a default and sits under "More options", whose
 * open state is remembered per user. No secret is ever asked for or shown
 * here (SPEC §8).
 */
import { type Ref, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SpawnPrefill } from "../../state/spawn.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import type { CredentialProfilesApi } from "./api.ts";
import { EffortPicker, RepoPicker } from "./choices.tsx";
import { credentialOptions } from "./credentials.ts";
import { ModelPicker } from "./ModelPicker.tsx";
import { MoreOptions } from "./MoreOptions.tsx";
import { providerLabel } from "./models.ts";
import { loadMoreOptionsOpen, saveMoreOptionsOpen } from "./rememberMore.ts";
import {
  effectiveCredential,
  initialSpawnValues,
  MORE_OPTION_FIELDS,
  type SpawnFormErrors,
  type SpawnFormValues,
  type SpawnPayload,
  type SpawnRepoOption,
  usableDefault,
  validateSpawnForm,
  withModel,
} from "./spawnForm.ts";
import { useProviderAccess } from "./useProviderAccess.ts";
import "./spawn.css";

export interface SpawnFormProps {
  floorId: string;
  seatId: string;
  repos: readonly SpawnRepoOption[];
  prefill?: SpawnPrefill;
  api: CredentialProfilesApi;
  /** Remembers "More options" per user. */
  userId: string | null;
  /** Attached to the checked model: the dialog focuses it first. */
  modelFocusRef?: Ref<HTMLInputElement>;
  /** True while the server works on the spawn. */
  pending: boolean;
  /** The server's rejection, shown above the buttons. */
  serverError: string | null;
  onSubmit: (payload: SpawnPayload) => void;
  onCancel: () => void;
  /** "Connect <provider>": open the providers panel (#32) on that provider. */
  onConnect: (provider: SpawnFormValues["provider"]) => void;
  /** The queue dialog (#37) reuses the form: its own labels, More options open. */
  labels?: { form: string; submit: string; pending: string };
  moreOpen?: boolean;
}

export function SpawnForm(props: SpawnFormProps) {
  const { repos, prefill, api, pending, serverError, userId } = props;
  const [values, setValues] = useState<SpawnFormValues>(() => initialSpawnValues(repos, prefill));
  const [errors, setErrors] = useState<SpawnFormErrors>({});
  const [moreOpen, setMoreOpen] = useState(
    () =>
      props.moreOpen ||
      loadMoreOptionsOpen(userId) ||
      Boolean(prefill?.prompt || prefill?.taskTitle),
  );
  const modelTouched = useRef(false);
  const { access, loaded } = useProviderAccess(api);
  const id = useId();

  // Once logins are known, preselect a model the human can actually use.
  useEffect(() => {
    if (!loaded || modelTouched.current) return;
    setValues((v) => usableDefault(v, access));
  }, [loaded, access]);

  // Disabling the fields (or a model) drops focus to <body>, where Escape and
  // Tab stop working: keep it on Close while pending, then on the model.
  const formRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pending) {
      cancelRef.current?.focus();
      return;
    }
    const active = document.activeElement;
    const lost =
      active === null ||
      active === document.body ||
      active === cancelRef.current ||
      (active instanceof HTMLInputElement && active.disabled);
    if (lost) {
      const form = formRef.current;
      const checked = form?.querySelector<HTMLInputElement>(
        'input[name$="-model"]:checked:not(:disabled)',
      );
      const enabled = form?.querySelector<HTMLElement>('input[name$="-model"]:not(:disabled)');
      const connect = form?.querySelector<HTMLElement>(".rg-spawn__link");
      (checked ?? enabled ?? connect)?.focus();
    }
  }, [pending, values.model, loaded]);

  const provider = values.provider;
  const credential = effectiveCredential(values, access);
  const options = useMemo(
    () => credentialOptions(providerLabel(provider), access[provider]),
    [provider, access],
  );

  const set = <K extends keyof SpawnFormValues>(key: K, value: SpawnFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const moreRef = useRef<HTMLButtonElement>(null);
  const toggleMore = () => {
    const next = !moreOpen;
    setMoreOpen(next);
    saveMoreOptionsOpen(userId, next);
    // On short screens the section opens below the fold: bring it up.
    if (next) requestAnimationFrame(() => moreRef.current?.scrollIntoView?.({ block: "start" }));
  };

  const submit = (event: React.FormEvent | React.KeyboardEvent) => {
    event.preventDefault();
    if (pending) return;
    const result = validateSpawnForm(values, {
      floorId: props.floorId,
      seatId: props.seatId,
      repos,
      access,
    });
    if (!result.ok) {
      setErrors(result.errors);
      // A problem in a collapsed field must be visible.
      if (MORE_OPTION_FIELDS.some((k) => result.errors[k])) setMoreOpen(true);
      return;
    }
    setErrors({});
    props.onSubmit(result.payload);
  };

  const moreId = `${id}-more`;
  return (
    <form
      ref={formRef}
      className="rg-spawn"
      aria-label={props.labels?.form ?? "Spawn robot"}
      onSubmit={submit}
      noValidate
    >
      <div className="rg-spawn__scroll rg-scroll-shadows">
        <fieldset className="rg-spawn__fields" disabled={pending}>
          {repos.length !== 1 && (
            <RepoPicker
              idBase={`${id}-repo`}
              repos={repos}
              repoId={values.repoId}
              onChange={(repoId) => set("repoId", repoId)}
              error={errors.repoId}
            />
          )}
          <ModelPicker
            idBase={`${id}-model`}
            provider={provider}
            model={values.model}
            access={access}
            focusRef={props.modelFocusRef}
            onChange={(p, m) => {
              modelTouched.current = true;
              setValues((v) => withModel(v, p, m));
              setErrors((e) => ({ ...e, model: undefined, effort: undefined }));
            }}
            onConnect={props.onConnect}
            error={errors.model}
          />
          <EffortPicker
            idBase={`${id}-effort`}
            provider={provider}
            model={values.model}
            effort={values.effort}
            onChange={(effort) => set("effort", effort)}
            error={errors.effort}
          />

          <button
            ref={moreRef}
            type="button"
            className="rg-spawn__more-toggle"
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={toggleMore}
          >
            <span className="rg-spawn__chevron" aria-hidden="true" />
            More options
          </button>
          {moreOpen && (
            <div id={moreId}>
              <MoreOptions
                idBase={id}
                values={values}
                errors={errors}
                credential={credential}
                credentialOptions={options}
                credentialHint={
                  access[provider]?.profilesError
                    ? "Could not load your saved keys; your own login still works."
                    : "Your login lives in your own runner; keys stay on the server."
                }
                set={set}
                onSubmitShortcut={submit}
              />
            </div>
          )}
        </fieldset>
      </div>

      {serverError && <FormAlert>{serverError}</FormAlert>}
      <div className="rg-spawn__actions">
        <Button ref={cancelRef} variant="secondary" onClick={props.onCancel}>
          {pending ? "Close" : "Cancel"}
        </Button>
        <Button variant="primary" type="submit" disabled={pending} aria-busy={pending}>
          {pending
            ? (props.labels?.pending ?? "Spawning…")
            : (props.labels?.submit ?? "Spawn robot")}
        </Button>
      </div>
    </form>
  );
}
