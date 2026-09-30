/**
 * The room's task queue (SPEC §9.4 clipboard, 2D panel; #37): queued tasks
 * in run order, running ones with their robot, and recent history with
 * failure reasons and linked PRs. Owners and room managers reorder and
 * cancel; owners retry; room managers set how many tasks run at once.
 * Everyone who can see the room sees the queue.
 */
import type { ClientCommandPayload, CommandRejected, QueueTask } from "@regulus/protocol";
import { hasFloorAccess, mayConfigureQueue } from "@regulus/protocol";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getOfficeClient } from "../../net/index.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { QueueSettingsForm } from "./QueueSettingsForm.tsx";
import { queueSections, STATE_LABELS, taskActions, taskRef } from "./queueModel.ts";
import { useQueueStore } from "./queueStore.ts";

type QueueCommand = "queue.reorder" | "queue.cancel" | "queue.retry" | "queue.settings";
export type QueueSend = <T extends QueueCommand>(type: T, payload: ClientCommandPayload<T>) => void;

const NO_TASKS: readonly QueueTask[] = [];

function officeSend(): QueueSend {
  return (type, payload) => getOfficeClient().send(type, payload);
}

function useQueueRejections(): [string | null, (e: string | null) => void] {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = getOfficeClient().onRejected((notice: CommandRejected) => {
        if (notice.type.startsWith("queue.") && notice.type !== "queue.add") {
          setError(`The office refused: ${notice.reason}.`);
        }
      });
    } catch {
      // Not connected (tests): nothing to listen to.
    }
    return () => off?.();
  }, []);
  return [error, setError];
}

function TaskRow({
  task,
  actions,
  send,
}: {
  task: QueueTask;
  actions: ReturnType<typeof taskActions>;
  send: QueueSend;
}) {
  const queuedIndex = task.position;
  return (
    <li className={`rg-queue__task rg-queue__task--${task.state}`} data-task={task.id}>
      <div className="rg-queue__task-head">
        <span className="rg-queue__ref">{taskRef(task)}</span>
        <strong className="rg-queue__title">{task.title}</strong>
        <span className={`rg-queue__state rg-queue__state--${task.state}`}>
          {STATE_LABELS[task.state]}
        </span>
      </div>
      <div className="rg-queue__task-meta">
        {task.ownerName || "Someone"} · {task.model}
        {task.effort ? ` · ${task.effort}` : ""}
        {task.prNumber > 0 && <> · PR #{task.prNumber}</>}
      </div>
      {task.reason && <div className="rg-queue__reason">{task.reason}</div>}
      <div className="rg-queue__task-actions">
        {actions.moveUp && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move “${task.title}” up`}
            onClick={() => send("queue.reorder", { taskId: task.id, position: queuedIndex - 1 })}
          >
            Up
          </Button>
        )}
        {actions.moveDown && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move “${task.title}” down`}
            onClick={() => send("queue.reorder", { taskId: task.id, position: queuedIndex + 1 })}
          >
            Down
          </Button>
        )}
        {actions.retry && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => send("queue.retry", { taskId: task.id })}
          >
            Retry
          </Button>
        )}
        {actions.cancel && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => send("queue.cancel", { taskId: task.id })}
          >
            {task.state === "running" ? "Let go" : "Cancel"}
          </Button>
        )}
      </div>
    </li>
  );
}

export function QueuePanel({ send = officeSend() }: { send?: QueueSend }) {
  const closePanel = useQueueStore((s) => s.closePanel);
  const openAdd = useQueueStore((s) => s.openAdd);
  const floorId = useFloorStore((s) => s.floorId);
  const { tasks, settings } = useFloorStore(
    useShallow((s) => ({ tasks: s.state?.queue ?? NO_TASKS, settings: s.state?.queueSettings })),
  );
  const access =
    useFloorsStore((s) => s.floors?.find((f) => f.floorId === floorId)?.access) ?? null;
  const userId = useSessionStore((s) => s.user?.id ?? null);
  const me = userId ? { id: userId } : null;
  const [error, setError] = useQueueRejections();
  const sections = queueSections(tasks);
  const guarded: QueueSend = (type, payload) => {
    setError(null);
    try {
      send(type, payload);
    } catch {
      setError("Not connected to this room yet. Try again in a moment.");
    }
  };

  const list = (title: string, items: QueueTask[], empty: string) => (
    <section className="rg-queue__section" aria-label={title}>
      <h3 className="rg-queue__heading">
        {title} <span className="rg-queue__count">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="rg-queue__empty">{empty}</p>
      ) : (
        <ol className="rg-queue__list">
          {items.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              actions={taskActions(task, me, access, items.indexOf(task), items.length)}
              send={guarded}
            />
          ))}
        </ol>
      )}
    </section>
  );

  // Positions of queued tasks are their index among the queued ones.
  const queued = sections.queued.map((t, i) => ({ ...t, position: i }));
  return (
    <Modal open onClose={closePanel} title="Task queue" width={640}>
      <div className="rg-queue">
        <p className="rg-queue__intro">
          Each task starts a robot for the human who queued it, when a desk and a slot are free
          {settings ? ` (${settings.maxRunning} at once, ${settings.maxPerOwner} per person)` : ""}.
        </p>
        {hasFloorAccess(access, "spawn") && (
          <Button variant="primary" onClick={() => openAdd()}>
            Queue a task…
          </Button>
        )}
        {error && <FormAlert>{error}</FormAlert>}
        {list("Queued", queued, "Nothing waiting.")}
        {list("Running", sections.running, "No queued task is running.")}
        {sections.finished.length > 0 && list("Recent", sections.finished, "")}
        {mayConfigureQueue(access) && settings && (
          <QueueSettingsForm settings={settings} send={guarded} />
        )}
      </div>
    </Modal>
  );
}
