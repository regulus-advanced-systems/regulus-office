/**
 * Can this configuration run at all (#271; split from service.ts)? The
 * credential rules first (a shared agent names an office key, a personal one
 * what its owner may use), then the engine's own verdict. Asked before an
 * agent is stored and before a change is.
 */
import { AuthHttpError } from "../auth/errors.ts";
import type { AgentCredentials } from "./engines/credentials.ts";
import { EngineRefusal } from "./engines/types.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { NewOfficeAgentRow, OfficeAgentRow } from "./store.ts";

/** An engine's refusal as an HTTP error; its message is safe to show. */
export const refused = (err: EngineRefusal, status = 400) =>
  new AuthHttpError(status, err.code, { message: err.message });

type Draft = Pick<
  NewOfficeAgentRow,
  | "name"
  | "ownerUserId"
  | "engine"
  | "role"
  | "preset"
  | "provider"
  | "model"
  | "effort"
  | "profileId"
  | "appearance"
  | "instructions"
>;

/** `full` is the stored row for a change; a new agent is checked as the row it would become. */
export function checkAgentConfig(
  deps: { runtime: Pick<AgentRuntime, "engine" | "engineAgent">; credentials: AgentCredentials },
  draft: Draft,
  full?: OfficeAgentRow,
): void {
  const row: OfficeAgentRow = full ?? {
    ...draft,
    ownerUserId: draft.ownerUserId ?? null,
    effort: draft.effort ?? null,
    profileId: draft.profileId ?? null,
    appearance: draft.appearance ?? "standard",
    instructions: draft.instructions ?? "",
    createdBy: null,
    id: "draft",
    nameKey: "",
    dismissed: false,
    stoppedByPerson: false,
    status: "stopped",
    statusReason: null,
    engineState: "{}",
    lastActivityAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const engine = deps.runtime.engine(row.engine);
  if (!engine) throw new AuthHttpError(400, "engine_unavailable");
  try {
    // Whatever the engine: a shared agent names an office key, a personal one what its owner may use.
    deps.credentials.check(row);
    engine.check(deps.runtime.engineAgent(row));
  } catch (err) {
    if (err instanceof EngineRefusal) throw refused(err);
    throw err;
  }
}
