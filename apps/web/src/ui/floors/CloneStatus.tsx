/**
 * Clone status of a floor's repos (SPEC §8): cloning / ready (with the
 * default branch) / error (redacted reason, with a retry). The floor list
 * store polls while anything is cloning (see useFloorListSync).
 */
import type { FloorRepoInfo } from "@regulus/protocol";
import { useState } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { describeFloorError, type FloorsApi } from "./api.ts";

export function cloneStatusText(repo: FloorRepoInfo): string {
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
  floorId,
  api,
  onRide,
}: {
  floorId: string;
  api: FloorsApi;
  onRide?: () => void;
}) {
  const floor = useFloorsStore((s) => s.floors?.find((f) => f.floorId === floorId));
  const refresh = useFloorsStore((s) => s.refresh);
  const inBuilding = useBuildingStore((s) => Boolean(s.state?.floors[floorId]));
  const [error, setError] = useState<string | null>(null);
  if (!floor) return <div className="rg-muted">Loading…</div>;

  const retry = async (repoId: string) => {
    setError(null);
    const result = await api.retryClone(floorId, repoId);
    if (!result.ok) setError(describeFloorError(result));
    await refresh(api);
  };

  return (
    <div>
      <p>
        <strong>{floor.name}</strong> is floor {floor.index}.
      </p>
      <ul className="rg-list" aria-label="Repos">
        {floor.repos.map((repo) => (
          <li key={repo.repoId} className="rg-floor-repo" data-status={repo.cloneStatus}>
            <span>
              {repo.owner}/{repo.name}
              {repo.isPrimary && <span className="rg-muted"> (primary)</span>}
            </span>
            <span className="rg-floor-repo__status">{cloneStatusText(repo)}</span>
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
          disabled={!inBuilding}
          onClick={() => {
            void getOfficeClient().rideTo(floorId);
            onRide?.();
          }}
        >
          Go to floor
        </Button>
      </div>
    </div>
  );
}
