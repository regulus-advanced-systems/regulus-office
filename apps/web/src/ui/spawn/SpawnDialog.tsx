/**
 * Spawn dialog host (SPEC §9.2 `E` at a free desk, #142): a GDT modal around
 * the spawn form, opened through `useSpawnStore.openSpawn(seatId, prefill)`,
 * with focus on the model picker.
 * Sends `agent.spawn` to the FloorRoom, stays pending until the robot shows
 * up at that desk (then closes with a toast) or the server rejects the
 * command (`command.rejected`, shown in the dialog).
 */
import type { CommandRejected, FloorInfo, FloorState } from "@regulus/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { useSessionStore } from "../../state/session.ts";
import { useSpawnStore } from "../../state/spawn.ts";
import { useUiStore } from "../../state/ui.ts";
import { Modal } from "../components/Modal.tsx";
import { openProvidersPanel } from "../providers/providersStore.ts";
import { type CredentialProfilesApi, createCredentialProfilesApi } from "./api.ts";
import { SpawnForm } from "./SpawnForm.tsx";
import type { SpawnPayload, SpawnRepoOption } from "./spawnForm.ts";

export const SPAWN_OVERLAY = "spawn";

export interface SpawnClient {
  send(type: "agent.spawn", payload: SpawnPayload): void;
  onRejected(listener: (notice: CommandRejected) => void): () => void;
}

const defaultApi = createCredentialProfilesApi();

/** Repos to offer: REST floor info (with clone status) when loaded, else the FloorRoom's. */
export function spawnRepoOptions(
  info: FloorInfo | undefined,
  state: FloorState | null,
): SpawnRepoOption[] {
  if (info && info.repos.length > 0) {
    return info.repos.map((r) => ({
      repoId: r.repoId,
      label: `${r.owner}/${r.name}`,
      ready: r.cloneStatus === "ready",
      isPrimary: r.isPrimary,
    }));
  }
  return (state?.repos ?? []).map((r) => ({
    repoId: r.repoId,
    label: `${r.owner}/${r.name}`,
    ready: true,
    isPrimary: r.isPrimary,
  }));
}

/** Human wording for a rejected spawn. */
export function describeSpawnRejection(reason: string): string {
  return reason ? `The office could not spawn this henchman: ${reason}.` : "The office refused.";
}

export function SpawnDialogHost({
  api = defaultApi,
  client,
}: {
  api?: CredentialProfilesApi;
  client?: SpawnClient;
}) {
  const request = useSpawnStore((s) => s.request);
  const closeSpawn = useSpawnStore((s) => s.closeSpawn);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const toast = useUiStore((s) => s.toast);
  const floorId = useFloorStore((s) => s.floorId);
  const floorState = useFloorStore((s) => s.state);
  const info = useFloorsStore((s) => s.floors?.find((f) => f.floorId === floorId));
  const userId = useSessionStore((s) => s.user?.id ?? null);
  const repos = useMemo(() => spawnRepoOptions(info, floorState), [info, floorState]);

  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  /** Robots already at the desk when we sent, so only a new one counts as success. */
  const before = useRef<Set<string>>(new Set());
  const pendingRef = useRef(false);
  const modelFocus = useRef<HTMLInputElement>(null);
  pendingRef.current = pending;

  const seatId = request?.seatId ?? null;
  const open = request !== null && floorId !== null;

  // The dialog owns the keyboard while open (hotkeys are muted).
  useEffect(() => {
    if (!open) return;
    openOverlay(SPAWN_OVERLAY);
    return () => closeOverlay(SPAWN_OVERLAY);
  }, [open, openOverlay, closeOverlay]);

  // Fresh state for every desk.
  useEffect(() => {
    setPending(false);
    setServerError(null);
  }, [seatId]);

  const target = client ?? getOfficeClientSafe();
  useEffect(() => {
    if (!target) return;
    return target.onRejected((notice) => {
      if (notice.type !== "agent.spawn" || !pendingRef.current) return;
      setPending(false);
      setServerError(describeSpawnRejection(notice.reason));
    });
  }, [target]);

  // Success: a robot we own appeared at the requested desk.
  useEffect(() => {
    if (!pending || !seatId || !floorState) return;
    const robot = Object.values(floorState.robots).find(
      (r) => r.seatId === seatId && !before.current.has(r.agentId),
    );
    if (!robot || (userId && robot.ownerUserId !== userId)) return;
    setPending(false);
    closeSpawn();
    toast({
      kind: "success",
      title: "Henchman spawned",
      message: robot.taskTitle || `At desk ${robot.seatId}.`,
    });
  }, [pending, seatId, floorState, userId, closeSpawn, toast]);

  if (!open || !request || !floorId) return null;

  const submit = (payload: SpawnPayload) => {
    setServerError(null);
    before.current = new Set(
      Object.values(floorState?.robots ?? {})
        .filter((r) => r.seatId === request.seatId)
        .map((r) => r.agentId),
    );
    try {
      if (!target) throw new Error("not connected");
      target.send("agent.spawn", payload);
      setPending(true);
    } catch {
      setServerError("Not connected to this operation yet. Try again in a moment.");
    }
  };

  // One repo: it is preselected and named here instead of asked for.
  const onlyRepo = repos.length === 1 ? repos[0] : undefined;
  return (
    <Modal
      open
      onClose={closeSpawn}
      title="Spawn a henchman"
      width={640}
      dismissOnBackdrop={!pending}
      initialFocus={modelFocus}
    >
      <p className="rg-spawn__desk">
        Desk <strong>{request.seatId}</strong>
        {onlyRepo && (
          <>
            {" · "}
            <span className="rg-spawn__repo">{onlyRepo.label}</span>
          </>
        )}
        {pending ? " · starting the henchman…" : ""}
      </p>
      <SpawnForm
        key={request.seatId}
        floorId={floorId}
        seatId={request.seatId}
        repos={repos}
        prefill={request.prefill}
        api={api}
        userId={userId}
        modelFocusRef={modelFocus}
        pending={pending}
        serverError={serverError}
        onSubmit={submit}
        onCancel={closeSpawn}
        onConnect={(provider) => {
          closeSpawn();
          openProvidersPanel(provider);
        }}
      />
    </Modal>
  );
}

function getOfficeClientSafe(): SpawnClient | null {
  try {
    return getOfficeClient();
  } catch {
    return null;
  }
}
