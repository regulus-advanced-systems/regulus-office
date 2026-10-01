/**
 * "Queue a task" (#37): the spawn form (#142) on the room's queue instead of
 * a desk. Repo, model and effort as for a spawn; the prompt, title, issue,
 * permission mode, credential and worktree under More options, which starts
 * open here because a freeform task needs a prompt. The task runs later as
 * the human who queued it, with the credential chosen here (by profile id
 * only; SPEC §8). Sends `queue.add` and waits for `queue.result` or the
 * rejection.
 */
import {
  type CommandRejected,
  QUEUE_RESULT_MESSAGE,
  type QueueCommandResult,
} from "@regulus/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Modal } from "../components/Modal.tsx";
import { openProvidersPanel } from "../providers/providersStore.ts";
import { type CredentialProfilesApi, createCredentialProfilesApi } from "../spawn/api.ts";
import { spawnRepoOptions } from "../spawn/SpawnDialog.tsx";
import { SpawnForm } from "../spawn/SpawnForm.tsx";
import { type QueueAddPayload, queuePayload, spawnPrefillFor, taskRef } from "./queueModel.ts";
import { type QueuePrefill, useQueueStore } from "./queueStore.ts";

export interface QueueClient {
  send(type: "queue.add", payload: QueueAddPayload): void;
  onRejected(listener: (notice: CommandRejected) => void): () => void;
  onOperationMessage(type: string, listener: (payload: unknown) => void): () => void;
}

const defaultApi = createCredentialProfilesApi();
/** Not a desk: the form wants a seat id, the queue ignores it. */
const QUEUE_SEAT = "queue";
const LABELS = { form: "Queue a task", submit: "Queue task", pending: "Queueing…" };

function safeClient(): QueueClient | null {
  try {
    return getOfficeClient();
  } catch {
    return null;
  }
}

export function QueueTaskDialog({
  prefill,
  api = defaultApi,
  client,
}: {
  prefill?: QueuePrefill;
  api?: CredentialProfilesApi;
  client?: QueueClient;
}) {
  const closeAdd = useQueueStore((s) => s.closeAdd);
  const openPanel = useQueueStore((s) => s.openPanel);
  const toast = useUiStore((s) => s.toast);
  const operationId = useOperationStore((s) => s.operationId);
  const operationState = useOperationStore((s) => s.state);
  const info = useOperationsStore((s) => s.operations?.find((f) => f.operationId === operationId));
  const userId = useSessionStore((s) => s.user?.id ?? null);
  const repos = useMemo(() => spawnRepoOptions(info, operationState), [info, operationState]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const modelFocus = useRef<HTMLInputElement>(null);
  pendingRef.current = pending;
  const target = client ?? safeClient();

  useEffect(() => {
    if (!target) return;
    const offRejected = target.onRejected((notice) => {
      if (notice.type !== "queue.add" || !pendingRef.current) return;
      setPending(false);
      setError(`The office could not queue this task: ${notice.reason}.`);
    });
    const offResult = target.onOperationMessage(QUEUE_RESULT_MESSAGE, (payload) => {
      const result = payload as QueueCommandResult;
      if (result?.type !== "queue.add" || !pendingRef.current) return;
      setPending(false);
      closeAdd();
      openPanel();
      toast({ kind: "success", title: "Task queued", message: "It starts when a desk is free." });
    });
    return () => {
      offRejected();
      offResult();
    };
  }, [target, closeAdd, openPanel, toast]);

  if (!operationId) return null;
  const onlyRepo = repos.length === 1 ? repos[0] : undefined;
  const from = prefill?.refNumber
    ? taskRef({ kind: prefill.kind, refNumber: prefill.refNumber })
    : "";

  return (
    <Modal
      open
      onClose={closeAdd}
      title="Queue a task"
      width={640}
      dismissOnBackdrop={!pending}
      initialFocus={modelFocus}
    >
      <p className="rg-spawn__desk">
        {from ? (
          <>
            From <strong>{from}</strong>
          </>
        ) : (
          "Runs as you, on the next free desk"
        )}
        {onlyRepo && (
          <>
            {" · "}
            <span className="rg-spawn__repo">{onlyRepo.label}</span>
          </>
        )}
      </p>
      <SpawnForm
        operationId={operationId}
        seatId={QUEUE_SEAT}
        repos={repos}
        prefill={spawnPrefillFor(prefill)}
        api={api}
        userId={userId}
        modelFocusRef={modelFocus}
        pending={pending}
        serverError={error}
        labels={LABELS}
        moreOpen
        onSubmit={(spawn) => {
          const result = queuePayload(spawn, prefill);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setError(null);
          try {
            if (!target) throw new Error("not connected");
            target.send("queue.add", result.payload);
            setPending(true);
          } catch {
            setError("Not connected to this room yet. Try again in a moment.");
          }
        }}
        onCancel={closeAdd}
        onConnect={(provider) => {
          closeAdd();
          openProvidersPanel(provider);
        }}
      />
    </Modal>
  );
}
