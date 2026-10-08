/**
 * An office agent as one viewer may see it (#271, #280): what it is and what
 * it runs on for everyone who sees its card; instructions, the credential
 * choice, grants and tokens only for those who may configure it (D20).
 */
import {
  mayConfigureOfficeAgent,
  mayRemoveOfficeAgent,
  mayTalkToOfficeAgent,
  type OfficeAgentView,
} from "@regulus/protocol";
import { type OperationActor, operationAccessFor } from "../operations/access.ts";
import { agentCost } from "./cost.ts";
import { runsOnOf } from "./runs-on.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "./store.ts";
import type { OfficeAgentTokens } from "./tokens.ts";

export function agentView(
  deps: { store: OfficeAgentStore; tokens: OfficeAgentTokens; now?: () => number },
  actor: OperationActor,
  row: OfficeAgentRow,
): OfficeAgentView {
  const { store, tokens } = deps;
  const owner = row.ownerUserId ? store.person(row.ownerUserId) : undefined;
  const canConfigure = mayConfigureOfficeAgent(actor, row);
  return {
    id: row.id,
    name: row.name,
    owner: row.ownerUserId
      ? { kind: "user", userId: row.ownerUserId, displayName: owner?.displayName ?? "" }
      : { kind: "office" },
    engine: row.engine,
    role: row.role,
    preset: row.preset,
    provider: row.provider,
    model: row.model,
    ...(row.effort ? { effort: row.effort } : {}),
    runsOn: runsOnOf(store.db, row, canConfigure),
    appearance: row.appearance,
    dismissed: row.ownerUserId !== null && row.dismissed,
    status: row.status,
    ...(row.statusReason ? { statusReason: row.statusReason } : {}),
    ...(row.lastActivityAt ? { lastActivityAt: row.lastActivityAt.getTime() } : {}),
    createdAt: row.createdAt.getTime(),
    canTalk: mayTalkToOfficeAgent(actor, row),
    canConfigure,
    canRemove: mayRemoveOfficeAgent(actor, row),
    // What it has cost: for everyone who sees the card, so also for an admin who reads nothing else (#136).
    cost: agentCost(store.db, row, (deps.now ?? Date.now)()),
    ...(canConfigure
      ? {
          config: {
            instructions: row.instructions,
            ...(row.profileId ? { profileId: row.profileId } : {}),
            // Only the rooms the person looking can see themselves (D27; #270).
            grants:
              row.ownerUserId === null
                ? store
                    .grants(row.id)
                    .filter((g) => operationAccessFor(store.db, actor, g.operationId) !== null)
                : [],
            tokens: tokens.list(row.id).map((t) => ({
              id: t.id,
              label: t.label,
              createdAt: t.createdAt.getTime(),
              ...(t.lastUsedAt ? { lastUsedAt: t.lastUsedAt.getTime() } : {}),
            })),
          },
        }
      : {}),
  };
}
