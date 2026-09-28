/**
 * Spawn dialog model (SPEC §6 `agent.spawn`, §8): form values, validation and
 * the command payload. Pure, so the rules are tested without a DOM. The
 * dialog never handles a secret: a credential is chosen by profile id only,
 * and the empty choice means "your own CLI login in your runner".
 */
import { type ClientCommandPayload, type ProviderId, parseClientCommand } from "@regulus/protocol";
import type { SpawnPrefill } from "../../state/spawn.ts";
import { presetsFor, SPAWNABLE_PROVIDERS } from "./presets.ts";

export type SpawnPayload = ClientCommandPayload<"agent.spawn">;

export interface SpawnFormValues {
  repoId: string;
  provider: ProviderId;
  /** Credential profile id; "" = the human's own CLI login. */
  profileId: string;
  model: string;
  effort: string;
  prompt: string;
  taskTitle: string;
  /** Issue number as typed; "" = none. */
  issueNumber: string;
  autoWorktree: boolean;
}

export type SpawnFormErrors = Partial<Record<keyof SpawnFormValues, string>>;

export interface SpawnRepoOption {
  repoId: string;
  label: string;
  /** Cloned and usable; the server refuses repos still cloning. */
  ready: boolean;
  isPrimary: boolean;
}

export interface SpawnContext {
  floorId: string;
  seatId: string;
  repos: readonly SpawnRepoOption[];
}

export const MAX_PROMPT = 20_000;
export const MAX_TITLE = 200;

export function initialSpawnValues(
  repos: readonly SpawnRepoOption[],
  prefill: SpawnPrefill | undefined,
  provider: ProviderId = "claude-code",
): SpawnFormValues {
  const ready = repos.filter((r) => r.ready);
  const repo =
    repos.find((r) => r.repoId === prefill?.repoId) ??
    ready.find((r) => r.isPrimary) ??
    ready[0] ??
    repos[0];
  const presets = presetsFor(provider);
  return {
    repoId: repo?.repoId ?? "",
    provider,
    profileId: "",
    model: presets.defaultModel,
    effort: presets.defaultEffort,
    prompt: prefill?.prompt ?? "",
    taskTitle: prefill?.taskTitle ?? "",
    issueNumber: prefill?.issueNumber ? String(prefill.issueNumber) : "",
    autoWorktree: true,
  };
}

/** Switching provider resets what depends on it: profile, model and effort presets. */
export function withProvider(values: SpawnFormValues, provider: ProviderId): SpawnFormValues {
  if (provider === values.provider) return values;
  const presets = presetsFor(provider);
  return {
    ...values,
    provider,
    profileId: "",
    model: presets.defaultModel,
    effort: presets.defaultEffort,
  };
}

export type SpawnValidation =
  | { ok: true; payload: SpawnPayload }
  | { ok: false; errors: SpawnFormErrors };

export function validateSpawnForm(values: SpawnFormValues, ctx: SpawnContext): SpawnValidation {
  const errors: SpawnFormErrors = {};
  const repo = ctx.repos.find((r) => r.repoId === values.repoId);
  if (!repo) errors.repoId = "Pick a repo.";
  else if (!repo.ready) errors.repoId = "This repo is still cloning (or failed to clone).";

  if (!SPAWNABLE_PROVIDERS.has(values.provider)) {
    errors.provider = "This provider is not available yet.";
  }

  const model = values.model.trim();
  if (!model) errors.model = "Pick or type a model.";
  else if (model.length > 100) errors.model = "Model names are at most 100 characters.";
  else if (/\s/.test(model)) errors.model = "Model names have no spaces.";

  const effort = values.effort.trim();
  const presets = presetsFor(values.provider);
  if (effort) {
    if (effort.length > 32) errors.effort = "Effort is at most 32 characters.";
    else if (presets.strictEffort && !presets.efforts.includes(effort)) {
      errors.effort = `Use one of: ${presets.efforts.join(", ")}.`;
    }
  }

  const prompt = values.prompt.trim();
  if (!prompt) errors.prompt = "Tell the robot what to do.";
  else if (prompt.length > MAX_PROMPT) errors.prompt = `At most ${MAX_PROMPT} characters.`;

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

  const payload: SpawnPayload = {
    floorId: ctx.floorId,
    repoId: values.repoId,
    seatId: ctx.seatId,
    provider: values.provider,
    model,
    prompt,
    autoWorktree: values.autoWorktree,
    ...(effort ? { effort } : {}),
    ...(values.profileId ? { profileId: values.profileId } : {}),
    ...(title ? { taskTitle: title } : {}),
    ...(issueNumber ? { issueNumber } : {}),
  };
  // Last line of defence: the exact schema the FloorRoom validates with.
  const parsed = parseClientCommand("agent.spawn", payload);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "prompt") as keyof SpawnFormValues;
    return { ok: false, errors: { [field]: "This value is not accepted." } };
  }
  return { ok: true, payload };
}
