/**
 * Spawn dialog model (SPEC §6 `agent.spawn`, §8, #142): form values,
 * validation and the command payload. Pure, so the rules are tested without
 * a DOM. The main form asks for the repo, the model and the effort; the rest
 * has defaults (own worktree, the credential from `defaultCredential`, no
 * prompt: the henchman starts idle and waits). The dialog never handles a
 * secret: a credential is chosen by profile id only.
 */
import {
  type ClientCommandPayload,
  defaultPermissionMode,
  isPermissionModeFor,
  type PermissionMode,
  type ProviderId,
  parseClientCommand,
} from "@regulus/protocol";
import type { SpawnPrefill } from "../../state/spawn.ts";
import {
  type AccessByProvider,
  defaultCredential,
  OWN_LOGIN,
  providerUsable,
} from "./credentials.ts";
import {
  defaultEffortFor,
  findModel,
  PROVIDER_PRESETS,
  providerLabel,
  providerPreset,
} from "./models.ts";

export type SpawnPayload = ClientCommandPayload<"agent.spawn">;

export interface SpawnFormValues {
  repoId: string;
  provider: ProviderId;
  model: string;
  /** "" = the model has no effort setting. */
  effort: string;
  /** Permission mode (#166); null = the provider default (not picked by hand). */
  permissionMode: PermissionMode | null;
  /** Credential profile id, "" = own CLI login; null = the default (not picked by hand). */
  profileId: string | null;
  prompt: string;
  taskTitle: string;
  /** Issue number as typed; "" = none. */
  issueNumber: string;
  autoWorktree: boolean;
}

export type SpawnFormErrors = Partial<Record<keyof SpawnFormValues, string>>;

/** Fields that live under "More options". */
export const MORE_OPTION_FIELDS: readonly (keyof SpawnFormValues)[] = [
  "prompt",
  "taskTitle",
  "issueNumber",
  "permissionMode",
  "profileId",
  "autoWorktree",
];

export interface SpawnRepoOption {
  repoId: string;
  label: string;
  /** Cloned and usable; the server refuses repos still cloning. */
  ready: boolean;
  isPrimary: boolean;
}

export interface SpawnContext {
  operationId: string;
  seatId: string;
  repos: readonly SpawnRepoOption[];
  /** Logins and profiles per provider, as far as they are known. */
  access: AccessByProvider;
}

export const MAX_PROMPT = 20_000;
export const MAX_TITLE = 200;

export function initialSpawnValues(
  repos: readonly SpawnRepoOption[],
  prefill: SpawnPrefill | undefined,
): SpawnFormValues {
  const ready = repos.filter((r) => r.ready);
  const repo =
    repos.find((r) => r.repoId === prefill?.repoId) ??
    ready.find((r) => r.isPrimary) ??
    ready[0] ??
    repos[0];
  const provider = PROVIDER_PRESETS[0];
  const model = provider?.defaultModel ?? "";
  return {
    repoId: repo?.repoId ?? "",
    provider: provider?.id ?? "claude-code",
    model,
    effort: provider ? defaultEffortFor(provider.id, model) : "",
    permissionMode: null,
    profileId: null,
    prompt: prefill?.prompt ?? "",
    taskTitle: prefill?.taskTitle ?? "",
    issueNumber: prefill?.issueNumber ? String(prefill.issueNumber) : "",
    autoWorktree: true,
  };
}

/** Picking a model sets its provider and that model's default effort. */
export function withModel(
  values: SpawnFormValues,
  provider: ProviderId,
  model: string,
): SpawnFormValues {
  if (provider === values.provider && model === values.model) return values;
  return {
    ...values,
    provider,
    model,
    effort: defaultEffortFor(provider, model),
    // A hand-picked credential or permission mode belongs to the old provider.
    profileId: provider === values.provider ? values.profileId : null,
    permissionMode: provider === values.provider ? values.permissionMode : null,
  };
}

/**
 * The model to preselect once logins are known: the current one if its
 * provider is usable, else the default model of the first usable provider.
 */
export function usableDefault(values: SpawnFormValues, access: AccessByProvider): SpawnFormValues {
  if (providerUsable(access[values.provider])) return values;
  const next = PROVIDER_PRESETS.find((p) => providerUsable(access[p.id]));
  return next ? withModel(values, next.id, next.defaultModel) : values;
}

/** The credential the spawn will use: the hand-picked one, else the default. */
export function effectiveCredential(values: SpawnFormValues, access: AccessByProvider): string {
  return values.profileId ?? defaultCredential(access[values.provider]);
}

/** The permission mode the henchman will run in: the hand-picked one, else the provider default. */
export function effectivePermissionModeOf(values: SpawnFormValues): PermissionMode | undefined {
  return values.permissionMode ?? defaultPermissionMode(values.provider);
}

export type SpawnValidation =
  | { ok: true; payload: SpawnPayload }
  | { ok: false; errors: SpawnFormErrors };

export function validateSpawnForm(values: SpawnFormValues, ctx: SpawnContext): SpawnValidation {
  const errors: SpawnFormErrors = {};
  const repo = ctx.repos.find((r) => r.repoId === values.repoId);
  if (!repo) errors.repoId = "Pick a repo.";
  else if (!repo.ready) errors.repoId = "This repo is still cloning (or failed to clone).";

  const model = findModel(values.provider, values.model);
  if (!providerPreset(values.provider) || !model) errors.model = "Pick a model.";
  else if (!providerUsable(ctx.access[values.provider])) {
    errors.model = `Connect ${providerLabel(values.provider)} first, or pick another model.`;
  }

  const effort = values.effort.trim();
  if (model && model.efforts.length > 0 && !model.efforts.includes(effort)) {
    errors.effort = "Pick an effort.";
  }

  const mode = values.permissionMode;
  if (mode !== null && !isPermissionModeFor(values.provider, mode)) {
    errors.permissionMode = `${providerLabel(values.provider)} has no such permission mode.`;
  }

  const prompt = values.prompt.trim();
  if (prompt.length > MAX_PROMPT) errors.prompt = `At most ${MAX_PROMPT} characters.`;

  const title = values.taskTitle.trim();
  if (title.length > MAX_TITLE) errors.taskTitle = `At most ${MAX_TITLE} characters.`;

  let issueNumber: number | undefined;
  const issue = values.issueNumber.trim().replace(/^#/, "");
  if (issue) {
    const n = Number(issue);
    if (!/^\d+$/.test(issue) || !Number.isSafeInteger(n) || n < 1) {
      errors.issueNumber = "An issue number like 42.";
    } else issueNumber = n;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const profileId = effectiveCredential(values, ctx.access);
  const payload: SpawnPayload = {
    operationId: ctx.operationId,
    repoId: values.repoId,
    seatId: ctx.seatId,
    provider: values.provider,
    model: values.model,
    autoWorktree: values.autoWorktree,
    // "" = no prompt: the henchman starts idle and waits to be prompted.
    prompt,
    ...(model?.efforts.length ? { effort } : {}),
    // Omitted = the provider default (Claude: auto mode; Codex: on-request).
    ...(mode !== null ? { permissionMode: mode } : {}),
    ...(profileId !== OWN_LOGIN ? { profileId } : {}),
    ...(title ? { taskTitle: title } : {}),
    ...(issueNumber ? { issueNumber } : {}),
  };
  // Last line of defence: the exact schema the OperationRoom validates with.
  const parsed = parseClientCommand("agent.spawn", payload);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "model") as keyof SpawnFormValues;
    return { ok: false, errors: { [field]: "This value is not accepted." } };
  }
  return { ok: true, payload };
}
