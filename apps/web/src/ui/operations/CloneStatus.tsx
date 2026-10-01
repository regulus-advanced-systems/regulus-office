/**
 * Clone status of an operation's repos (SPEC §8): cloning / ready (with the
 * default branch) / error (redacted reason, with a retry). The operation list
 * store polls while anything is cloning (see useOperationListSync).
 */
import type { OperationRepoInfo } from "@regulus/protocol";
import { useState } from "react";
import { useCompoundStore } from "../../state/compound.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { travelTo } from "../../state/travel.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { describeOperationError, type OperationsApi } from "./api.ts";

export function cloneStatusText(repo: OperationRepoInfo): string {
  switch (repo.cloneStatus) {
    case "cloning":
      return "Cloning…";
    case "ready":
      return `Ready on ${repo.defaultBranch}`;
    case "error":
      return `Clone failed: ${repo.cloneError ?? "unknown error"}`;
  }
}

export function CloneStatusList({
  operationId,
  api,
  onRide,
}: {
  operationId: string;
  api: OperationsApi;
  onRide?: () => void;
}) {
  const operation = useOperationsStore((s) =>
    s.operations?.find((f) => f.operationId === operationId),
  );
  const refresh = useOperationsStore((s) => s.refresh);
  // The room is on the compound map and finished building (#181, #186): quick travel there.
  const room = useCompoundStore((s) => s.world?.rooms.find((r) => r.id === operationId));
  const reachable = Boolean(room?.enterable && room.buildState === "ready");
  const [error, setError] = useState<string | null>(null);
  if (!operation) return <div className="rg-muted">Loading…</div>;

  const retry = async (repoId: string) => {
    setError(null);
    const result = await api.retryClone(operationId, repoId);
    if (!result.ok) setError(describeOperationError(result));
    await refresh(api);
  };

  return (
    <div>
      <p>
        <strong>{operation.name}</strong> has a room in the compound.
      </p>
      <ul className="rg-list" aria-label="Repos">
        {operation.repos.map((repo) => (
          <li key={repo.repoId} className="rg-operation-repo" data-status={repo.cloneStatus}>
            <span>
              {repo.owner}/{repo.name}
              {repo.isPrimary && <span className="rg-muted"> (primary)</span>}
            </span>
            <span className="rg-operation-repo__status">{cloneStatusText(repo)}</span>
            {repo.cloneStatus === "error" && (
              <Button variant="secondary" size="sm" onClick={() => void retry(repo.repoId)}>
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <FormAlert>{error}</FormAlert>}
      <div style={{ marginTop: 12 }}>
        <Button
          variant="primary"
          disabled={!reachable}
          onClick={() => {
            travelTo(operationId, { walkIn: true });
            onRide?.();
          }}
        >
          {room && room.buildState === "building" ? "Building…" : "Go to room"}
        </Button>
      </div>
    </div>
  );
}
